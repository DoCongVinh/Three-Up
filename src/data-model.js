/**
 * Lõi nghiệp vụ dùng chung (main process + renderer + unit tests).
 * Không import electron/fs/dom để chạy được ở mọi môi trường.
 *
 * Quy ước dữ liệu:
 *  - id: chuỗi sinh bằng crypto.randomUUID (fallback tăng dần)
 *  - role: "admin" (Cấp Tỉnh) | "ward" (Cán bộ Xã/Phường) | "citizen" (Người dân - không tài khoản)
 *  - user.scope: chỉ có với role "ward" -> id vùng (xã/phường) mà cán bộ phụ trách
 *  - feedback.status: "pending" | "approved" | "rejected"
 */

import { ADMINISTRATIVE_UNITS, buildScopedId, buildWardKey, parseWardKey } from "./administrative-units.js";

export const ROLE_ADMIN = "admin";
export const ROLE_WARD = "ward";

/** Tỉnh cố định của ứng dụng — người dân không thể thay đổi khi gửi phản hồi. */
export const PROVINCE = Object.freeze({ id: "khanh_hoa", name: "Khánh Hòa" });

export { ADMINISTRATIVE_UNITS, buildScopedId, buildWardKey, parseWardKey };

export const FEEDBACK_STATUS = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
});

export const STATUS_LABELS = Object.freeze({
  pending: "Chờ xác minh",
  approved: "Đã duyệt",
  rejected: "Từ chối",
});

/**
 * Nhóm thông tin MẶC ĐỊNH. Đây chỉ là dữ liệu seed: danh mục đang dùng nằm
 * trong db.json (DataStore.categories()) và Cấp Tỉnh có thể thêm/sửa/xoá
 * (VD: Người khuyết tật, Nhà thương binh...). Khi cần nhóm theo danh mục động,
 * truyền `categories` vào validateFeedback/buildFeedback/approvedFeedbackToLocation.
 */
export const CATEGORIES = Object.freeze({
  ho_tro: { label: "Điểm hỗ trợ", icon: "🍲", color: "#15803d" },
  chinh_sach: { label: "Chính sách & Quyền lợi", icon: "📜", color: "#7c3aed" },
  nhu_cau: { label: "Nhu cầu thực tế", icon: "🤝", color: "#ea580c" },
  khan_cap: { label: "Thông tin khẩn cấp", icon: "🚨", color: "#dc2626" },
});

/** Chuyển mảng nhóm (trong DB) thành map { id: {label, icon, color} }. */
export function toCategoryMap(list) {
  const source = Array.isArray(list) ? list : Object.values(list || {});
  const map = {};
  for (const item of source) {
    if (!item) continue;
    const id = item.id || item.categoryId;
    if (!id) continue;
    map[id] = {
      label: item.label || item.name || id,
      icon: item.icon || "📍",
      color: item.color || "#0f766e",
    };
  }
  return map;
}

/**
/**
 * Danh mục đơn vị hành chính (3 tầng) — nguồn duy nhất dùng chung cho
 * bộ lọc bản đồ, form phản hồi và form tạo tài khoản.
 *
 * Tầng 1: Huyện / Thành phố  (`id`, `name`)
 * Tầng 2: Phường / Xã / Đặc khu (`id`, `name`) — khoá duy nhất: districtId + "_" + wardId
 * Tầng 3: Thôn / Tổ dân phố (`hamlets`)
 *
 * Dữ liệu mặc định nằm ở src/administrative-units.js; phần đang dùng thực tế
 * nằm trong db.json (xem DataStore.regions()) nên có thể sửa qua giao diện.
 */
const DISTRICT_CENTERS = Object.freeze({
  nha_trang: { lat: 12.2388, lng: 109.1967, zoom: 12 },
  cam_ranh: { lat: 11.9214, lng: 109.1599, zoom: 12 },
  ninh_hoa: { lat: 12.4916, lng: 109.1246, zoom: 12 },
  cam_lam: { lat: 12.0808, lng: 109.1632, zoom: 12 },
  truong_sa: { lat: 8.6447, lng: 111.9194, zoom: 10 },
});

export const REGIONS = Object.freeze(
  ADMINISTRATIVE_UNITS.map((district) => ({
    id: district.districtId,
    name: district.districtName,
    shortName: district.shortName || district.districtName,
    type: /Thành phố/i.test(district.districtName) ? "city" : /Thị xã/i.test(district.districtName) ? "town" : "district",
    center: DISTRICT_CENTERS[district.districtId] || null,
    wards: district.wards.map((ward) => ({
      id: ward.wardId,
      name: ward.wardName,
      legacy: ward.oldUnits,
      hamlets: [...ward.hamlets],
      districtId: district.districtId,
    })),
  })),
);

export const REGIONS_BY_ID = Object.freeze(
  Object.fromEntries(REGIONS.map((region) => [region.id, region])),
);

/** Danh sách phẳng mọi phường/xã, kèm id thành phố/huyện chứa nó. */
export const WARDS = Object.freeze(
  REGIONS.flatMap((region) =>
    region.wards.map((ward) => ({
      ...ward,
      regionId: region.id,
      regionName: region.name,
      value: ward.id,
      label: `${ward.name} · ${region.shortName}`,
    })),
  ),
);

export const WARDS_BY_ID = Object.freeze(
  Object.fromEntries(WARDS.map((ward) => [ward.id, ward])),
);

export function getRegion(regionId) {
  return REGIONS_BY_ID[regionId] || null;
}

export function getWard(wardId) {
  return WARDS_BY_ID[wardId] || null;
}

export function wardLabel(wardId) {
  const ward = getWard(wardId);
  return ward ? ward.name : "Chưa xác định";
}

/** Chuẩn hoá chuỗi người dùng nhập: trim + gộp khoảng trắng. */
export function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** Bỏ ký tự điều khiển và ký tự HTML nguy hiểm, giới hạn độ dài. */
export function sanitizeText(value, maxLength = 300) {
  return normalizeText(
    normalizeText(value).replace(/[\u0000-\u001F\u007F]/g, " "),
  ).slice(0, maxLength);
}

export function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

export function normalizePhone(value) {
  return normalizeText(value).replace(/[^\d+]/g, "");
}

// Chấp nhận 0xxxxxxxxx (10 số) hoặc +84xxxxxxxxx; cho phép khoảng trắng/dấu chấm khi nhập.
const PHONE_PATTERN = /^(?:\+84|0)(?:\d[\s.-]?){8,10}\d$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * Tìm phường/xã trong danh mục động (db.json).
 * Dùng chung cho validateFeedback/validateAccountInput để đơn vị mới thêm
 * qua giao diện cũng được chấp nhận ngay.
 */
export function findWardInUnits(units, wardId) {
  if (!Array.isArray(units) || !wardId) return null;
  for (const district of units) {
    const ward = district.wards.find((item) => (item.wardId || item.id) === wardId);
    if (ward) {
      return {
        ...ward,
        id: ward.wardId || ward.id,
        name: ward.wardName || ward.name,
        regionId: district.districtId,
      };
    }
  }
  return null;
}

export function isValidPhone(value) {
  const input = normalizeText(value);
  return PHONE_PATTERN.test(input);
}

export function isValidEmail(value) {
  return EMAIL_PATTERN.test(normalizeText(value));
}

/* ---------------------------------- ID / mã --------------------------------- */

let counter = 0;

export function createId(prefix = "") {
  counter = (counter + 1) % 1_000_000;
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  return `${prefix}${prefix ? "-" : ""}${Date.now().toString(36)}${random}${counter.toString(36)}`;
}

/* ------------------------------------- Auth --------------------------------- */

export const ACCOUNT_RULES = Object.freeze({
  usernameMin: 4,
  usernameMax: 32,
  passwordMin: 8,
  passwordMax: 72,
});

export function validateAccountInput(input = {}, { requireScope = true, units = null } = {}) {
  const errors = [];
  // `units` = danh mục động từ db.json; không truyền thì dùng danh mục mặc định.
  const findWard = (wardId) => (units ? findWardInUnits(units, wardId) : getWard(wardId));
  const username = normalizeText(input.username).toLowerCase();
  const displayName = sanitizeText(input.displayName, 80);
  const password = String(input.password ?? "");

  if (!new RegExp(`^[a-z0-9._]{${ACCOUNT_RULES.usernameMin},${ACCOUNT_RULES.usernameMax}}$`).test(username)) {
    errors.push(`Tên đăng nhập 4–32 ký tự, chỉ gồm a-z, 0-9, dấu chấm hoặc gạch dưới.`);
  }
  if (displayName.length < 3) {
    errors.push("Họ tên cán bộ phải có ít nhất 3 ký tự.");
  }
  if (password.length < ACCOUNT_RULES.passwordMin) {
    errors.push(`Mật khẩu phải có ít nhất ${ACCOUNT_RULES.passwordMin} ký tự.`);
  }
  if (password.length > ACCOUNT_RULES.passwordMax) {
    errors.push(`Mật khẩu tối đa ${ACCOUNT_RULES.passwordMax} ký tự.`);
  }
  const scope = normalizeText(input.scope);
  const ward = scope ? findWard(scope) : null;
  if (requireScope && !ward) {
    errors.push("Vui lòng chọn Phường/Xã hợp lệ cho tài khoản.");
  }
  // districtId (nếu client gửi) phải khớp với phường/xã đã chọn.
  const districtId = normalizeText(input.districtId) || (ward ? ward.regionId : "");
  if (ward && input.districtId && districtId !== ward.regionId) {
    errors.push("Phường/Xã không thuộc Thành phố/Huyện đã chọn.");
  }
  const scopeKey = ward ? buildWardKey(districtId, scope) : "";
  return { ok: errors.length === 0, errors, value: { username, displayName, password, scope, districtId, scopeKey } };
}

export function validatePassword(password) {
  const value = String(password ?? "");
  const errors = [];
  if (value.length < ACCOUNT_RULES.passwordMin) errors.push(`Mật khẩu phải có ít nhất ${ACCOUNT_RULES.passwordMin} ký tự.`);
  if (value.length > ACCOUNT_RULES.passwordMax) errors.push(`Mật khẩu tối đa ${ACCOUNT_RULES.passwordMax} ký tự.`);
  return { ok: errors.length === 0, errors };
}

/**
 * Kiểm tra tài khoản mới có trùng/không hợp lệ. `users` là danh sách đã lọc bỏ mật khẩu.
 */
export function validateNewAccount(input, users = [], options = {}) {
  const base = validateAccountInput(input, { requireScope: true, units: options.units || null });
  const errors = [...base.errors];
  const username = base.value.username;
  if (username && users.some((user) => user.username === username)) {
    errors.push("Tên đăng nhập đã tồn tại, vui lòng chọn tên khác.");
  }
  if (username && users.some((user) => user.scope && user.scope === base.value.scope && user.displayName === base.value.displayName)) {
    errors.push("Đã có cán bộ cùng họ tên phụ trách phường/xã này.");
  }
  return { ok: errors.length === 0, errors, value: base.value };
}

/** Người dùng công khai (không bao giờ trả về passwordHash). */
export function toPublicUser(user) {
  if (!user) return null;
  const ward = getWard(user.scope);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    scope: user.scope || null,
    scopeKey: ward ? buildWardKey(ward.regionId, ward.id) : user.scopeKey || null,
    scopeName: ward ? ward.name : null,
    regionId: ward ? ward.regionId : null,
    regionName: ward ? ward.regionName : null,
    active: user.active !== false,
    createdAt: user.createdAt,
  };
}

/* ------------------------------- Feedback ---------------------------------- */

export const FEEDBACK_FIELDS = Object.freeze({
  fullName: 80,
  phone: 20,
  email: 120,
  address: 180,
  reason: 700,
});

export const FEEDBACK_MAX_IMAGES = 5;

export function validateFeedback(input = {}, { units = null, categories = null } = {}) {
  const categoryMap = categories ? toCategoryMap(categories) : CATEGORIES;
  const errors = [];
  const value = {
    fullName: sanitizeText(input.fullName, FEEDBACK_FIELDS.fullName),
    phone: normalizePhone(input.phone),
    email: normalizeEmail(input.email),
    address: sanitizeText(input.address, FEEDBACK_FIELDS.address),
    reason: sanitizeText(input.reason, FEEDBACK_FIELDS.reason),
    category: normalizeText(input.category),
    // Tỉnh cố định (ứng dụng chỉ phục vụ Khánh Hòa): không nhận province từ client.
    provinceId: PROVINCE.id,
    districtId: normalizeText(input.districtId),
    wardId: normalizeText(input.wardId),
    hamlet: normalizeText(input.hamlet),
    lat: Number(input.lat),
    lng: Number(input.lng),
    // Nguồn gửi: do main process gắn (không phải người dân tự nhập).
    deviceId: input.deviceId ? normalizeText(input.deviceId) : null,
    // clientIp: tên trường chuẩn theo yêu cầu; `ip` giữ để tương thích dữ liệu cũ.
    ip: normalizeText(input.ip),
    clientIp: normalizeText(input.clientIp || input.ip),
    ipMasked: normalizeText(input.ipMasked),
    ipLocation: input.ipLocation || null,
    // Thông tin thiết bị: hệ điều hành, tên máy, User-Agent (req user-agent).
    deviceInfo: input.deviceInfo || null,
    submittedFrom: normalizeText(input.submittedFrom) || "desktop",
    images: [],
    pendingImageDir: normalizeText(input.pendingImageDir),
  };

  if (value.fullName.length < 2) errors.push("Vui lòng nhập họ tên người gửi.");
  if (!isValidPhone(input.phone)) errors.push("Số điện thoại không hợp lệ (VD: 0905123456 hoặc +84905123456).");
  if (!isValidEmail(input.email)) errors.push("Email không hợp lệ (VD: ten@example.com).");
  if (value.address.length < 5) errors.push("Vui lòng nhập địa chỉ chi tiết (số nhà, đường, thôn/tổ).");
  if (value.reason.length < 20) errors.push("Lý do / nội dung cần ít nhất 20 ký tự để cán bộ xác minh.");
  if (!categoryMap[value.category]) errors.push("Nhóm thông tin không hợp lệ.");
  const ward = units ? findWardInUnits(units, value.wardId) : getWard(value.wardId);
  if (!ward) errors.push("Vui lòng chọn Phường/Xã.");
  else {
    // Thôn/tổ dân phố phải thuộc đúng phường/xã đã chọn -> không lệch địa bàn.
    const hamlets = ward.hamlets || [];
    if (!value.hamlet) errors.push("Vui lòng chọn Thôn / Tổ dân phố.");
    else if (hamlets.length && !hamlets.includes(value.hamlet)) {
      errors.push(`Thôn/Tổ dân phố "${value.hamlet}" không thuộc ${ward.name}.`);
    }
    value.districtId = ward.regionId;
    // Nếu client gửi huyện khác với huyện của phường/xã -> dữ liệu không nhất quán.
    if (input.districtId && normalizeText(input.districtId) !== ward.regionId) {
      errors.push("Khu vực không khớp với Phường/Xã đã chọn.");
    }
  }

  const hasCoords =
    Number.isFinite(value.lat) && Number.isFinite(value.lng) &&
    Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180 &&
    !(value.lat === 0 && value.lng === 0);
  if (!hasCoords) errors.push("Vui lòng lấy vị trí GPS hoặc chọn trực tiếp trên bản đồ.");

  const rawImages = Array.isArray(input.images) ? input.images : [];
  if (rawImages.length > FEEDBACK_MAX_IMAGES) errors.push(`Chỉ đính kèm tối đa ${FEEDBACK_MAX_IMAGES} hình ảnh.`);
  const cleanImages = [];
  for (const name of rawImages.slice(0, FEEDBACK_MAX_IMAGES)) {
    // Chỉ nhận tên tệp trơn (không đường dẫn) với đuôi ảnh hợp lệ.
    const base = String(name).split(/[\\/]/).pop();
    if (!/^[\w-]+\.(png|jpe?g|webp)$/i.test(base)) {
      errors.push("Hình ảnh phải là tên tệp .png/.jpg/.jpeg/.webp (không chứa đường dẫn).");
      continue;
    }
    cleanImages.push(base);
  }
  value.images = cleanImages;

  return { ok: errors.length === 0, errors, value };
}

/** Tạo bản ghi phản hồi mới (chưa lưu), gắn trạng thái pending + mốc thời gian. */
export function buildFeedback(input, { id, now = new Date().toISOString(), wardOfficerId = null, units = null, categories = null } = {}) {
  const { ok, errors, value } = validateFeedback(input, { units, categories });
  if (!ok) return { ok: false, errors };
  const ward = units ? findWardInUnits(units, value.wardId) : getWard(value.wardId);
  return {
    ok: true,
    feedback: {
      id: id || createId("fb"),
      ...value,
      regionId: ward.regionId,
      wardKey: buildWardKey(ward.regionId, ward.id),
      status: FEEDBACK_STATUS.PENDING,
      createdAt: now,
      updatedAt: now,
      assignedTo: wardOfficerId,
      history: [{ at: now, action: "submitted", by: value.fullName }],
    },
  };
}

/**
 * Chỉ người thuộc đúng địa bàn mới được duyệt/từ chối. Admin không duyệt thay.
 */
export function canReview(user, feedback) {
  if (!user || feedback == null) return false;
  if (user.role !== ROLE_WARD || !user.scope) return false;
  if (!user.active) return false;
  return feedback.wardId === user.scope;
}

export function setFeedbackStatus(feedback, status, user, { note = "", now = new Date().toISOString() } = {}) {
  if (!Object.values(FEEDBACK_STATUS).includes(status) || status === FEEDBACK_STATUS.PENDING) {
    return { ok: false, errors: ["Trạng thái không hợp lệ."] };
  }
  if (status === FEEDBACK_STATUS.REJECTED && sanitizeText(note, 300).length < 5) {
    return { ok: false, errors: ["Vui lòng ghi lý do từ chối (ít nhất 5 ký tự)."] };
  }
  if (!canReview(user, feedback)) {
    return { ok: false, errors: ["Bạn không có quyền duyệt phản hồi của phường/xã khác."] };
  }
  return {
    ok: true,
    feedback: {
      ...feedback,
      status,
      reviewNote: sanitizeText(note, 300),
      reviewedAt: now,
      reviewedBy: user.id,
      updatedAt: now,
      history: [...(feedback.history || []), { at: now, action: status, by: user.username, note: sanitizeText(note, 300) }],
    },
  };
}

/** Phản hồi thuộc địa bàn của cán bộ (hoặc tất cả nếu không giới hạn scope). */
export function filterFeedbacksForUser(feedbacks, user) {
  if (!Array.isArray(feedbacks)) return [];
  if (!user) return [];
  if (user.role === ROLE_ADMIN) return [...feedbacks];
  if (user.role === ROLE_WARD && user.scope) return feedbacks.filter((item) => item.wardId === user.scope);
  return [];
}

/* ------------------------------- Statistics -------------------------------- */

/**
 * Tổng hợp theo thành phố/huyện -> phường/xã.
 * accounts: tài khoản cán bộ (đã public), feedbacks: toàn bộ phản hồi.
 */
export function buildStatistics({ accounts = [], feedbacks = [], regions = REGIONS } = {}) {
  return regions.map((region) => {
    const wards = region.wards.map((ward) => {
      const related = feedbacks.filter((item) => item.wardId === ward.id);
      return {
        id: ward.id,
        wardKey: buildWardKey(region.id, ward.id),
        name: ward.name,
        legacy: ward.legacy,
        hamlets: ward.hamlets || [],
        accountCount: accounts.filter((account) => account.scope === ward.id).length,
        pendingCount: related.filter((item) => item.status === FEEDBACK_STATUS.PENDING).length,
        approvedCount: related.filter((item) => item.status === FEEDBACK_STATUS.APPROVED).length,
        rejectedCount: related.filter((item) => item.status === FEEDBACK_STATUS.REJECTED).length,
        totalCount: related.length,
      };
    });
    return {
      id: region.id,
      name: region.name,
      shortName: region.shortName,
      type: region.type,
      center: region.center,
      wardCount: wards.length,
      accountCount: wards.reduce((sum, ward) => sum + ward.accountCount, 0),
      pendingCount: wards.reduce((sum, ward) => sum + ward.pendingCount, 0),
      approvedCount: wards.reduce((sum, ward) => sum + ward.approvedCount, 0),
      totalCount: wards.reduce((sum, ward) => sum + ward.totalCount, 0),
      wards,
    };
  });
}

/** Điểm đã duyệt -> dữ liệu marker cho bản đồ. `categories` có thể là mảng hoặc map. */
export function approvedFeedbackToLocation(feedback, categories = CATEGORIES) {
  const map = Array.isArray(categories) ? toCategoryMap(categories) : (categories || CATEGORIES);
  const category = map[feedback.category] || CATEGORIES.ho_tro;
  return {
    id: feedback.id,
    title: feedback.fullName ? `${category.label} · ${feedback.fullName}` : category.label,
    address: feedback.address,
    lat: feedback.lat,
    lng: feedback.lng,
    category: feedback.category,
    ward: feedback.wardId,
    phone: feedback.phone,
    desc: feedback.reason,
    verified: true,
    images: feedback.images || [],
  };
}

/* ---------------------------- Map helpers ---------------------------------- */

/** Khoảng cách (km) giữa 2 toạ độ – haversine, dùng cho nút "Vị trí của tôi". */
export function distanceKm(a, b) {
  if (!a || !b) return Number.NaN;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 100) / 100;
}

/** Phường/xã gần nhất theo toạ độ tâm của thành phố/huyện (gợi ý mặc định cho form). */
export function nearestWard(point) {
  if (!point) return null;
  const scored = REGIONS.flatMap((region) =>
    region.wards.map((ward) => ({ wardId: ward.id, distance: distanceKm(point, region.center) })),
  ).sort((a, b) => a.distance - b.distance);
  return scored.length ? scored[0].wardId : null;
}

export const DEFAULT_SEED_PASSWORD = "Canbo@123";
