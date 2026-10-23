/**
 * DataStore lưu bằng SQLite (cho bản web — server.js).
 *
 * Giữ NGUYÊN toàn bộ nghiệp vụ của DataStore (phân quyền, validate, thông báo,
 * hạn hiển thị, chuyển mã địa bàn cũ...), chỉ thay tầng lưu trữ:
 *   - app_users        : tài khoản (cột tra cứu + JSON đầy đủ, gồm hash scrypt)
 *   - app_feedbacks    : phản hồi người dân (cột tra cứu + JSON đầy đủ)
 *   - app_collections  : regions, categories, notifications, devices, audit, meta
 *
 * Dùng module `node:sqlite` có sẵn trong Node >= 22.5 (không cần build native).
 * Mỗi lần commit ghi trong 1 transaction -> không bao giờ ghi dở dang.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DataStore, createEmptyDb } from "./data-store.js";

/** Các bộ dữ liệu lưu dạng JSON nguyên khối trong app_collections. */
const COLLECTIONS = Object.freeze(["regions", "categories", "notifications", "devices", "audit", "meta", "version"]);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_users (
    id        TEXT PRIMARY KEY,
    pos       INTEGER NOT NULL,
    username  TEXT NOT NULL UNIQUE,
    role      TEXT NOT NULL,
    scope     TEXT,
    active    INTEGER NOT NULL DEFAULT 1,
    data      TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_feedbacks (
    id          TEXT PRIMARY KEY,
    pos         INTEGER NOT NULL,
    ward_id     TEXT,
    status      TEXT NOT NULL,
    category    TEXT,
    device_id   TEXT,
    lat         REAL,
    lng         REAL,
    created_at  TEXT,
    data        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_app_feedbacks_ward   ON app_feedbacks(ward_id);
  CREATE INDEX IF NOT EXISTS idx_app_feedbacks_status ON app_feedbacks(status);
  CREATE INDEX IF NOT EXISTS idx_app_feedbacks_device ON app_feedbacks(device_id);
  CREATE TABLE IF NOT EXISTS app_collections (
    name  TEXT PRIMARY KEY,
    data  TEXT NOT NULL
  );
`;

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export class SqliteDataStore extends DataStore {
  /**
   * @param {string} filePath đường dẫn file .db (hoặc ":memory:")
   * @param {ConstructorParameters<typeof DataStore>[1] & { importJsonPath?: string }} [options]
   */
  constructor(filePath, options = {}) {
    // DataStore gọi load() trong super(); biến tạm chỉ tồn tại trong constructor đồng bộ.
    SqliteDataStore.pendingImport = options.importJsonPath || "";
    super(filePath, options);
    SqliteDataStore.pendingImport = "";
  }

  /** Kết nối SQLite (mở lần đầu khi cần). */
  sql() {
    if (!this.sqlite) {
      if (this.filePath !== ":memory:") mkdirSync(dirname(this.filePath), { recursive: true });
      this.sqlite = new DatabaseSync(this.filePath);
      this.sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
      this.sqlite.exec(SCHEMA);
    }
    return this.sqlite;
  }

  isEmpty() {
    const db = this.sql();
    const users = db.prepare("SELECT COUNT(*) AS n FROM app_users").get().n;
    const meta = db.prepare("SELECT COUNT(*) AS n FROM app_collections WHERE name = 'meta'").get().n;
    return Number(users) === 0 && Number(meta) === 0;
  }

  /** Đọc toàn bộ DB ra object cùng cấu trúc db.json của bản desktop. */
  readAll() {
    const db = this.sql();
    const parsed = {
      users: db.prepare("SELECT data FROM app_users ORDER BY pos").all().map((row) => parseJson(row.data, null)).filter(Boolean),
      feedbacks: db.prepare("SELECT data FROM app_feedbacks ORDER BY pos").all().map((row) => parseJson(row.data, null)).filter(Boolean),
    };
    for (const row of db.prepare("SELECT name, data FROM app_collections").all()) {
      parsed[row.name] = parseJson(row.data, undefined);
    }
    return parsed;
  }

  load() {
    const importPath = SqliteDataStore.pendingImport || "";
    if (this.isEmpty()) {
      // DB trống: nhập dữ liệu desktop (db.json) nếu được chỉ định, ngược lại seed mới.
      if (importPath && existsSync(importPath)) {
        const parsed = parseJson(readFileSync(importPath, "utf8") || "{}", {});
        const db = this.normalize(parsed);
        this.persist(db);
        this.importedFrom = importPath;
        return db;
      }
      const fresh = createEmptyDb();
      fresh.meta.createdAt = this.now();
      return super.seed(fresh);
    }
    return this.normalize(this.readAll());
  }

  /** Ghi toàn bộ trạng thái trong 1 transaction (thay cho ghi file JSON). */
  persist(next = this.db) {
    const db = this.sql();
    const insertUser = db.prepare(
      "INSERT INTO app_users (id, pos, username, role, scope, active, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const insertFeedback = db.prepare(
      `INSERT INTO app_feedbacks (id, pos, ward_id, status, category, device_id, lat, lng, created_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const upsertCollection = db.prepare(
      "INSERT INTO app_collections (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data",
    );
    const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM app_users; DELETE FROM app_feedbacks;");
      (next.users || []).forEach((user, index) => {
        insertUser.run(
          String(user.id),
          index,
          String(user.username),
          String(user.role || "ward"),
          user.scope ?? null,
          user.active === false ? 0 : 1,
          JSON.stringify(user),
        );
      });
      (next.feedbacks || []).forEach((item, index) => {
        insertFeedback.run(
          String(item.id),
          index,
          item.wardId ?? null,
          String(item.status || "pending"),
          item.category ?? null,
          item.deviceId ?? null,
          num(item.lat),
          num(item.lng),
          item.createdAt ?? null,
          JSON.stringify(item),
        );
      });
      for (const name of COLLECTIONS) {
        if (next[name] !== undefined) upsertCollection.run(name, JSON.stringify(next[name]));
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Thay toàn bộ dữ liệu bằng nội dung một file db.json (script nhập dữ liệu desktop). */
  replaceFromJson(jsonPath) {
    const parsed = parseJson(readFileSync(jsonPath, "utf8") || "{}", null);
    if (!parsed || !Array.isArray(parsed.users)) throw new Error(`File không đúng định dạng db.json: ${jsonPath}`);
    const db = this.normalize(parsed);
    this.db = db;
    this.persist(db);
    this.emit();
    return { users: db.users.length, feedbacks: db.feedbacks.length, categories: db.categories.length };
  }

  close() {
    try {
      this.sqlite?.close();
    } catch {
      /* đã đóng */
    }
    this.sqlite = null;
  }
}
