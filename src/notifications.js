/**
 * Hạn hiển thị điểm công khai trên bản đồ + thông báo tới tài khoản Xã/Phường.
 *
 * Quy tắc hạn hiển thị:
 *  - Điểm do người dân gửi và được Cán bộ duyệt: hiển thị 4 ngày kể từ lúc duyệt.
 *  - Cán bộ có thể GIA HẠN thêm N ngày (cộng dồn từ hạn hiện tại, hoặc từ lúc duyệt).
 *  - Hoặc gắn VĨNH VIỄN (permanent = true), khi đó bỏ mọi hạn.
 *  - Điểm hết hạn sẽ không còn trên bản đồ công khai, nhưng vẫn nằm trong DB.
 */

export const DISPLAY_DAYS_DEFAULT = 4;
export const DISPLAY_MAX_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Chuẩn hoá tuỳ chọn hiển thị trên một bản ghi phản hồi. */
export function normalizeDisplay(feedback) {
  const display = feedback && feedback.display ? feedback.display : {};
  return {
    permanent: display.permanent === true,
    until: display.until || null,
    days: Number.isFinite(display.days) ? display.days : DISPLAY_DAYS_DEFAULT,
    extendedBy: Array.isArray(display.extendedBy) ? display.extendedBy : [],
  };
}

/** Hạn hiển thị khi duyệt: now + 4 ngày (mặc định) hoặc theo tuỳ chọn của cán bộ. */
export function initialDisplay({ now = new Date().toISOString(), days = DISPLAY_DAYS_DEFAULT, permanent = false } = {}) {
  const base = new Date(now).getTime();
  const safeDays = Math.max(1, Math.min(DISPLAY_MAX_DAYS, Number(days) || DISPLAY_DAYS_DEFAULT));
  return {
    permanent: Boolean(permanent),
    days: safeDays,
    until: permanent ? null : new Date(base + safeDays * DAY_MS).toISOString(),
    extendedBy: [],
  };
}

/**
 * Gia hạn thêm `days` ngày (cộng dồn). Nếu đã vĩnh viễn thì giữ nguyên.
 * Mốc tính: hạn hiện tại nếu còn hiệu lực, ngược lại tính từ `now`.
 */
export function extendDisplay(feedback, { days = DISPLAY_DAYS_DEFAULT, by = "system", now = new Date().toISOString() } = {}) {
  const current = normalizeDisplay(feedback);
  if (current.permanent) return { ok: false, errors: ["Điểm này đã được hiển thị vĩnh viễn."] };
  const add = Number(days);
  if (!Number.isFinite(add) || add <= 0 || add > DISPLAY_MAX_DAYS) {
    return { ok: false, errors: [`Số ngày gia hạn phải từ 1 đến ${DISPLAY_MAX_DAYS}.`] };
  }
  const nowMs = new Date(now).getTime();
  const currentMs = current.until ? new Date(current.until).getTime() : nowMs;
  const baseMs = Number.isFinite(currentMs) && currentMs > nowMs ? currentMs : nowMs;
  return {
    ok: true,
    display: {
      permanent: false,
      days: current.days + add,
      until: new Date(baseMs + add * DAY_MS).toISOString(),
      extendedBy: [...current.extendedBy, { at: now, days: add, by }],
    },
  };
}

/** Gắn hiển thị vĩnh viễn. */
export function makePermanent(feedback, { by = "system", now = new Date().toISOString() } = {}) {
  const current = normalizeDisplay(feedback);
  if (current.permanent) return { ok: false, errors: ["Điểm này đã hiển thị vĩnh viễn."] };
  return {
    ok: true,
    display: {
      permanent: true,
      days: current.days,
      until: null,
      extendedBy: [...current.extendedBy, { at: now, days: null, by, permanent: true }],
    },
  };
}

/** Điểm còn hiển thị tại thời điểm `now`? (chưa duyệt -> không hiển thị) */
export function isDisplayActive(feedback, now = new Date().toISOString()) {
  if (!feedback || feedback.status !== "approved") return false;
  const display = normalizeDisplay(feedback);
  if (display.permanent) return true;
  if (!display.until) return false;
  const until = new Date(display.until).getTime();
  return Number.isFinite(until) && until > new Date(now).getTime();
}

/** Số ngày còn lại (làm tròn lên); null nếu vĩnh viễn; 0 nếu đã hết hạn. */
export function daysLeft(feedback, now = new Date().toISOString()) {
  const display = normalizeDisplay(feedback);
  if (display.permanent) return null;
  if (!display.until) return 0;
  const diff = new Date(display.until).getTime() - new Date(now).getTime();
  return diff <= 0 ? 0 : Math.ceil(diff / DAY_MS);
}

/* ------------------------------- Thông báo -------------------------------- */

export const NOTIFICATION_TYPES = Object.freeze({
  EMERGENCY: "emergency",
  NEW_PENDING: "new_pending",
  REVIEW_REMINDER: "review_reminder",
  UPDATE_REQUEST: "update_request",
});

export const EMERGENCY_TITLE = "Trường hợp khẩn cấp";

/**
 * Thông báo cho Cán bộ Xã/Phường khi có phản hồi mới thuộc địa bàn mình.
 * Nhóm "Thông tin khẩn cấp" (khan_cap) -> tiêu đề "Trường hợp khẩn cấp".
 */
export function notificationForFeedback(feedback, { now = new Date().toISOString(), wardName = "" } = {}) {
  const emergency = feedback.category === "khan_cap";
  return {
    id: `${feedback.id}_${emergency ? "er" : "np"}`,
    type: emergency ? NOTIFICATION_TYPES.EMERGENCY : NOTIFICATION_TYPES.NEW_PENDING,
    title: emergency ? EMERGENCY_TITLE : "Có phản hồi mới chờ duyệt",
    level: emergency ? "danger" : "info",
    wardId: feedback.wardId,
    wardKey: feedback.wardKey || null,
    wardName: wardName || null,
    feedbackId: feedback.id,
    message: emergency
      ? `${feedback.fullName} vừa gửi thông tin khẩn cấp tại ${wardName || "địa bàn"}: ${truncate(feedback.reason, 90)}`
      : `${feedback.fullName} gửi phản hồi mới tại ${wardName || "địa bàn"}: ${truncate(feedback.reason, 90)}`,
    createdAt: now,
    read: false,
  };
}

function truncate(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Thông báo "nhắc duyệt" do admin gửi tới một cán bộ cụ thể. */
export function reminderNotification({ username, wardName, pendingCount, createdBy = "admin", now = new Date().toISOString() }) {
  return {
    id: `rem_${now}_${username}`,
    type: NOTIFICATION_TYPES.REVIEW_REMINDER,
    title: "Nhắc duyệt phản hồi",
    level: "warning",
    wardName: wardName || null,
    scope: username,
    message: `Cấp Tỉnh nhắc: ${pendingCount} phản hồi tại ${wardName || "địa bàn"} đang chờ bạn xác minh.`,
    createdAt: now,
    read: false,
  };
}

/** Thông báo "yêu cầu cập nhật thông tin" gửi tới cán bộ của một phường/xã. */
export function updateRequestNotification({
  wardId,
  wardName,
  accountUsername = null,
  requestedBy = "admin",
  note = "",
  now = new Date().toISOString(),
}) {
  return {
    id: `upd_${wardId}_${now}`,
    type: NOTIFICATION_TYPES.UPDATE_REQUEST,
    title: "Yêu cầu cập nhật thông tin",
    level: "warning",
    wardId,
    wardName: wardName || null,
    scope: accountUsername,
    requestedBy,
    note: truncate(note, 200),
    message:
      `Yêu cầu rà soát và cập nhật danh sách điểm hỗ trợ tại ${wardName || "địa bàn"}.` +
      (note ? ` Ghi chú: ${truncate(note, 160)}` : ""),
    createdAt: now,
    read: false,
  };
}

/**
 * Lọc thông báo cho 1 người dùng:
 *  - cán bộ: thông báo đúng `wardId` của mình + nhắc duyệt gửi cho chính mình.
 *  - admin: xem toàn bộ (chỉ đọc).
 */
export function notificationsForUser(notifications, user) {
  if (!Array.isArray(notifications) || !user) return [];
  if (user.role === "admin") return [...notifications].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (user.role !== "ward") return [];
  return notifications
    .filter((item) => {
      if (item.type === NOTIFICATION_TYPES.REVIEW_REMINDER) return item.scope === user.username;
      // Yêu cầu cập nhật: gửi đúng cán bộ (scope) hoặc mọi cán bộ của phường/xã đó.
      if (item.type === NOTIFICATION_TYPES.UPDATE_REQUEST) {
        return item.scope ? item.scope === user.username : item.wardId === user.scope;
      }
      return item.wardId === user.scope;
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
