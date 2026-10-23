/**
 * Nhận diện khách (người dân không đăng nhập) để:
 *   - Admin biết IP + vị trí gửi báo cáo.
 *   - Khách dùng ĐÚNG thiết bị đã gửi thì xem lại được các phản hồi của mình;
 *     thiết bị khác thì không thấy.
 *
 * Cơ chế: máy chủ (main process) cấp 1 cookie "device token" ngẫu nhiên, lưu vào
 * db.json (bảng `devices`). Mỗi phản hồi gắn `deviceId` + `ip`. Trình duyệt tự
 * gửi token lại -> nhận diện thiết bị. Token không đoán được nên máy khác
 * không thể xem (khác với chỉ dựa vào IP).
 */

import { createHash, randomUUID } from "node:crypto";

export const DEVICE_COOKIE = "kh_device";
export const DEVICE_TOKEN_TTL_DAYS = 365;

/** Chuẩn hoá IP: bỏ tiền tố IPv4-mapped của IPv6 (::ffff:1.2.3.4). */
export function normalizeIp(ip) {
  const value = String(ip || "").trim();
  if (!value) return "";
  return value.replace(/^::ffff:/i, "");
}

/** Hash token trước khi lưu DB (không lưu token thô). */
export function hashDeviceToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

export function createDeviceToken() {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

export function createDevice({ token, ip, label = "Thiết bị khách", now = new Date().toISOString() }) {
  const ttlMs = DEVICE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  return {
    id: randomUUID(),
    tokenHash: hashDeviceToken(token),
    ip: normalizeIp(ip),
    label,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(new Date(now).getTime() + ttlMs).toISOString(),
  };
}

export function isDeviceExpired(device, now = new Date().toISOString()) {
  if (!device || !device.expiresAt) return false;
  return new Date(device.expiresAt).getTime() < new Date(now).getTime();
}

/**
 * Vị trí gần đúng từ IP — dùng IP làm hạt giống để chọn tâm khu vực gần nhất
 * trong danh mục Khánh Hòa. Đây là ước lượng, không phải GPS.
 *
 * Có `hint` (ví dụ tên phường/xã hoặc khu vực người dùng chọn trên bản đồ)
 * thì tin vào hint trước — vì IP nội bộ/localhost không mang thông tin vị trí.
 */
export function approximateLocationFromIp(ip, districts = [], hint = null) {
  const value = normalizeIp(ip);
  const centers = districts.filter((district) => district.center);
  if (!centers.length) return null;

  // 1) Ưu tiên địa bàn thực tế (người dùng chọn khi gửi).
  if (hint) {
    const matched = centers.find(
      (district) => district.districtId === hint || district.districtName === hint,
    );
    if (matched) {
      return {
        area: matched.districtName || matched.districtId,
        districtId: matched.districtId,
        lat: Number(matched.center.lat.toFixed(5)),
        lng: Number(matched.center.lng.toFixed(5)),
        precision: "selected-area",
        note: "Theo địa bàn người gửi đã chọn.",
      };
    }
  }

  if (!value) return null;

  // 2) IP nội bộ / loopback: không thể định vị -> nói rõ thay vì đoán bừa.
  if (isPrivateIp(value)) {
    return {
      area: "Mạng nội bộ",
      districtId: null,
      lat: null,
      lng: null,
      precision: "none",
      note: "IP nội bộ (máy/ LAN) không dùng để định vị được — hãy xem toạ độ GPS của phản hồi.",
    };
  }

  // 3) IP công cộng: ước lượng theo toạ độ tâm gần nhất với vĩ độ suy từ hash.
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const chosen = centers[hash % centers.length];
  return {
    area: chosen.districtName || chosen.districtId,
    districtId: chosen.districtId,
    lat: Number(chosen.center.lat.toFixed(5)),
    lng: Number(chosen.center.lng.toFixed(5)),
    precision: "approximate",
    note: "Ước lượng theo IP, không phải vị trí GPS chính xác.",
  };
}

/** IP riêng/loopback (không mang thông tin vị trí). */
export function isPrivateIp(ip) {
  const value = normalizeIp(ip);
  if (!value) return true;
  if (value === "127.0.0.1" || value === "::1" || value === "localhost") return true;
  if (/^10\./.test(value)) return true;
  if (/^192\.168\./.test(value)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(value)) return true;
  if (/^169\.254\./.test(value)) return true;
  return false;
}

/** Chuyển IP sang dạng rút gọn để hiển thị cho admin (giữ cả IP để đối chiếu). */
export function maskIp(ip) {
  const value = normalizeIp(ip);
  if (!value) return "";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    const parts = value.split(".");
    return `${parts[0]}.${parts[1]}.*.*`;
  }
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}
