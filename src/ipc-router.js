/**
 * Bản ủi IPC: nhận request { channel, payload } từ preload, kiểm tra kênh,
 * gọi AppService tương ứng và luôn trả về { ok, ... } (không ném lỗi thô).
 */

export const CHANNELS = Object.freeze([
  "auth:login",
  "auth:logout",
  "auth:me",
  "auth:changePassword",
  "directory:regions",
  "directory:wards",
  "directory:statistics",
  "directory:region",
  "regions:units",
  "regions:create",
  "regions:update",
  "regions:delete",
  "categories:list",
  "categories:create",
  "categories:update",
  "categories:delete",
  "accounts:list",
  "accounts:create",
  "accounts:setActive",
  "accounts:update",
  "accounts:resetPassword",
  "feedback:submit",
  "feedback:list",
  "feedback:review",
  "feedback:publicLocations",
  "feedback:extendDisplay",
  "feedback:setPermanent",
  "notifications:list",
  "notifications:read",
  "notifications:readAll",
  "notifications:remindReviewers",
  "notifications:requestUpdate",
  "device:register",
  "device:myFeedbacks",
  "feedback:origin",
  "dashboard:summary",
  "profile:update",
  "dialog:pickImages",
  "image:save",
  "image:url",
  "app:info",
]);

/**
 * Tạo router. `deps` cung cấp service, image helpers và dialog picker.
 */
export function createIpcRouter(deps) {
  const { service, images, pickImages, appInfo } = deps;

  const routes = {
    "auth:login": (payload) => service.login(payload || {}),
    "auth:logout": (payload) => service.logout(payload || {}),
    "auth:me": (payload) => service.me(payload || {}),
    "auth:changePassword": (payload) => service.changePassword(payload || {}),

    "directory:regions": () => ({ ok: true, regions: service.regions() }),
    "directory:wards": () => ({ ok: true, wards: service.wards() }),
    "directory:statistics": (payload) => service.directory(payload || {}),
    "directory:region": (payload) => service.regionDetail(payload || {}),

    "regions:units": () => ({ ok: true, units: service.administrativeUnits(), categories: service.categories() }),
    "categories:list": () => ({ ok: true, categories: service.categories() }),
    "categories:create": (payload) => service.createCategory(payload || {}),
    "categories:update": (payload) => service.updateCategory(payload || {}),
    "categories:delete": (payload) => service.deleteCategory(payload || {}),
    "regions:create": (payload) => service.createWard(payload || {}),
    "regions:update": (payload) => service.updateWard(payload || {}),
    "regions:delete": (payload) => service.deleteWard(payload || {}),

    "accounts:list": (payload) => service.listAccounts(payload || {}),
    "accounts:create": (payload) => service.createAccount(payload || {}),
    "accounts:setActive": (payload) => service.setAccountActive(payload || {}),
    "accounts:update": (payload) => service.updateAccount(payload || {}),
    "accounts:resetPassword": (payload) => service.resetAccountPassword(payload || {}),

    "feedback:submit": (payload) => service.submitFeedback(payload || {}),
    "feedback:list": (payload) => service.listFeedbacks(payload || {}),
    "feedback:review": (payload) => service.reviewFeedback(payload || {}),
    "feedback:publicLocations": () => ({ ok: true, locations: service.publicLocations() }),
    "feedback:extendDisplay": (payload) => service.extendDisplay(payload || {}),
    "feedback:setPermanent": (payload) => service.setPermanentDisplay(payload || {}),

    "notifications:list": (payload) => service.notifications(payload || {}),
    "notifications:read": (payload) => service.markNotificationRead(payload || {}),
    "notifications:readAll": (payload) => service.markAllNotificationsRead(payload || {}),
    "notifications:remindReviewers": (payload) => service.remindReviewers(payload || {}),
    "notifications:requestUpdate": (payload) => service.requestUpdate(payload || {}),
    "device:register": (payload) => service.registerDevice(payload || {}),
    "device:myFeedbacks": (payload) => service.myFeedbacks(payload || {}),
    "feedback:origin": (payload) => service.feedbackOrigin(payload || {}),

    "dashboard:summary": (payload) => service.dashboard(payload || {}),
    "profile:update": (payload) => service.updateProfile(payload || {}),

    "dialog:pickImages": async () => pickImages(),
    "image:save": async (payload) => images.save({ sourcePath: payload?.sourcePath }),
    "image:url": (payload) => ({ ok: true, url: images.url(payload?.feedbackId, payload?.name) }),
    "app:info": () => ({ ok: true, ...appInfo() }),
  };

  /** Xử lý 1 request; không bao giờ throw. */
  async function handle(request) {
    const channel = request?.channel;
    if (!CHANNELS.includes(channel)) {
      return { ok: false, code: "UNKNOWN_CHANNEL", errors: [`Kênh không hỗ trợ: ${String(channel)}`] };
    }
    try {
      return await routes[channel](request.payload || {});
    } catch (error) {
      return { ok: false, code: "INTERNAL", errors: [error?.message || "Lỗi không xác định."] };
    }
  }

  return { handle, channels: [...CHANNELS], routes };
}
