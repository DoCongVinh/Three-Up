/**
 * Lớp dữ liệu SQLite cho phiên bản web (server.js).
 *
 * - Dùng module `node:sqlite` có sẵn trong Node >= 22.5 (không cần build native).
 * - 2 bảng chính: `users` (tài khoản cán bộ, hash scrypt) và `feedbacks`.
 * - Toạ độ GPS tách thành 2 cột riêng để tra cứu trên bản đồ; phần còn lại của
 *   phản hồi lưu JSON để giữ nguyên cấu trúc mà app.js / AppService đang dùng.
 * - Bí mật (hash mật khẩu, mật khẩu admin seed, token thiết bị) KHÔNG trả ra API.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// `node:sqlite` từng cảnh báo "experimental"; tắt cảnh báo đó cho log server gọn.
const originalEmitWarning = process.emitWarning;
process.emitWarning = function patchedEmitWarning(warning, ...rest) {
  const text = typeof warning === "string" ? warning : warning?.message || "";
  if (text.includes("SQLite is an experimental feature")) return undefined;
  return originalEmitWarning.call(process, warning, ...rest);
};
const { DatabaseSync } = await import("node:sqlite");

/** Các trường của feedback được lưu thành cột thật (còn lại -> cột `data` JSON). */
const FEEDBACK_COLUMNS = Object.freeze({
  id: "TEXT PRIMARY KEY",
  full_name: "TEXT NOT NULL",
  phone: "TEXT NOT NULL",
  email: "TEXT",
  category: "TEXT NOT NULL",
  ward_id: "TEXT NOT NULL",
  ward_name: "TEXT",
  hamlet: "TEXT",
  status: "TEXT NOT NULL DEFAULT 'pending'",
  review_note: "TEXT",
  reviewed_at: "TEXT",
  lat: "REAL",
  lng: "REAL",
  device_id: "TEXT",
  client_ip: "TEXT",
  created_at: "TEXT NOT NULL",
  updated_at: "TEXT NOT NULL",
});

/* ------------------------------ Password hash ------------------------------ */

const SCRYPT_KEYLEN = 32;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(String(password), salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* -------------------------------- Mappers --------------------------------- */

/** Bản ghi DB -> phản hồi công khai (đúng dạng app.js đang đọc). */
export function rowToFeedback(row) {
  if (!row) return null;
  const extra = safeJson(row.data);
  // Không rò rỉ định danh thiết bị/IP thô ra phía trình duyệt.
  delete extra.passwordHash;
  delete extra.deviceId;
  delete extra.clientIp;
  delete extra.ip;
  const rest = extra;
  return {
    ...rest,
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email || "",
    category: row.category,
    wardId: row.ward_id,
    wardName: row.ward_name || rest.wardName || "",
    hamlet: row.hamlet || "",
    status: row.status,
    reviewNote: row.review_note || "",
    reviewedAt: row.reviewed_at || null,
    lat: row.lat,
    lng: row.lng,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Chỉ dùng nội bộ server để chọn phòng Socket; publicFeedbackView() loại bỏ trước khi gửi ra ngoài.
    deviceId: row.device_id || null,
    // Nguồn gửi: chỉ trả về dạng che bớt, không lộ IP/token/định danh thiết bị.
    clientIpMasked: maskIp(row.client_ip),
    source: rest.submittedFrom || "web",
  };
}

/** Bản ghi DB -> tài khoản công khai (không bao giờ có password_hash). */
export function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    scope: row.scope || null,
    scopeName: row.scope_name || null,
    active: Boolean(row.active),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
  };
}

/** Ẩn bớt IP: 203.113.45.67 -> 203.113.x.x */
export function maskIp(ip) {
  if (!ip) return "";
  const value = String(ip).replace(/^::ffff:/, "");
  if (value.includes(":")) return `${value.split(":").slice(0, 2).join(":")}:*`;
  const parts = value.split(".");
  if (parts.length !== 4) return "";
  return `${parts[0]}.${parts[1]}.x.x`;
}

function safeJson(text) {
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/* ------------------------------- WebDatabase ------------------------------- */

export class WebDatabase {
  /**
   * @param {string} filePath đường dẫn file .db (hoặc ":memory:")
   * @param {{ seedDemo?: boolean }} [options]
   */
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.seedDemo = options.seedDemo !== false;
    if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
    this.seedIfEmpty();
  }

  migrate() {
    const feedbackDdl = Object.entries(FEEDBACK_COLUMNS)
      .map(([name, type]) => `  ${name} ${type}`)
      .join(",\n");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE,
        display_name  TEXT,
        role          TEXT NOT NULL DEFAULT 'ward',
        scope         TEXT,
        scope_name    TEXT,
        password_hash TEXT NOT NULL,
        active        INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS feedbacks (
${feedbackDdl}
      );

      CREATE INDEX IF NOT EXISTS idx_feedbacks_status   ON feedbacks(status);
      CREATE INDEX IF NOT EXISTS idx_feedbacks_ward     ON feedbacks(ward_id);
      CREATE INDEX IF NOT EXISTS idx_feedbacks_created  ON feedbacks(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_feedbacks_device   ON feedbacks(device_id);
    `);

    // Cột `data` chứa phần JSON còn lại; bản DB cũ chưa có thì thêm vào.
    const columns = this.db.prepare("PRAGMA table_info(feedbacks)").all().map((column) => column.name);
    if (!columns.includes("data")) {
      this.db.exec("ALTER TABLE feedbacks ADD COLUMN data TEXT NOT NULL DEFAULT '{}'");
    }
  }

  /** Tài khoản admin mặc định + (tuỳ chọn) vài phản hồi mẫu — chỉ khi DB còn trống. */
  seedIfEmpty() {
    const { count } = this.db.prepare("SELECT COUNT(*) AS count FROM users").get();
    if (count > 0) return;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (id, username, display_name, role, scope, scope_name, password_hash, active, created_at)
         VALUES (?, ?, ?, 'admin', NULL, NULL, ?, 1, ?)`,
      )
      .run("usr-admin", "admin", "Quản trị Cấp Tỉnh", hashPassword("Admin@2025"), now);

    if (!this.seedDemo) return;
    const samples = [
      {
        id: "fb-demo-1",
        fullName: "Nguyễn Văn Minh",
        phone: "0905123456",
        email: "minh.nguyen@example.com",
        category: "ho_tro",
        wardId: "nt_nhatrang",
        wardName: "Phường Nha Trang",
        hamlet: "Tổ dân phố 1",
        lat: 12.2451,
        lng: 109.1943,
        address: "12 Trần Phú, phường Nha Trang",
        reason: "Điểm phát cơm miễn phí cho người lao động khó khăn, hoạt động 10h–12h hằng ngày.",
      },
      {
        id: "fb-demo-2",
        fullName: "Trần Thị Hoa",
        phone: "0912345678",
        email: "hoa.tran@example.com",
        category: "nhu_cau",
        wardId: "cr_camlinh",
        wardName: "Phường Cam Linh",
        hamlet: "Tổ dân phố 1",
        lat: 11.9214,
        lng: 109.1598,
        address: "Khu dân cư Cam Linh 1",
        reason: "Cần hỗ trợ sách vở và đồ dùng học tập cho 20 em nhỏ có hoàn cảnh khó khăn trước năm học mới.",
      },
    ];
    for (const sample of samples) {
      this.insertFeedback({
        ...sample,
        status: "pending",
        submittedFrom: "seed",
        history: [{ at: now, action: "submitted", by: sample.fullName }],
        createdAt: now,
      });
    }
  }

  /* --------------------------------- Users --------------------------------- */

  findUserByUsername(username) {
    const name = String(username || "").trim().toLowerCase();
    if (!name) return null;
    return this.db.prepare("SELECT * FROM users WHERE username = ?").get(name) || null;
  }

  findUserById(id) {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
  }

  /** Danh sách cán bộ để trang thông báo hiển thị người phụ trách (không kèm hash). */
  listUsers() {
    return this.db.prepare("SELECT * FROM users ORDER BY created_at").all().map(rowToUser);
  }

  touchLogin(id) {
    this.db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  /* ------------------------------- Feedbacks -------------------------------- */

  /** Thêm phản hồi mới. `feedback` theo đúng cấu trúc buildFeedback() trả về. */
  insertFeedback(feedback) {
    const now = new Date().toISOString();
    const createdAt = feedback.createdAt || now;
    const { lat, lng, deviceId, clientIp, wardName, ...rest } = feedback;
    const payload = { ...rest, wardName, submittedFrom: rest.submittedFrom || "web" };
    delete payload.passwordHash;

    this.db
      .prepare(
        `INSERT INTO feedbacks
           (id, full_name, phone, email, category, ward_id, ward_name, hamlet, status,
            review_note, reviewed_at, lat, lng, device_id, client_ip, created_at, updated_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        feedback.id,
        feedback.fullName,
        feedback.phone,
        feedback.email || "",
        feedback.category,
        feedback.wardId,
        wardName || "",
        feedback.hamlet || "",
        feedback.status || "pending",
        feedback.reviewNote || "",
        feedback.reviewedAt || null,
        Number.isFinite(Number(lat)) ? Number(lat) : null,
        Number.isFinite(Number(lng)) ? Number(lng) : null,
        deviceId || null,
        clientIp || null,
        createdAt,
        feedback.updatedAt || createdAt,
        JSON.stringify(payload),
      );
    return this.getFeedback(feedback.id);
  }

  getFeedback(id) {
    return rowToFeedback(this.db.prepare("SELECT * FROM feedbacks WHERE id = ?").get(id));
  }

  /**
   * @param {{ status?: string, wardId?: string, deviceId?: string, limit?: number }} [filter]
   */
  listFeedbacks(filter = {}) {
    const where = [];
    const params = [];
    if (filter.status && filter.status !== "all") {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.wardId) {
      where.push("ward_id = ?");
      params.push(filter.wardId);
    }
    if (filter.deviceId) {
      where.push("device_id = ?");
      params.push(filter.deviceId);
    }
    const limit = Math.min(Math.max(Number(filter.limit) || 200, 1), 1000);
    const sql = `SELECT * FROM feedbacks ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                 ORDER BY created_at DESC LIMIT ?`;
    return this.db.prepare(sql).all(...params, limit).map(rowToFeedback);
  }

  countByStatus() {
    const rows = this.db.prepare("SELECT status, COUNT(*) AS count FROM feedbacks GROUP BY status").all();
    const counts = { all: 0, pending: 0, approved: 0, rejected: 0 };
    for (const row of rows) {
      counts[row.status] = Number(row.count);
      counts.all += Number(row.count);
    }
    return counts;
  }

  /**
   * Cập nhật trạng thái phản hồi (xác nhận / từ chối), ghi vào lịch sử trong `data`.
   * @param {string} id
   * @param {{ status: "approved" | "rejected", by: string, note?: string, now?: string }} change
   */
  setStatus(id, { status, by, note = "", now = new Date().toISOString() }) {
    const row = this.db.prepare("SELECT * FROM feedbacks WHERE id = ?").get(id);
    if (!row) return null;
    const extra = safeJson(row.data);
    const history = Array.isArray(extra.history) ? extra.history : [];
    const nextHistory = [...history, { at: now, action: status, by, note }].slice(-50);

    this.db
      .prepare(
        `UPDATE feedbacks
            SET status = ?, review_note = ?, reviewed_at = ?, updated_at = ?, data = ?
          WHERE id = ?`,
      )
      .run(
        status,
        note,
        now,
        now,
        JSON.stringify({ ...extra, reviewNote: note, history: nextHistory }),
        id,
      );
    return this.getFeedback(id);
  }

  feedbackIdsOfDevice(deviceId) {
    if (!deviceId) return [];
    return this.db
      .prepare("SELECT id FROM feedbacks WHERE device_id = ? ORDER BY created_at DESC")
      .all(deviceId)
      .map((row) => row.id);
  }

  close() {
    try {
      this.db.close();
    } catch {
      /* đã đóng */
    }
  }
}
