/**
 * Dịch vụ ứng dụng: bọc DataStore và kiểm soát phân quyền cho từng IPC call.
 * Tách khỏi Electron để unit test chạy bằng Node thuần.
 *
 * Phiên đăng nhập được giữ trong main process (không gửi token/mật khẩu ra
 * renderer). Mỗi request đều mang `sessionId` do main cấp sau khi đăng nhập.
 */

import { randomUUID } from "node:crypto";
import {
  DISPLAY_DAYS_DEFAULT,
  daysLeft,
  isDisplayActive,
  notificationForFeedback,
  notificationsForUser,
  reminderNotification,
  updateRequestNotification,
} from "./notifications.js";
import { findWardInUnits } from "./data-model.js";
import { maskIp } from "./devices.js";
import {
  REGIONS,
  WARDS,
  WARDS_BY_ID,
  FEEDBACK_STATUS,
  STATUS_LABELS,
  buildStatistics,
  createId,
  getRegion,
  getWard,
  approvedFeedbackToLocation,
  canReview,
  filterFeedbacksForUser,
  normalizeText,
  toPublicUser,
} from "./data-model.js";

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 giờ

export class AppService {
  /**
   * @param {import("./data-store.js").DataStore} store
   * @param {{ now?: () => number }} [options]
   */
  constructor(store, options = {}) {
    this.store = store;
    this.now = options.now || (() => Date.now());
    this.onFeedbackCreated = options.onFeedbackCreated || null;
    this.sessions = new Map();
  }

  /* -------------------------------- Sessions -------------------------------- */

  createSession(user) {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      id: sessionId,
      userId: user.id,
      issuedAt: this.now(),
      expiresAt: this.now() + SESSION_TTL_MS,
    });
    return sessionId;
  }

  resolveSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    const user = this.store.db.users.find((item) => item.id === session.userId);
    if (!user || user.active === false) {
      this.sessions.delete(sessionId);
      return null;
    }
    return { session, user, publicUser: toPublicUser(user) };
  }

  destroySession(sessionId) {
    return this.sessions.delete(sessionId);
  }

  requireSession(sessionId) {
    const resolved = this.resolveSession(sessionId);
    if (!resolved) {
      return { ok: false, code: "UNAUTHENTICATED", errors: ["Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại."] };
    }
    return { ok: true, ...resolved };
  }

  requireAdmin(sessionId) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    if (result.user.role !== "admin") {
      return { ok: false, code: "FORBIDDEN", errors: ["Chức năng chỉ dành cho tài khoản Cấp Tỉnh."] };
    }
    return result;
  }

  /* ---------------------------------- Auth ---------------------------------- */

  login({ username, password } = {}) {
    const result = this.store.authenticate(username, password);
    if (!result.ok) return { ok: false, code: "INVALID_CREDENTIALS", errors: [result.error] };
    const sessionId = this.createSession(result.user);
    return {
      ok: true,
      sessionId,
      user: result.user,
      mustChangePassword: Boolean(this.store.findUser(result.user.username)?.mustChangePassword),
    };
  }

  logout({ sessionId } = {}) {
    this.destroySession(sessionId);
    return { ok: true };
  }

  me({ sessionId } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    return { ok: true, user: result.publicUser };
  }

  changePassword({ sessionId, oldPassword, newPassword } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    return this.store.changePassword({ actor: result.publicUser, oldPassword, newPassword });
  }

  /* -------------------------------- Accounts -------------------------------- */

  listAccounts({ sessionId } = {}) {
    const result = this.requireAdmin(sessionId);
    if (!result.ok) return result;
    return { ok: true, accounts: this.store.publicUsers().filter((user) => user.role === "ward") };
  }

  createAccount({ sessionId, username, password, displayName, wardId, scope, districtId } = {}) {
    const result = this.requireAdmin(sessionId);
    if (!result.ok) return result;
    const created = this.store.createWardAccount({
      actor: result.publicUser,
      username,
      password,
      displayName,
      scope: wardId || scope,
      districtId,
    });
    if (!created.ok) return { ok: false, code: "VALIDATION", errors: created.errors };
    return { ok: true, account: created.user, accounts: this.listAccounts({ sessionId }).accounts };
  }

  setAccountActive({ sessionId, accountId, active } = {}) {
    const result = this.requireAdmin(sessionId);
    if (!result.ok) return result;
    const update = this.store.setUserActive({ actor: result.publicUser, userId: accountId, active });
    if (!update.ok) return { ok: false, code: "VALIDATION", errors: update.errors };
    return { ok: true, account: update.user, accounts: this.listAccounts({ sessionId }).accounts };
  }

  /** Admin đặt lại mật khẩu cho cán bộ (không cần mật khẩu cũ). */
  resetAccountPassword({ sessionId, accountId, newPassword, mustChangePassword = true } = {}) {
    const result = this.requireAdmin(sessionId);
    if (!result.ok) return result;
    const updated = this.store.resetUserPassword({
      actor: result.publicUser,
      userId: accountId,
      newPassword,
      mustChangePassword,
    });
    if (!updated.ok) return { ok: false, code: "VALIDATION", errors: updated.errors };
    return {
      ok: true,
      account: updated.user,
      mustChangePassword: updated.mustChangePassword,
      message:
        `Đã đặt lại mật khẩu cho ${updated.user.displayName} (${updated.user.username}).` +
        (updated.mustChangePassword ? " Cán bộ sẽ phải đổi mật khẩu ở lần đăng nhập tiếp theo." : ""),
    };
  }

  /** Admin sửa họ tên / gán lại Phường-Xã phụ trách. */
  updateAccount({ sessionId, accountId, displayName, wardId } = {}) {
    const result = this.requireAdmin(sessionId);
    if (!result.ok) return result;
    const updated = this.store.updateWardAccount({
      actor: result.publicUser,
      userId: accountId,
      displayName,
      scope: wardId,
    });
    if (!updated.ok) return { ok: false, code: "VALIDATION", errors: updated.errors };
    return {
      ok: true,
      account: updated.user,
      scopeChanged: updated.scopeChanged,
      accounts: this.listAccounts({ sessionId }).accounts,
      message: `Đã cập nhật tài khoản ${updated.user.displayName}` +
        (updated.scopeChanged ? ` → ${updated.user.scopeName}.` : "."),
    };
  }

  /* -------------------------- Đơn vị hành chính (CRUD) ------------------------- */

  /** Danh mục 3 tầng đang dùng — cho bộ lọc bản đồ, form phản hồi, form tài khoản. */
  administrativeUnits() {
    return this.store.regions();
  }

  /** Nhóm thông tin đang dùng (admin có thể đã thêm nhóm mới). */
  categories() {
    return this.store.categories();
  }

  createCategory({ sessionId, label, icon, color } = {}) {
    const result = this.requireAdmin(sessionId);
    if (!result.ok) return result;
    const created = this.store.createCategory({ actor: result.publicUser, label, icon, color });
    if (!created.ok) return { ok: false, code: "VALIDATION", errors: created.errors };
    return { ok: true, category: created.category, categories: created.categories };
  }

  updateCategory({ sessionId, categoryId, label, icon, color } = {}) {
    const result = this.requireAdmin(sessionId);
    if (!result.ok) return result;
    const updated = this.store.updateCategory({ actor: result.publicUser, categoryId, label, icon, color });
    if (!updated.ok) return { ok: false, code: "VALIDATION", errors: updated.errors };
    return { ok: true, categories: updated.categories };
  }

  deleteCategory({ sessionId, categoryId } = {}) {
    const result = this.requireAdmin(sessionId);
    if (!result.ok) return result;
    const removed = this.store.deleteCategory({ actor: result.publicUser, categoryId });
    if (!removed.ok) return { ok: false, code: "VALIDATION", errors: removed.errors };
    return { ok: true, categories: removed.categories };
  }

  createWard({ sessionId, districtId, wardName, oldUnits, hamlets } = {}) {
    const result = this.requireAdmin(sessionId);
    if (!result.ok) return result;
    const created = this.store.createWard({ actor: result.publicUser, districtId, wardName, oldUnits, hamlets });
    if (!created.ok) return { ok: false, code: "VALIDATION", errors: created.errors };
    return { ok: true, ward: created.ward, regions: created.regions };
  }

  updateWard({ sessionId, wardId, wardName, oldUnits, hamlets } = {}) {
    const result = this.requireAdmin(sessionId);
    if (!result.ok) return result;
    const updated = this.store.updateWard({ actor: result.publicUser, wardId, wardName, oldUnits, hamlets });
    if (!updated.ok) return { ok: false, code: "VALIDATION", errors: updated.errors };
    return { ok: true, regions: updated.regions };
  }

  deleteWard({ sessionId, wardId } = {}) {
    const result = this.requireAdmin(sessionId);
    if (!result.ok) return result;
    const removed = this.store.deleteWard({ actor: result.publicUser, wardId });
    if (!removed.ok) return { ok: false, code: "VALIDATION", errors: removed.errors };
    return { ok: true, regions: removed.regions };
  }

  /* -------------------------------- Directory ------------------------------- */

  /** Cây đơn vị + thống kê xã/phường (ai đã đăng nhập cũng xem được). */
  directory({ sessionId } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    const accounts = this.store.publicUsers();
    const feedbacks = this.store.feedbacks();
    // Thống kê theo danh mục đang dùng trong db.json (có thể đã được sửa).
    const regions = this.store.regions().map((district) => ({
      id: district.districtId,
      name: district.districtName,
      shortName: district.shortName || district.districtName,
      type: "area",
      wards: district.wards.map((ward) => ({ id: ward.wardId, name: ward.wardName, legacy: ward.oldUnits, hamlets: ward.hamlets })),
    }));
    if (result.user.role === "ward") {
      // Cán bộ xã/phường chỉ thấy đúng địa bàn của mình.
      const scoped = buildStatistics({
        accounts: accounts.filter((account) => account.scope === result.user.scope),
        feedbacks: feedbacks.filter((item) => item.wardId === result.user.scope),
        regions,
      })
        .map((region) => ({
          ...region,
          wards: region.wards.filter((ward) => ward.id === result.user.scope),
        }))
        .filter((region) => region.wards.length > 0);
      return { ok: true, statistics: scoped, scope: result.user.scope, scopeName: result.publicUser.scopeName };
    }
    return { ok: true, statistics: buildStatistics({ accounts, feedbacks, regions }), scope: null };
  }

  /* -------------------------------- Feedback -------------------------------- */

  /** Người dân gửi phản hồi - không cần đăng nhập, nhưng vẫn bị validate ở main. */
  submitFeedback(payload = {}) {
    // Thiết bị: nếu renderer có gửi kèm cookie token thì tra ra deviceId;
    // nếu chưa có thì tạo mới (main process sẽ đặt cookie ở tầng IPC).
    let device = null;
    if (payload.deviceToken) {
      device = this.store.registerDevice({ token: payload.deviceToken, ip: payload.ip });
    }
    const created = this.store.createFeedback({
      ...payload,
      deviceId: device ? device.id : null,
    });
    if (!created.ok) return { ok: false, code: "VALIDATION", errors: created.errors };

    // Ảnh đã lưu tạm ở thư mục pending-*; chuyển sang thư mục của phản hồi.
    let images = created.feedback.images;
    if (images.length && payload.pendingImageDir && typeof this.onFeedbackCreated === "function") {
      const moved = this.onFeedbackCreated({ ...created.feedback, imagesPendingId: payload.pendingImageDir });
      if (moved?.ok) {
        images = images.slice(0, moved.moved);
      } else {
        images = [];
      }
    } else if (images.length) {
      images = [];
    }
    if (images.length !== created.feedback.images.length) {
      // Ghi lại danh sách ảnh thực sự đã chuyển được (nếu lệch).
      this.store.db.feedbacks = this.store.db.feedbacks.map((item) =>
        item.id === created.feedback.id ? { ...item, images } : item,
      );
      this.store.persist(this.store.db);
    }

    const ward = getWard(created.feedback.wardId);
    // Tên địa bàn lấy từ danh mục động (đơn vị admin tự thêm không có trong getWard).
    const wardInDb = findWardInUnits(this.store.regions(), created.feedback.wardId);
    const wardName = (wardInDb && wardInDb.name) || (ward && ward.name) || "";

    // Thông báo cho Cán bộ Xã/Phường của đúng địa bàn nhận phản hồi.
    // Nhóm "Thông tin khẩn cấp" -> thông báo "Trường hợp khẩn cấp".
    this.store.addNotification(
      notificationForFeedback({ ...created.feedback, images }, { now: this.store.now(), wardName }),
    );

    return {
      ok: true,
      feedbackId: created.feedback.id,
      feedback: { ...created.feedback, images },
      routedTo: ward ? { wardId: ward.id, wardName: ward.name, regionName: ward.regionName } : null,
      images,
      emergency: created.feedback.category === "khan_cap",
      message: created.feedback.category === "khan_cap"
        ? `Đã gửi cảnh báo KHẨN CẤP tới cán bộ ${ward ? ward.name : "phường/xã"}.`
        : `Đã gửi tới cán bộ ${ward ? ward.name : "phường/xã"} để xác minh.`,
    };
  }

  /** Cán bộ thấy đúng danh sách địa bàn của mình; admin thấy toàn bộ (chỉ đọc). */
  listFeedbacks({ sessionId, status } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    const all = filterFeedbacksForUser(this.store.feedbacks(), result.publicUser);
    const filtered = status && status !== "all" ? all.filter((item) => item.status === status) : all;
    const counts = {
      all: all.length,
      pending: all.filter((item) => item.status === FEEDBACK_STATUS.PENDING).length,
      approved: all.filter((item) => item.status === FEEDBACK_STATUS.APPROVED).length,
      rejected: all.filter((item) => item.status === FEEDBACK_STATUS.REJECTED).length,
    };
    return {
      ok: true,
      feedbacks: filtered.map((item) => {
        // IP thiết bị gửi + số lần thiết bị này đã gửi (cảnh báo spam).
        const ip = item.clientIp || item.ip || "";
        const submissionsFromDevice = item.deviceId
          ? this.store.feedbacksOfDevice(item.deviceId).length
          : 0;
        return {
          ...item,
          wardName: getWard(item.wardId)?.name || findWardInUnits(this.store.regions(), item.wardId)?.name || "",
          statusLabel: STATUS_LABELS[item.status] || item.status,
          clientIp: ip,
          ip,
          ipMasked: item.ipMasked || maskIp(ip),
          submissionsFromDevice,
          // Hạn hiển thị: còn lại bao nhiêu ngày / vĩnh viễn / đã hết hạn.
          displayInfo: {
            permanent: Boolean(item.display && item.display.permanent),
            until: (item.display && item.display.until) || null,
            daysLeft: daysLeft(item, this.store.now()),
            active: isDisplayActive(item, this.store.now()),
          },
          canReview: canReview(result.publicUser, item),
        };
      }),
      counts,
      scope: result.publicUser.scope,
      scopeName: result.publicUser.scopeName,
    };
  }

  reviewFeedback({ sessionId, feedbackId, status, note, displayDays = null, permanent = false } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    if (!["approved", "rejected"].includes(status)) {
      return { ok: false, code: "VALIDATION", errors: ["Trạng thái duyệt không hợp lệ."] };
    }
    const updated = this.store.reviewFeedback({
      actor: result.publicUser,
      feedbackId,
      status,
      note,
      displayDays: displayDays ? Number(displayDays) : null,
      permanent: Boolean(permanent),
    });
    if (!updated.ok) {
      return { ok: false, code: "VALIDATION", errors: updated.errors };
    }
    return { ok: true, feedback: { ...updated.feedback, statusLabel: STATUS_LABELS[status] } };
  }

  /* ---------------------------------- Map ----------------------------------- */

  /** Điểm đã duyệt để vẽ ghim công khai (kèm vài điểm mẫu tĩnh). */
  publicLocations() {
    const categories = this.store.categories();
    const approved = this.store
      .feedbacks()
      .filter((item) => isDisplayActive(item, this.store.now()))
      .map((item) => {
        const location = approvedFeedbackToLocation(item, categories);
        // Kèm nhãn/màu nhóm để UI hiển thị đúng cả nhóm do admin tự thêm.
        const category = categories.find((entry) => entry.id === item.category);
        return {
          ...location,
          categoryLabel: category ? category.label : null,
          categoryIcon: category ? category.icon : null,
          categoryColor: category ? category.color : null,
        };
      });
    return approved;
  }

  /* ------------------------------- Map helpers ------------------------------ */

  /** Danh mục địa bàn 3 tầng đang dùng (db.json), cùng cấu trúc 2 tầng cho UI cũ. */
  regions() {
    return this.store.regions().map((district) => ({
      id: district.districtId,
      name: district.districtName,
      shortName: district.shortName || district.districtName,
      center: district.center || null,
      type: "area",
      wards: district.wards.map((ward) => ({
        id: ward.wardId,
        name: ward.wardName,
        legacy: ward.oldUnits,
        hamlets: ward.hamlets,
        regionId: district.districtId,
      })),
    }));
  }

  wards() {
    return this.regions().flatMap((region) =>
      region.wards.map((ward) => ({ ...ward, regionName: region.name, value: ward.id, label: `${ward.name} · ${region.shortName}` })),
    );
  }

  regionDetail({ regionId } = {}) {
    const region = this.regions().find((item) => item.id === regionId);
    if (!region) return { ok: false, code: "NOT_FOUND", errors: ["Không tìm thấy thành phố/huyện."] };
    const stats = buildStatistics({
      accounts: this.store.publicUsers(),
      feedbacks: this.store.feedbacks(),
      regions: this.regions(),
    }).find((item) => item.id === regionId);
    return { ok: true, region: stats };
  }

  /** Thống kê dùng cho dashboard admin (số tài khoản, phản hồi chờ duyệt...). */
  dashboard({ sessionId } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    const accounts = this.store.publicUsers();
    const feedbacks = filterFeedbacksForUser(this.store.feedbacks(), result.publicUser);
    const pending = feedbacks.filter((item) => item.status === FEEDBACK_STATUS.PENDING);
    return {
      ok: true,
      totals: {
        accounts: result.publicUser.role === "admin" ? accounts.filter((user) => user.role === "ward").length : null,
        wardsCovered: new Set(accounts.filter((user) => user.role === "ward" && user.active).map((user) => user.scope)).size,
        totalWards: WARDS.length,
        feedbacks: feedbacks.length,
        pending: pending.length,
        approved: feedbacks.filter((item) => item.status === FEEDBACK_STATUS.APPROVED).length,
        rejected: feedbacks.filter((item) => item.status === FEEDBACK_STATUS.REJECTED).length,
      },
      latest: pending.slice(0, 5),
      user: result.publicUser,
    };
  }

  /** Đổi tên hiển thị của chính mình (tiện cho demo). */
  updateProfile({ sessionId, displayName } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    const name = normalizeText(displayName);
    if (name.length < 3) return { ok: false, code: "VALIDATION", errors: ["Họ tên phải có ít nhất 3 ký tự."] };
    const next = {
      ...this.store.db,
      users: this.store.db.users.map((user) => (user.id === result.user.id ? { ...user, displayName: name } : user)),
    };
    this.store.commit(next);
    return { ok: true, user: toPublicUser(next.users.find((user) => user.id === result.user.id)) };
  }

  /** Tiện cho UI: danh sách phường/xã theo thành phố. */
  wardsByRegion(regionId) {
    const region = getRegion(regionId);
    if (!region) return [];
    return region.wards.map((ward) => ({ ...WARDS_BY_ID[ward.id] }));
  }

  /** Đảm bảo id tồn tại (dùng cho test). */
  static nextId(prefix) {
    return createId(prefix);
  }

  /* ------------------------ Hạn hiển thị & thông báo ------------------------ */

  /** Gia hạn thêm N ngày hiển thị (cán bộ đúng địa bàn). */
  extendDisplay({ sessionId, feedbackId, days = DISPLAY_DAYS_DEFAULT } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    const updated = this.store.extendDisplay({ actor: result.publicUser, feedbackId, days });
    if (!updated.ok) return { ok: false, code: "VALIDATION", errors: updated.errors };
    return { ok: true, display: updated.display, daysLeft: daysLeft(updated.display ? { status: "approved", display: updated.display } : {}, this.store.now()) };
  }

  /** Gắn hiển thị vĩnh viễn. */
  setPermanentDisplay({ sessionId, feedbackId } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    const updated = this.store.makePermanent({ actor: result.publicUser, feedbackId });
    if (!updated.ok) return { ok: false, code: "VALIDATION", errors: updated.errors };
    return { ok: true, display: updated.display };
  }

  /** Thông báo của chính người đang đăng nhập (admin thấy toàn bộ). */
  notifications({ sessionId } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    const mine = notificationsForUser(this.store.notifications(), result.publicUser);
    return {
      ok: true,
      notifications: mine,
      unread: mine.filter((item) => !item.read).length,
      emergencyUnread: mine.filter((item) => !item.read && item.type === "emergency").length,
    };
  }

  markNotificationRead({ sessionId, notificationId } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    this.store.markNotificationRead({ actor: result.publicUser, notificationId });
    return this.notifications({ sessionId });
  }

  markAllNotificationsRead({ sessionId } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    this.store.markAllRead({ actor: result.publicUser });
    return this.notifications({ sessionId });
  }

  /* --------------------------- Khách & thiết bị --------------------------- */

  /**
   * Đăng ký thiết bị khách từ token (main process cấp/đọc cookie).
   * Trả về deviceId + số lần đã gửi để hiển thị "Bạn đã gửi N phản hồi".
   */
  registerDevice({ deviceToken, ip } = {}) {
    if (!deviceToken) return { ok: false, code: "VALIDATION", errors: ["Thiếu token thiết bị."] };
    const device = this.store.registerDevice({ token: deviceToken, ip });
    return {
      ok: true,
      device: { id: device.id, ip: device.ip, ipMasked: maskIp(device.ip), createdAt: device.createdAt },
      myFeedbackCount: this.store.feedbacksOfDevice(device.id).length,
    };
  }

  /** Các phản hồi đã gửi từ CHÍNH thiết bị này (thiết bị khác không thấy). */
  myFeedbacks({ deviceToken } = {}) {
    if (!deviceToken) return { ok: false, code: "NO_DEVICE", errors: ["Thiết bị này chưa gửi phản hồi nào."] };
    const device = this.store.findDeviceByToken(deviceToken);
    if (!device) {
      return { ok: true, feedbacks: [], count: 0, device: null };
    }
    const feedbacks = this.store.feedbacksOfDevice(device.id).map((item) => ({
      id: item.id,
      fullName: item.fullName,
      category: item.category,
      categoryLabel: (this.store.categories().find((cat) => cat.id === item.category) || {}).label || item.category,
      wardId: item.wardId,
      wardName: findWardInUnits(this.store.regions(), item.wardId)?.name || "",
      hamlet: item.hamlet,
      address: item.address,
      createdAt: item.createdAt,
      status: item.status,
      statusLabel: STATUS_LABELS[item.status] || item.status,
      reviewNote: item.reviewNote || "",
    }));
    return {
      ok: true,
      count: feedbacks.length,
      feedbacks,
      device: { id: device.id, ipMasked: maskIp(device.ip), createdAt: device.createdAt },
    };
  }

  /**
   * Admin: xem IP + thiết bị của một phản hồi (xác định ai gửi và gửi từ đâu).
   * Cán bộ chỉ xem được phản hồi trong địa bàn của mình.
   */
  feedbackOrigin({ sessionId, feedbackId } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    const feedback = this.store.feedbacks().find((item) => item.id === feedbackId);
    if (!feedback) return { ok: false, code: "NOT_FOUND", errors: ["Không tìm thấy phản hồi."] };
    if (result.publicUser.role !== "admin" && feedback.wardId !== result.publicUser.scope) {
      return { ok: false, code: "FORBIDDEN", errors: ["Không có quyền xem phản hồi của địa bàn khác."] };
    }
    const device = feedback.deviceId
      ? this.store.devices().find((item) => item.id === feedback.deviceId)
      : null;
    const deviceCount = feedback.deviceId ? this.store.feedbacksOfDevice(feedback.deviceId).length : 0;
    return {
      ok: true,
      origin: {
        ip: feedback.ip || "",
        ipMasked: feedback.ipMasked || maskIp(feedback.ip),
        ipLocation: feedback.ipLocation || null,
        // Địa chỉ và GPS là vị trí phản hồi thực tế; không nhầm với ước lượng theo IP.
        address: feedback.address || "",
        lat: Number.isFinite(Number(feedback.lat)) ? Number(feedback.lat) : null,
        lng: Number.isFinite(Number(feedback.lng)) ? Number(feedback.lng) : null,
        wardId: feedback.wardId || null,
        deviceId: feedback.deviceId || null,
        deviceLabel: device ? device.label : null,
        deviceFirstSeen: device ? device.createdAt : null,
        deviceLastSeen: device ? device.lastSeenAt : null,
        submissionsFromDevice: deviceCount,
        submittedFrom: feedback.submittedFrom || "desktop",
        deviceInfo: feedback.deviceInfo || null,
      },
    };
  }

  /**
   * Cấp Tỉnh nhắc duyệt: gửi thông báo tới mọi cán bộ còn phản hồi chờ duyệt.
   * Mỗi cán bộ nhận đúng số phản hồi của địa bàn mình.
   */
  /**
   * Yêu cầu cán bộ của một phường/xã rà soát và cập nhật danh sách điểm hỗ trợ.
   * Dùng ở tab Xã/Phường (nút trên mỗi thẻ).
   */
  requestUpdate({ sessionId, wardId, note = "" } = {}) {
    const result = this.requireSession(sessionId);
    if (!result.ok) return result;
    const ward = findWardInUnits(this.store.regions(), wardId);
    if (!ward) return { ok: false, code: "VALIDATION", errors: ["Không tìm thấy Phường/Xã."] };

    // Cán bộ chỉ được yêu cầu cho đúng địa bàn của mình.
    if (result.publicUser.role !== "admin" && result.publicUser.scope !== wardId) {
      return { ok: false, code: "FORBIDDEN", errors: ["Chỉ được yêu cầu cho địa bàn mình phụ trách."] };
    }

    const officer = this.store
      .publicUsers()
      .find((user) => user.role === "ward" && user.scope === wardId && user.active !== false);
    const notification = updateRequestNotification({
      wardId,
      wardName: ward.name,
      accountUsername: officer ? officer.username : null,
      requestedBy: result.publicUser.username,
      note,
      now: this.store.now(),
    });
    this.store.addNotification(notification);
    return {
      ok: true,
      notification,
      deliveredTo: officer ? officer.displayName : null,
      message: officer
        ? `Đã gửi yêu cầu cập nhật tới ${officer.displayName} (${ward.name}).`
        : `Đã tạo yêu cầu cập nhật cho ${ward.name} — chưa có cán bộ phụ trách để nhận thông báo.`,
    };
  }

  remindReviewers({ sessionId } = {}) {
    const result = this.requireAdmin(sessionId);
    if (!result.ok) return result;
    const now = this.store.now();
    const officers = this.store.publicUsers().filter((user) => user.role === "ward" && user.active);
    const pending = this.store.feedbacks().filter((item) => item.status === FEEDBACK_STATUS.PENDING);
    const sent = [];
    for (const officer of officers) {
      const count = pending.filter((item) => item.wardId === officer.scope).length;
      if (!count) continue;
      const notification = reminderNotification({
        username: officer.username,
        wardName: officer.scopeName,
        pendingCount: count,
        createdBy: result.publicUser.username,
        now,
      });
      this.store.addNotification(notification);
      sent.push({ username: officer.username, pendingCount: count, wardName: officer.scopeName });
    }
    return {
      ok: true,
      sent,
      total: sent.reduce((sum, item) => sum + item.pendingCount, 0),
      message: sent.length
        ? `Đã nhắc ${sent.length} cán bộ về ${sent.reduce((sum, item) => sum + item.pendingCount, 0)} phản hồi chờ duyệt.`
        : "Không có cán bộ nào đang có phản hồi chờ duyệt.",
    };
  }
}
