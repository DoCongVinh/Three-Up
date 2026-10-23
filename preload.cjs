/**
 * Preload (CommonJS) - cầu nối an toàn giữa renderer và main process.
 *
 * Renderer KHÔNG có quyền Node. Mọi thứ đi qua window.khanhHoa với 1 hàm
 * request(channel, payload) => Promise<{ ok, ... }>.
 */
const { contextBridge, ipcRenderer } = require("electron");

/** Kênh duy nhất tới main (trùng REQUEST_CHANNEL trong main.js). */
const REQUEST_CHANNEL = "khanhhoa:request";

const ALLOWED_CHANNELS = new Set([
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

async function request(channel, payload = {}) {
  if (!ALLOWED_CHANNELS.has(channel)) {
    return { ok: false, code: "UNKNOWN_CHANNEL", errors: [`Kênh không hỗ trợ: ${channel}`] };
  }
  try {
    return await ipcRenderer.invoke(REQUEST_CHANNEL, { channel, payload });
  } catch (error) {
    return { ok: false, code: "IPC_FAILED", errors: [error?.message || "Không gọi được tiến trình chính."] };
  }
}

contextBridge.exposeInMainWorld("khanhHoa", {
  isDesktop: true,
  platform: process.platform,
  request,
  channels: () => Array.from(ALLOWED_CHANNELS),
});
