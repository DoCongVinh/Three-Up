/**
 * Kho dữ liệu JSON cục bộ cho ứng dụng desktop.
 *
 * - Toàn bộ dữ liệu nằm trong 1 file JSON (db.json) trong thư mục userData.
 * - Ghi an toàn: ghi file tạm rồi rename, giữ thêm db.json.bak.
 * - Mật khẩu lưu dưới dạng hash scrypt (salt riêng mỗi tài khoản).
 * - Serve được trong main process (Electron) và trong unit test (Node thuần).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  DISPLAY_DAYS_DEFAULT,
  extendDisplay as extendDisplayHelper,
  initialDisplay,
  makePermanent as makePermanentHelper,
} from "./notifications.js";
import {
  approximateLocationFromIp,
  createDevice,
  hashDeviceToken,
  isDeviceExpired,
  maskIp,
  normalizeIp,
} from "./devices.js";
import { canReview } from "./data-model.js";
import {
  CATEGORIES,
  FEEDBACK_STATUS,
  ROLE_ADMIN,
  ROLE_WARD,
  ADMINISTRATIVE_UNITS,
  buildFeedback,
  buildScopedId,
  buildWardKey,
  createId,
  findWardInUnits,
  normalizeText,
  sanitizeText,
  setFeedbackStatus,
  toPublicUser,
  validateNewAccount,
  validatePassword,
} from "./data-model.js";

export const DB_VERSION = 1;
export const DEFAULT_ADMIN = Object.freeze({ username: "admin", displayName: "Quản trị Cấp Tỉnh" });

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

/* --------------------------------- Store ---------------------------------- */

/**
 * Bảng chuyển mã địa bàn của phiên bản danh mục cũ (trước sáp nhập) sang mã mới.
 * Chỉ dùng khi nạp db.json cũ — bảo toàn tài khoản và phản hồi đã có.
 */
export const LEGACY_WARD_MAP = Object.freeze({
  // ---- Danh mục 16 đơn vị (bản trước) -> danh mục 65 đơn vị ----
  p_nha_trang: { wardId: "nt_nhatrang", hamlet: "Tổ dân phố 1" },
  p_bac_nha_trang: { wardId: "nt_bacnhatrang", hamlet: "Tổ dân phố 1" },
  p_tay_nha_trang: { wardId: "nt_taynhatrang", hamlet: "Tổ dân phố 1" },
  p_nam_nha_trang: { wardId: "nt_namnhatrang", hamlet: "Tổ dân phố 1" },
  cr_camlinh: { wardId: "cr_camlinh", hamlet: "Tổ dân phố 1" },
  p_cam_ranh: { wardId: "cr_camranh", hamlet: "Tổ dân phố 1" },
  p_bac_cam_ranh: { wardId: "cr_baccamranh", hamlet: "Tổ dân phố 1" },
  cr_bangoi: { wardId: "cr_bangoi", hamlet: "Tổ dân phố 1" },
  x_nam_cam_ranh: { wardId: "cr_namcamranh", hamlet: "Thôn 1" },
  p_ninh_hoa: { wardId: "nh_ninhhoa", hamlet: "Tổ dân phố 1" },
  p_dong_ninh_hoa: { wardId: "nh_dongninhhoa", hamlet: "Tổ dân phố 1" },
  p_hoa_thang: { wardId: "nh_hoathang", hamlet: "Tổ dân phố 1" },
  x_bac_ninh_hoa: { wardId: "nh_bacninhhoa", hamlet: "Thôn 1" },
  cl_camlam: { wardId: "cl_camlam", hamlet: "Thôn 1" },
  x_suoi_dau: { wardId: "cl_suoidau", hamlet: "Thôn 1" },
  dk_truong_sa: { wardId: "ts_truongsa", hamlet: "Đặc khu Trường Sa" },

  // ---- Danh mục rất cũ (trước sáp nhập) ----
  nt_loc_tho: { wardId: "nt_nhatrang", hamlet: "Tổ dân phố 1" },
  nt_tan_lap: { wardId: "nt_nhatrang", hamlet: "Tổ dân phố 2" },
  nt_vinh_nguyen: { wardId: "nt_nhatrang", hamlet: "Tổ dân phố 3" },
  nt_vinh_hai: { wardId: "nt_bacnhatrang", hamlet: "Tổ dân phố 1" },
  nt_phuoc_long: { wardId: "nt_namnhatrang", hamlet: "Tổ dân phố 1" },
  nt_vinh_thanh: { wardId: "nt_taynhatrang", hamlet: "Tổ dân phố 1" },
  cr_cam_linh: { wardId: "cr_camlinh", hamlet: "Tổ dân phố 1" },
  cr_ba_ngoi: { wardId: "cr_bangoi", hamlet: "Tổ dân phố 1" },
  cr_cam_phu: { wardId: "cr_camranh", hamlet: "Tổ dân phố 1" },
  cr_cam_nghia: { wardId: "cr_baccamranh", hamlet: "Tổ dân phố 1" },
  cr_cam_thuan: { wardId: "cr_namcamranh", hamlet: "Thôn 1" },
  cr_cam_thinh_dong: { wardId: "cr_namcamranh", hamlet: "Thôn 1" },
  cr_cam_thanh: { wardId: "cr_baccamranh", hamlet: "Tổ dân phố 1" },
  cr_cam_thanh_nam: { wardId: "cr_baccamranh", hamlet: "Tổ dân phố 1" },
  cl_cam_hai_dong: { wardId: "cl_camlam", hamlet: "Thôn 1" },
  cl_cam_duc: { wardId: "cl_camlam", hamlet: "Thôn 2" },
  cl_cam_hiep: { wardId: "cl_camhiep", hamlet: "Thôn 1" },
  cl_cam_phuoc: { wardId: "cl_suoidau", hamlet: "Thôn 1" },
  dk_dien_khanh: { wardId: "dk_dienkhanh", hamlet: "Thôn 1" },
  dk_dien_dien: { wardId: "dk_diendien", hamlet: "Thôn 1" },
  dk_dien_lam: { wardId: "dk_dienlam", hamlet: "Thôn 1" },
  dk_dien_son: { wardId: "dk_dienlam", hamlet: "Thôn 1" },
});

/**
 * Chuyển dữ liệu cũ sang mã địa bàn mới. Trả về true nếu có thay đổi
 * (để DataStore ghi lại file). Đơn vị không còn tồn tại: giữ nguyên mã cũ.
 */
export function migrateLegacyWards(db) {
  let changed = false;
  const validWards = new Set(
    db.regions.flatMap((district) => district.wards.map((ward) => ward.wardId)),
  );

  /** Đổi mã địa bàn cũ -> mới; giữ nguyên nếu mã đã hợp lệ hoặc không có bảng chuyển. */
  const remapWard = (wardId, hamlet) => {
    if (!wardId || validWards.has(wardId)) return { wardId, hamlet };
    const legacy = LEGACY_WARD_MAP[wardId];
    if (!legacy) return { wardId, hamlet };
    changed = true;
    return { wardId: legacy.wardId, hamlet: hamlet || legacy.hamlet };
  };

  db.users = db.users.map((user) => {
    if (!user.scope) return user;
    const { wardId } = remapWard(user.scope, null);
    return wardId === user.scope ? user : { ...user, scope: wardId };
  });

  db.feedbacks = db.feedbacks.map((feedback) => {
    const { wardId, hamlet } = remapWard(feedback.wardId, feedback.hamlet || null);
    if (wardId === feedback.wardId && hamlet === feedback.hamlet) return feedback;
    const district = db.regions.find((item) => item.wards.some((ward) => ward.wardId === wardId));
    return {
      ...feedback,
      wardId,
      hamlet,
      regionId: district ? district.districtId : feedback.regionId,
      wardKey: district ? buildWardKey(district.districtId, wardId) : feedback.wardKey,
    };
  });
  return changed;
}

export function createEmptyDb() {
  return {
    version: DB_VERSION,
    users: [],
    feedbacks: [],
    audit: [],
    // Danh mục đơn vị hành chính 3 tầng (district -> ward -> hamlets).
    // Nạp từ src/administrative-units.js ở lần đầu, sau đó sửa được qua giao diện.
    regions: cloneUnits(ADMINISTRATIVE_UNITS),
    // Nhóm thông tin (điểm hỗ trợ, chính sách, ... và các nhóm admin tự thêm).
    categories: Object.entries(CATEGORIES).map(([id, item]) => ({ id, ...item })),
    // Thông báo cho cán bộ Xã/Phường (khẩn cấp, phản hồi mới, nhắc duyệt).
    notifications: [],
    // Thiết bị của khách (nhận diện người dân không đăng nhập).
    devices: [],
    meta: { createdAt: new Date().toISOString() },
  };
}

/** Bản sao sâu (JSON) của danh mục mặc định để không sửa vào hằng số đã freeze. */
function cloneUnits(units) {
  return units.map((district) => ({
    districtId: district.districtId,
    districtName: district.districtName,
    shortName: district.shortName,
    // Toạ độ tâm khu vực: dùng để bản đồ bay tới và ước lượng vị trí theo IP.
    center: district.center ? { ...district.center } : undefined,
    wards: district.wards.map((ward) => ({
      wardId: ward.wardId,
      wardName: ward.wardName,
      oldUnits: ward.oldUnits,
      hamlets: [...ward.hamlets],
    })),
  }));
}

/** Phản hồi mẫu để màn quản lý có dữ liệu ngay lần đầu chạy (chỉ seed). */
function seedDemoFeedback(db, now) {
  const samples = [
    {
      fullName: "Nguyễn Văn Minh",
      phone: "0905123456",
      email: "minh.nguyen@example.com",
      address: "12 Trần Phú, phường Lộc Thọ",
      reason: "Điểm phát cơm miễn phí cho người lao động khó khăn, hoạt động 10h–12h hằng ngày.",
      category: "ho_tro",
      wardId: "p_nha_trang",
      hamlet: "Tổ 2 Lộc Thọ",
      lat: 12.2451,
      lng: 109.1943,
      images: [],
    },
    {
      fullName: "Trần Thị Hoa",
      phone: "0912345678",
      email: "hoa.tran@example.com",
      address: "Khu dân cư Cam Linh 2",
      reason: "Cần hỗ trợ sách vở và đồ dùng học tập cho 20 em nhỏ có hoàn cảnh khó khăn trước năm học mới.",
      category: "nhu_cau",
      wardId: "cr_camlinh",
      hamlet: "Tổ dân phố 2",
      lat: 11.9214,
      lng: 109.1598,
      images: [],
    },
    {
      fullName: "Lê Quốc Bảo",
      phone: "0987654321",
      email: "bao.le@example.com",
      address: "Tổ dân phố 5, thị trấn Diên Khánh",
      reason: "Đầu mối tiếp nhận thông tin hỗ trợ khẩn cấp khi có bão lũ tại địa phương.",
      category: "khan_cap",
      wardId: "p_ninh_hoa",
      hamlet: "Tổ 1 Ninh Hiệp",
      lat: 12.2583,
      lng: 109.0911,
      images: [],
    },
  ];
  for (const sample of samples) {
    const result = buildFeedback(sample, { id: createId("fb"), now });
    if (result.ok) db.feedbacks.push(result.feedback);
  }
}

export class DataStore {
  /**
   * @param {string} filePath đường dẫn db.json
   * @param {{ seedAdminPassword?: string, now?: () => string }} [options]
   */
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.now = options.now || (() => new Date().toISOString());
    this.seedAdminPassword = options.seedAdminPassword || "Admin@2025";
    this.allowSeed = options.allowSeed !== false;
    this.seedFeedback = options.seedFeedback !== false;
    this.listeners = new Set();
    this.seeded = false;
    this.db = this.load();
  }

  /* ------------------------------- Persistence ------------------------------ */

  load() {
    if (!existsSync(this.filePath)) {
      const fresh = createEmptyDb();
      fresh.meta.createdAt = this.now();
      return this.seed(fresh);
    }
    const raw = readFileSync(this.filePath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw || "{}");
    } catch (error) {
      // File hỏng: giữ bản sao để người dùng khôi phục, rồi tạo DB mới.
      try {
        copyFileSync(this.filePath, `${this.filePath}.corrupted-${Date.now()}.json`);
      } catch {
        /* không chặn khởi động nếu không sao chép được */
      }
      const fresh = createEmptyDb();
      return this.seed(fresh);
    }
    return this.normalize(parsed);
  }

  normalize(parsed) {
    const base = createEmptyDb();
    const db = {
      ...base,
      ...parsed,
      users: Array.isArray(parsed.users) ? parsed.users : [],
      feedbacks: Array.isArray(parsed.feedbacks) ? parsed.feedbacks : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
      // DB cũ không có `regions`/`categories` -> nạp danh mục mặc định.
      regions: Array.isArray(parsed.regions) && parsed.regions.length ? parsed.regions : base.regions,
      categories: Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories : base.categories,
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      meta: { ...base.meta, ...(parsed.meta || {}) },
      version: DB_VERSION,
    };
    // Nếu DB lưu danh mục KHÁC với seed mặc định (bản cũ) -> dùng danh mục mới,
    // nhưng giữ lại các đơn vị admin tự thêm (không thuộc seed).
    let touched = false;
    const seedDistrictIds = new Set(ADMINISTRATIVE_UNITS.map((unit) => unit.districtId));
    const seedWardIds = new Set(ADMINISTRATIVE_UNITS.flatMap((unit) => unit.wards.map((ward) => ward.wardId)));
    const storedWardCount = (parsed.regions || []).reduce((sum, district) => sum + (district.wards || []).length, 0);
    const seedWardCount = seedWardIds.size;

    if (storedWardCount && storedWardCount !== seedWardCount) {
      // Ghép: lấy seed làm gốc, chèn thêm đơn vị admin tự tạo (không có trong seed).
      db.regions = ADMINISTRATIVE_UNITS.map((district) => {
        const stored = (parsed.regions || []).find((item) => item.districtId === district.districtId);
        const customWards = stored
          ? (stored.wards || []).filter(
              (ward) =>
                !seedWardIds.has(ward.wardId) &&
                !LEGACY_WARD_MAP[ward.wardId] &&
                // Đơn vị do admin tự thêm có mã sinh bằng createId("w") dạng "w-...".
                /^w-/.test(ward.wardId || ""),
            )
          : [];
        return {
          districtId: district.districtId,
          districtName: district.districtName,
          shortName: district.shortName,
          center: district.center ? { ...district.center } : undefined,
          wards: [
            ...district.wards.map((ward) => ({
              wardId: ward.wardId,
              wardName: ward.wardName,
              oldUnits: ward.oldUnits,
              hamlets: [...ward.hamlets],
            })),
            ...customWards.map((ward) => ({ ...ward })),
          ],
        };
      });
      touched = true;
    }

    // Đồng bộ tên khu vực + tâm huyện nếu thiếu.
    db.regions = db.regions.map((district) => {
      const seed = ADMINISTRATIVE_UNITS.find((unit) => unit.districtId === district.districtId);
      if (!seed) return district;
      const next = { ...district };
      if (!next.wards) next.wards = [];
      if (!next.districtName) next.districtName = seed.districtName;
      if (!next.center && seed.center) next.center = { ...seed.center };
      if (next.districtName !== district.districtName || next.center !== district.center) touched = true;
      return next;
    });
    // Đơn vị admin tự thêm vào nhóm không có trong seed vẫn được giữ.
    for (const stored of parsed.regions || []) {
      if (seedDistrictIds.has(stored.districtId)) continue;
      if (!db.regions.some((item) => item.districtId === stored.districtId)) {
        db.regions.push(stored);
        touched = true;
      }
    }

    const migrated = migrateLegacyWards(db);
    if (migrated || touched) this.persist(db);
    return db;
  }

  /** Danh mục đơn vị hành chính đang dùng (3 tầng). */
  regions() {
    return this.db.regions;
  }

  /** Nhóm thông tin đang dùng (mảng {id,label,icon,color}). */
  categories() {
    return this.db.categories;
  }

  /* ----------------------------- Nhóm thông tin -------------------------------- */

  /** Tạo id từ nhãn tiếng Việt: "Người khuyết tật" -> "nguoi_khuyet_tat". */
  static slugifyCategory(label) {
    const map = { đ: "d", Đ: "d" };
    return String(label || "")
      .replace(/[đĐ]/g, (char) => map[char])
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase()
      .slice(0, 40);
  }

  createCategory({ actor, label, icon = "📍", color = "#0f766e" }) {
    if (!actor || actor.role !== ROLE_ADMIN) return { ok: false, errors: ["Chỉ Cấp Tỉnh được quản lý nhóm thông tin."] };
    const name = sanitizeText(label, 60);
    if (name.length < 2) return { ok: false, errors: ["Tên nhóm phải có ít nhất 2 ký tự."] };
    if (!/^#[0-9a-f]{6}$/i.test(color)) return { ok: false, errors: ["Mã màu phải dạng #RRGGBB."] };
    if (this.db.categories.some((item) => item.label.toLowerCase() === name.toLowerCase())) {
      return { ok: false, errors: ["Nhóm thông tin này đã tồn tại."] };
    }
    let id = DataStore.slugifyCategory(name) || createId("cat");
    if (!id || this.db.categories.some((item) => item.id === id)) id = createId("cat");

    const category = { id, label: name, icon: sanitizeText(icon, 8) || "📍", color };
    const next = { ...this.db, categories: [...this.db.categories, category] };
    next.audit = [...this.db.audit, { at: this.now(), action: "add-category", by: actor.username, detail: id }].slice(-500);
    this.commit(next);
    return { ok: true, category, categories: next.categories };
  }

  updateCategory({ actor, categoryId, label, icon, color }) {
    if (!actor || actor.role !== ROLE_ADMIN) return { ok: false, errors: ["Chỉ Cấp Tỉnh được quản lý nhóm thông tin."] };
    const current = this.db.categories.find((item) => item.id === categoryId);
    if (!current) return { ok: false, errors: ["Không tìm thấy nhóm thông tin."] };
    const name = sanitizeText(label ?? current.label, 60);
    if (name.length < 2) return { ok: false, errors: ["Tên nhóm phải có ít nhất 2 ký tự."] };
    if (this.db.categories.some((item) => item.id !== categoryId && item.label.toLowerCase() === name.toLowerCase())) {
      return { ok: false, errors: ["Tên nhóm đã tồn tại."] };
    }
    const nextColor = color || current.color;
    if (!/^#[0-9a-f]{6}$/i.test(nextColor)) return { ok: false, errors: ["Mã màu phải dạng #RRGGBB."] };
    const next = {
      ...this.db,
      categories: this.db.categories.map((item) =>
        item.id === categoryId
          ? { ...item, label: name, icon: sanitizeText(icon ?? item.icon, 8) || "📍", color: nextColor }
          : item,
      ),
    };
    next.audit = [...this.db.audit, { at: this.now(), action: "update-category", by: actor.username, detail: categoryId }].slice(-500);
    this.commit(next);
    return { ok: true, categories: next.categories };
  }

  /** Xoá nhóm — chặn nếu đang được dùng bởi phản hồi nào (tránh dữ liệu mồ côi). */
  deleteCategory({ actor, categoryId }) {
    if (!actor || actor.role !== ROLE_ADMIN) return { ok: false, errors: ["Chỉ Cấp Tỉnh được quản lý nhóm thông tin."] };
    if (!this.db.categories.some((item) => item.id === categoryId)) {
      return { ok: false, errors: ["Không tìm thấy nhóm thông tin."] };
    }
    if (this.db.categories.length <= 1) return { ok: false, errors: ["Phải còn ít nhất một nhóm thông tin."] };
    const used = this.db.feedbacks.filter((item) => item.category === categoryId).length;
    if (used) return { ok: false, errors: [`Không thể xoá: có ${used} phản hồi đang dùng nhóm này.`] };
    const next = { ...this.db, categories: this.db.categories.filter((item) => item.id !== categoryId) };
    next.audit = [...this.db.audit, { at: this.now(), action: "delete-category", by: actor.username, detail: categoryId }].slice(-500);
    this.commit(next);
    return { ok: true, categories: next.categories };
  }

  persist(next = this.db) {
    const dir = join(this.filePath, "..");
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
    if (existsSync(this.filePath)) {
      try {
        copyFileSync(this.filePath, `${this.filePath}.bak`);
      } catch {
        /* bỏ qua lỗi sao lưu */
      }
    }
    renameSync(tmp, this.filePath);
  }

  commit(next) {
    next.meta.updatedAt = this.now();
    this.db = next;
    this.persist(next);
    this.emit();
    return next;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* listener lỗi không được làm hỏng luồng ghi */
      }
    }
  }

  seed(db) {
    if (!this.allowSeed) {
      this.seeded = false;
      this.db = db;
      this.persist(db);
      return db;
    }
    const now = this.now();
    db.users.push({
      id: createId("usr"),
      username: DEFAULT_ADMIN.username,
      displayName: DEFAULT_ADMIN.displayName,
      role: ROLE_ADMIN,
      scope: null,
      passwordHash: hashPassword(this.seedAdminPassword),
      active: true,
      createdAt: now,
      createdBy: "system",
      mustChangePassword: true,
    });
    db.audit.push({ at: now, action: "seed-admin", by: "system", detail: DEFAULT_ADMIN.username });
    if (this.seedFeedback) seedDemoFeedback(db, now);
    this.seeded = true;
    return this.commit(db);
  }

  addAudit(action, by, detail) {
    this.db.audit.push({ at: this.now(), action, by, detail });
    if (this.db.audit.length > 500) this.db.audit.splice(0, this.db.audit.length - 500);
  }

  /* --------------------------------- Users --------------------------------- */

  publicUsers() {
    return this.db.users.map(toPublicUser);
  }

  findUser(username) {
    const normalized = normalizeText(username).toLowerCase();
    return this.db.users.find((user) => user.username === normalized) || null;
  }

  /** Xác thực đăng nhập; trả về user công khai hoặc lỗi chung (không lộ tài khoản tồn tại). */
  authenticate(username, password) {
    const user = this.findUser(username);
    const ok = user && user.active !== false && verifyPassword(password, user.passwordHash);
    if (!ok) {
      this.addAudit("login-failed", normalizeText(username).toLowerCase() || "unknown");
      this.persist(this.db);
      return { ok: false, error: "Tên đăng nhập hoặc mật khẩu không đúng." };
    }
    this.addAudit("login", user.username);
    this.persist(this.db);
    return { ok: true, user: toPublicUser(user) };
  }

  /** Tạo tài khoản cán bộ xã/phường (chỉ admin được gọi, kiểm tra ở IPC/service). */
  createWardAccount({ actor, ...input }) {
    if (!actor || actor.role !== ROLE_ADMIN) {
      return { ok: false, errors: ["Chỉ tài khoản Cấp Tỉnh được tạo tài khoản."] };
    }
    const check = validateNewAccount(input, this.publicUsers(), { units: this.db.regions });
    if (!check.ok) return { ok: false, errors: check.errors };

    const now = this.now();
    // Khoá chính dạng {districtId}_{wardId}_{timestamp} — không trùng giữa các địa bàn
    // và giữa nhiều lần tạo trong cùng mili-giây (timestamp base36).
    const scopedId = buildScopedId(check.value.districtId, check.value.scope, Date.parse(now) || Date.now());
    const user = {
      id: scopedId,
      username: check.value.username,
      displayName: check.value.displayName,
      role: ROLE_WARD,
      scope: check.value.scope,
      scopeKey: check.value.scopeKey || null,
      scopeDistrict: check.value.districtId || null,
      passwordHash: hashPassword(check.value.password),
      active: true,
      createdAt: now,
      createdBy: actor.username,
      mustChangePassword: input.mustChangePassword !== false,
    };
    const next = { ...this.db, users: [...this.db.users, user] };
    next.audit = [
      ...this.db.audit,
      { at: now, action: "create-account", by: actor.username, detail: `${user.username} -> ${user.scope}` },
    ].slice(-500);
    this.commit(next);
    return { ok: true, user: toPublicUser(user) };
  }

  setUserActive({ actor, userId, active }) {
    if (!actor || actor.role !== ROLE_ADMIN) {
      return { ok: false, errors: ["Chỉ tài khoản Cấp Tỉnh được khóa/mở tài khoản."] };
    }
    const target = this.db.users.find((user) => user.id === userId);
    if (!target) return { ok: false, errors: ["Không tìm thấy tài khoản."] };
    if (target.role === ROLE_ADMIN && !active) {
      return { ok: false, errors: ["Không thể khóa tài khoản Cấp Tỉnh."] };
    }
    const next = {
      ...this.db,
      users: this.db.users.map((user) => (user.id === userId ? { ...user, active: Boolean(active) } : user)),
    };
    next.audit = [...this.db.audit, { at: this.now(), action: active ? "unlock-account" : "lock-account", by: actor.username, detail: target.username }].slice(-500);
    this.commit(next);
    return { ok: true, user: toPublicUser(next.users.find((user) => user.id === userId)) };
  }

  changePassword({ actor, oldPassword, newPassword }) {
    const user = this.db.users.find((item) => item.id === actor?.id);
    if (!user) return { ok: false, errors: ["Phiên đăng nhập không hợp lệ."] };
    if (!verifyPassword(oldPassword, user.passwordHash)) {
      return { ok: false, errors: ["Mật khẩu hiện tại không đúng."] };
    }
    const check = validatePassword(newPassword);
    if (!check.ok) return { ok: false, errors: check.errors };
    if (verifyPassword(newPassword, user.passwordHash)) {
      return { ok: false, errors: ["Mật khẩu mới phải khác mật khẩu hiện tại."] };
    }
    const next = {
      ...this.db,
      users: this.db.users.map((item) =>
        item.id === user.id
          ? { ...item, passwordHash: hashPassword(newPassword), mustChangePassword: false, passwordChangedAt: this.now() }
          : item,
      ),
    };
    next.audit = [...this.db.audit, { at: this.now(), action: "change-password", by: user.username }].slice(-500);
    this.commit(next);
    return { ok: true };
  }

  /* ------------------------- Quản lý tài khoản (admin) ------------------------- */

  /**
   * Admin đặt lại mật khẩu cho 1 cán bộ (không cần biết mật khẩu cũ).
   * Mật khẩu được hash scrypt trước khi ghi DB; mặc định bắt đổi ở lần sau.
   */
  resetUserPassword({ actor, userId, newPassword, mustChangePassword = true }) {
    if (!actor || actor.role !== ROLE_ADMIN) {
      return { ok: false, errors: ["Chỉ Cấp Tỉnh được đặt lại mật khẩu."] };
    }
    const target = this.db.users.find((user) => user.id === userId);
    if (!target) return { ok: false, errors: ["Không tìm thấy tài khoản."] };
    const check = validatePassword(newPassword);
    if (!check.ok) return { ok: false, errors: check.errors };

    const now = this.now();
    const next = {
      ...this.db,
      users: this.db.users.map((user) =>
        user.id === userId
          ? {
              ...user,
              passwordHash: hashPassword(newPassword),
              mustChangePassword: Boolean(mustChangePassword),
              passwordChangedAt: now,
              passwordResetBy: actor.username,
            }
          : user,
      ),
    };
    next.audit = [
      ...this.db.audit,
      { at: now, action: "reset-password", by: actor.username, detail: target.username },
    ].slice(-500);
    this.commit(next);
    return {
      ok: true,
      user: toPublicUser(next.users.find((user) => user.id === userId)),
      mustChangePassword: Boolean(mustChangePassword),
    };
  }

  /**
   * Admin sửa thông tin cán bộ: họ tên và/hoặc địa bàn (khi thay đổi nhân sự).
   * Đổi địa bàn sẽ chuyển luôn phạm vi duyệt phản hồi của cán bộ đó.
   */
  updateWardAccount({ actor, userId, displayName, scope }) {
    if (!actor || actor.role !== ROLE_ADMIN) {
      return { ok: false, errors: ["Chỉ Cấp Tỉnh được sửa tài khoản."] };
    }
    const target = this.db.users.find((user) => user.id === userId);
    if (!target) return { ok: false, errors: ["Không tìm thấy tài khoản."] };
    if (target.role !== ROLE_WARD) {
      return { ok: false, errors: ["Chỉ sửa được tài khoản cán bộ Xã/Phường."] };
    }

    const name = sanitizeText(displayName ?? target.displayName, 80);
    if (name.length < 3) return { ok: false, errors: ["Họ tên cán bộ phải có ít nhất 3 ký tự."] };

    const nextScope = scope ? normalizeText(scope) : target.scope;
    const ward = findWardInUnits(this.db.regions, nextScope);
    if (!ward) return { ok: false, errors: ["Phường/Xã không hợp lệ."] };

    // Cùng địa bàn + cùng họ tên với người khác -> trùng, chặn lại.
    const duplicated = this.db.users.some(
      (user) => user.id !== userId && user.scope === nextScope && user.displayName === name,
    );
    if (duplicated) return { ok: false, errors: ["Đã có cán bộ cùng họ tên phụ trách phường/xã này."] };

    const scopeChanged = target.scope !== nextScope;
    const now = this.now();
    const next = {
      ...this.db,
      users: this.db.users.map((user) =>
        user.id === userId
          ? {
              ...user,
              displayName: name,
              scope: nextScope,
              scopeKey: buildWardKey(ward.regionId, ward.id),
              scopeDistrict: ward.regionId,
              updatedAt: now,
            }
          : user,
      ),
    };
    next.audit = [
      ...this.db.audit,
      {
        at: now,
        action: "update-account",
        by: actor.username,
        detail: `${target.username}${scopeChanged ? ` -> ${nextScope}` : ""}`,
      },
    ].slice(-500);
    this.commit(next);
    return {
      ok: true,
      user: toPublicUser(next.users.find((user) => user.id === userId)),
      scopeChanged,
    };
  }

  /* ----------------------------- Đơn vị hành chính ------------------------------ */

  /** Số phản hồi / tài khoản đang gắn với một phường/xã (để chặn xoá). */
  usageOfWard(wardId) {
    return {
      accounts: this.db.users.filter((user) => user.scope === wardId).length,
      feedbacks: this.db.feedbacks.filter((item) => item.wardId === wardId).length,
    };
  }

  usageOfDistrict(districtId) {
    const district = this.db.regions.find((item) => item.districtId === districtId);
    const wardIds = new Set(district ? district.wards.map((ward) => ward.wardId) : []);
    return {
      accounts: this.db.users.filter((user) => wardIds.has(user.scope)).length,
      feedbacks: this.db.feedbacks.filter((item) => wardIds.has(item.wardId)).length,
      wards: wardIds.size,
    };
  }

  /** Thêm một Phường/Xã vào huyện đã có. */
  createWard({ actor, districtId, wardName, oldUnits = "", hamlets = [] }) {
    if (!actor || actor.role !== ROLE_ADMIN) return { ok: false, errors: ["Chỉ Cấp Tỉnh được thêm đơn vị."] };
    const district = this.db.regions.find((item) => item.districtId === districtId);
    if (!district) return { ok: false, errors: ["Không tìm thấy Thành phố/Huyện."] };
    const name = sanitizeText(wardName, 120);
    if (name.length < 3) return { ok: false, errors: ["Tên Phường/Xã phải có ít nhất 3 ký tự."] };
    if (district.wards.some((ward) => ward.wardName.toLowerCase() === name.toLowerCase())) {
      return { ok: false, errors: ["Tên Phường/Xã đã tồn tại trong huyện này."] };
    }
    const cleanHamlets = hamlets.map((item) => sanitizeText(item, 80)).filter(Boolean);
    if (!cleanHamlets.length) return { ok: false, errors: ["Cần ít nhất một Thôn/Tổ dân phố."] };

    const ward = {
      wardId: createId("w"),
      wardName: name,
      oldUnits: sanitizeText(oldUnits, 300),
      hamlets: [...new Set(cleanHamlets)],
    };
    const next = {
      ...this.db,
      regions: this.db.regions.map((item) =>
        item.districtId === districtId ? { ...item, wards: [...item.wards, ward] } : item,
      ),
    };
    next.audit = [...this.db.audit, { at: this.now(), action: "add-ward", by: actor.username, detail: `${districtId}/${ward.wardId}` }].slice(-500);
    this.commit(next);
    return { ok: true, ward, regions: next.regions };
  }

  /** Sửa tên / tên cũ / danh sách thôn-tổ dân phố của phường/xã. */
  updateWard({ actor, wardId, wardName, oldUnits, hamlets }) {
    if (!actor || actor.role !== ROLE_ADMIN) return { ok: false, errors: ["Chỉ Cấp Tỉnh được sửa đơn vị."] };
    const district = this.db.regions.find((item) => item.wards.some((ward) => ward.wardId === wardId));
    if (!district) return { ok: false, errors: ["Không tìm thấy Phường/Xã."] };

    const name = sanitizeText(wardName, 120);
    if (name.length < 3) return { ok: false, errors: ["Tên Phường/Xã phải có ít nhất 3 ký tự."] };
    if (district.wards.some((ward) => ward.wardId !== wardId && ward.wardName.toLowerCase() === name.toLowerCase())) {
      return { ok: false, errors: ["Tên Phường/Xã đã tồn tại trong huyện này."] };
    }
    const cleanHamlets = [...new Set((Array.isArray(hamlets) ? hamlets : []).map((item) => sanitizeText(item, 80)).filter(Boolean))];
    if (!cleanHamlets.length) return { ok: false, errors: ["Cần ít nhất một Thôn/Tổ dân phố."] };

    const next = {
      ...this.db,
      regions: this.db.regions.map((item) =>
        item.districtId === district.districtId
          ? {
              ...item,
              wards: item.wards.map((ward) =>
                ward.wardId === wardId
                  ? { ...ward, wardName: name, oldUnits: sanitizeText(oldUnits ?? ward.oldUnits, 300), hamlets: cleanHamlets }
                  : ward,
              ),
            }
          : item,
      ),
    };
    next.audit = [...this.db.audit, { at: this.now(), action: "update-ward", by: actor.username, detail: wardId }].slice(-500);
    this.commit(next);
    return { ok: true, regions: next.regions };
  }

  /** Xoá phường/xã — chặn nếu còn tài khoản cán bộ hoặc phản hồi thuộc đơn vị. */
  deleteWard({ actor, wardId }) {
    if (!actor || actor.role !== ROLE_ADMIN) return { ok: false, errors: ["Chỉ Cấp Tỉnh được xoá đơn vị."] };
    const district = this.db.regions.find((item) => item.wards.some((ward) => ward.wardId === wardId));
    if (!district) return { ok: false, errors: ["Không tìm thấy Phường/Xã."] };
    if (district.wards.length <= 1) {
      return { ok: false, errors: ["Không thể xoá phường/xã cuối cùng của địa bàn."] };
    }
    const usage = this.usageOfWard(wardId);
    if (usage.accounts || usage.feedbacks) {
      return {
        ok: false,
        errors: [
          `Không thể xoá: còn ${usage.accounts} tài khoản và ${usage.feedbacks} phản hồi thuộc đơn vị này. ` +
          "Hãy chuyển/khóa dữ liệu liên quan trước.",
        ],
      };
    }
    const next = {
      ...this.db,
      regions: this.db.regions.map((item) =>
        item.districtId === district.districtId
          ? { ...item, wards: item.wards.filter((ward) => ward.wardId !== wardId) }
          : item,
      ),
    };
    next.audit = [...this.db.audit, { at: this.now(), action: "delete-ward", by: actor.username, detail: wardId }].slice(-500);
    this.commit(next);
    return { ok: true, regions: next.regions };
  }

  /* -------------------------------- Feedback -------------------------------- */

  createFeedback(payload) {
    // Khoá chính: {districtId}_{wardId}_{timestamp}
    const ward = findWardInUnits(this.db.regions, payload.wardId);
    const scopedId = ward
      ? buildScopedId(ward.regionId, ward.id)
      : createId("fb");
    // Ghi nhận thiết bị + IP gửi (do main process truyền vào, renderer không tự khai).
    const origin = {
      deviceId: payload.deviceId || null,
      ip: normalizeIp(payload.ip),
      // Trường chuẩn cho báo cáo: clientIp (IP máy gửi).
      clientIp: normalizeIp(payload.clientIp || payload.ip),
      ipMasked: maskIp(payload.ip),
      ipLocation: approximateLocationFromIp(payload.ip, this.db.regions, payload.wardId ? findWardInUnits(this.db.regions, payload.wardId)?.regionId : null),
      // User-Agent + hệ điều hành/tên máy (main process cung cấp).
      deviceInfo: payload.deviceInfo || null,
      submittedFrom: payload.submittedFrom || "desktop",
    };
    const result = buildFeedback({ ...payload, ...origin }, { id: scopedId, now: this.now(), units: this.db.regions, categories: this.db.categories });
    if (!result.ok) return result;
    const next = { ...this.db, feedbacks: [result.feedback, ...this.db.feedbacks] };
    next.audit = [...this.db.audit, { at: this.now(), action: "submit-feedback", by: result.feedback.fullName, detail: result.feedback.id }].slice(-500);
    this.commit(next);
    return { ok: true, feedback: result.feedback };
  }

  /* ----------------------------- Thiết bị của khách ----------------------------- */

  devices() {
    return [...this.db.devices];
  }

  findDeviceByToken(token) {
    if (!token) return null;
    const hash = hashDeviceToken(token);
    const device = this.db.devices.find((item) => item.tokenHash === hash);
    if (!device) return null;
    if (isDeviceExpired(device, this.now())) return null;
    return device;
  }

  /** Đăng ký (hoặc cập nhật) thiết bị khách; trả về bản ghi đã lưu. */
  registerDevice({ token, ip, label }) {
    const now = this.now();
    const existing = this.findDeviceByToken(token);
    if (existing) {
      const next = {
        ...this.db,
        devices: this.db.devices.map((item) =>
          item.id === existing.id ? { ...item, ip: normalizeIp(ip) || item.ip, lastSeenAt: now } : item,
        ),
      };
      this.db = next;
      this.persist(next);
      return next.devices.find((item) => item.id === existing.id);
    }
    const device = createDevice({ token, ip, label, now });
    const next = { ...this.db, devices: [device, ...this.db.devices].slice(0, 500) };
    this.commit(next);
    return device;
  }

  /** Phản hồi do một thiết bị đã gửi (chỉ chủ thiết bị mới tra được). */
  feedbacksOfDevice(deviceId) {
    if (!deviceId) return [];
    return this.db.feedbacks
      .filter((item) => item.deviceId === deviceId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  reviewFeedback({ actor, feedbackId, status, note = "", displayDays = null, permanent = false }) {
    const feedback = this.db.feedbacks.find((item) => item.id === feedbackId);
    if (!feedback) return { ok: false, errors: ["Không tìm thấy phản hồi."] };
    const result = setFeedbackStatus(feedback, status, actor, { note, now: this.now() });
    if (!result.ok) return result;

    // Duyệt xong -> đặt hạn hiển thị (mặc định 4 ngày, hoặc vĩnh viễn nếu cán bộ chọn).
    const reviewed = { ...result.feedback };
    if (status === FEEDBACK_STATUS.APPROVED) {
      reviewed.display = initialDisplay({
        now: this.now(),
        days: displayDays || DISPLAY_DAYS_DEFAULT,
        permanent: Boolean(permanent),
      });
    }
    const next = {
      ...this.db,
      feedbacks: this.db.feedbacks.map((item) => (item.id === feedbackId ? reviewed : item)),
    };
    next.audit = [
      ...this.db.audit,
      { at: this.now(), action: `review-${status}`, by: actor.username, detail: feedbackId },
    ].slice(-500);
    this.commit(next);
    return { ok: true, feedback: reviewed };
  }

  /** Gia hạn hiển thị thêm N ngày (chỉ cán bộ đúng địa bàn). */
  extendDisplay({ actor, feedbackId, days = DISPLAY_DAYS_DEFAULT }) {
    const feedback = this.db.feedbacks.find((item) => item.id === feedbackId);
    if (!feedback) return { ok: false, errors: ["Không tìm thấy phản hồi."] };
    if (!canReview(actor, feedback)) return { ok: false, errors: ["Bạn không có quyền gia hạn phản hồi của phường/xã khác."] };
    const result = extendDisplayHelper(feedback, { days, by: actor.username, now: this.now() });
    if (!result.ok) return result;
    const next = {
      ...this.db,
      feedbacks: this.db.feedbacks.map((item) => (item.id === feedbackId ? { ...item, display: result.display } : item)),
    };
    next.audit = [...this.db.audit, { at: this.now(), action: "extend-display", by: actor.username, detail: `${feedbackId} +${days}d` }].slice(-500);
    this.commit(next);
    return { ok: true, display: result.display };
  }

  /** Gắn hiển thị vĩnh viễn (chỉ cán bộ đúng địa bàn). */
  makePermanent({ actor, feedbackId }) {
    const feedback = this.db.feedbacks.find((item) => item.id === feedbackId);
    if (!feedback) return { ok: false, errors: ["Không tìm thấy phản hồi."] };
    if (!canReview(actor, feedback)) return { ok: false, errors: ["Bạn không có quyền thay đổi phản hồi của phường/xã khác."] };
    const result = makePermanentHelper(feedback, { by: actor.username, now: this.now() });
    if (!result.ok) return result;
    const next = {
      ...this.db,
      feedbacks: this.db.feedbacks.map((item) => (item.id === feedbackId ? { ...item, display: result.display } : item)),
    };
    next.audit = [...this.db.audit, { at: this.now(), action: "display-permanent", by: actor.username, detail: feedbackId }].slice(-500);
    this.commit(next);
    return { ok: true, display: result.display };
  }

  /* -------------------------------- Thông báo -------------------------------- */

  notifications() {
    return [...this.db.notifications];
  }

  /** Thêm thông báo (giữ tối đa 300 mục gần nhất). */
  addNotification(notification) {
    const next = { ...this.db, notifications: [notification, ...this.db.notifications].slice(0, 300) };
    this.db = next;
    this.persist(next);
    return notification;
  }

  markNotificationRead({ actor, notificationId }) {
    const next = {
      ...this.db,
      notifications: this.db.notifications.map((item) =>
        item.id === notificationId && (!actor || item.scope === actor.username || item.wardId === actor.scope)
          ? { ...item, read: true }
          : item,
      ),
    };
    this.commit(next);
    return { ok: true, notifications: next.notifications };
  }

  markAllRead({ actor }) {
    const next = {
      ...this.db,
      notifications: this.db.notifications.map((item) => {
        const mine = actor.role === "ward" ? item.wardId === actor.scope || item.scope === actor.username : true;
        return mine ? { ...item, read: true } : item;
      }),
    };
    this.commit(next);
    return { ok: true, notifications: next.notifications };
  }

  feedbacks() {
    return [...this.db.feedbacks];
  }

  pendingCountByScope() {
    const counts = {};
    for (const item of this.db.feedbacks) {
      if (item.status !== FEEDBACK_STATUS.PENDING) continue;
      counts[item.wardId] = (counts[item.wardId] || 0) + 1;
    }
    return counts;
  }
}
