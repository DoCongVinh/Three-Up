/**
 * Cầu nối web cho app.js (front-end hiện có).
 *
 * app.js chỉ gọi `window.khanhHoa.request(channel, payload)`. Trên desktop, hàm
 * này do preload.cjs cung cấp (IPC -> main process). Trên web, file này cung cấp
 * cùng API đó nhưng nói chuyện với server.js qua REST (fetch) + Socket.io.
 *
 * Nạp file này TRƯỚC app.js:
 *   <script src="/js/khanhHoa-web.js"></script>
 *   <script src="app.js"></script>
 *
 * Không chứa mật khẩu/khóa bí mật: mọi kiểm tra quyền đều nằm ở server.
 */
(() => {
  "use strict";
  // Không ghi đè bridge Electron hoặc bridge web đã khởi tạo.
  if (window.khanhHoa?.isDesktop || window.khanhHoa?.isWebServer) return;

  const API_BASE = window.KHANHHOA_API_BASE || "/api";
  const STORAGE_KEY = "khanhhoa.web.session";
  const DEVICE_KEY = "khanhhoa.web.deviceToken";

  /** Chỉ kênh native picker bị cấm; các kênh còn lại chạy qua /api/rpc. */
  const UNSUPPORTED = {
    "dialog:pickImages": "Chọn ảnh bằng nút tải tệp của trình duyệt.",
    "image:save": "Tải ảnh bằng window.khanhHoa.uploadImage().",
  };

  /* ------------------------------- Session -------------------------------- */

  const session = {
    get() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      } catch {
        return null;
      }
    },
    save(data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    },
    clear() {
      localStorage.removeItem(STORAGE_KEY);
    },
    token() {
      const saved = this.get();
      return saved?.sessionId || saved?.token || "";
    },
  };

  /** Mã thiết bị của người dân — để nhận đúng sự kiện 'feedback-confirmed'. */
  const device = {
    get() {
      try {
        let token = localStorage.getItem(DEVICE_KEY);
        if (!token && globalThis.crypto?.randomUUID) {
          token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
          localStorage.setItem(DEVICE_KEY, token);
        }
        return token || "";
      } catch { return ""; }
    },
    set(token) {
      if (token) { try { localStorage.setItem(DEVICE_KEY, token); } catch { /* storage có thể bị tắt */ } }
    },
  };

  function getSessionDeviceToken() {
    try {
      let token = localStorage.getItem(DEVICE_KEY);
      if (!token && window.crypto?.randomUUID) {
        token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        localStorage.setItem(DEVICE_KEY, token);
      }
      return token || "";
    } catch { return ""; }
  }

  /* --------------------------------- REST --------------------------------- */

  async function request(path, { method = "GET", body, auth = false, headers: extraHeaders = {} } = {}) {
    const headers = { Accept: "application/json", ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && session.token()) headers.Authorization = `Bearer ${session.token()}`;
    if (getSessionDeviceToken()) headers["X-Device-Token"] = getSessionDeviceToken();

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        credentials: "same-origin",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          code: data.code || `HTTP_${response.status}`,
          errors: data.errors || [data.error || "Máy chủ trả lỗi."],
        };
      }
      // Server trả về deviceToken mới -> nhớ lại để nhận thông báo xác nhận.
      if (data.deviceToken) device.set(data.deviceToken);
      return data;
    } catch (error) {
      return { ok: false, code: "NETWORK", errors: ["Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại."] };
    }
  }

  /* ------------------------------ Socket.io ------------------------------- */

  const realtime = {
    socket: null,
    ready: false,

    connect() {
      if (this.socket) return this.socket;
      if (typeof window.io !== "function") return null;
      this.socket = window.io({
        auth: {
          role: session.token() ? "officer" : "citizen",
          sessionId: session.token(),
          token: window.KHANHHOA_SOCKET_TOKEN || undefined,
          deviceToken: getSessionDeviceToken() || undefined,
        },
      });
      this.socket.on("connect", () => {
        this.ready = true;
        const token = session.token();
        if (token) this.socket.emit("officer:subscribe", { sessionId: token });
        const deviceToken = getSessionDeviceToken();
        if (deviceToken) this.socket.emit("citizen:subscribe", { deviceToken });
      });
      this.socket.on("disconnect", () => {
        this.ready = false;
      });
      return this.socket;
    },

    /** Gửi lại đăng ký sau khi đăng nhập / sau khi có deviceToken mới. */
    subscribe() {
      if (!this.socket) return;
      const token = session.token();
      if (token) this.socket.emit("officer:subscribe", { sessionId: token });
      const deviceToken = getSessionDeviceToken();
      if (deviceToken) this.socket.emit("citizen:subscribe", { deviceToken });
    },

    on(event, handler) {
      this.connect()?.on(event, handler);
    },
  };

  /* ------------------------------- Channels ------------------------------- */

  const routes = {
    "auth:login": ({ username, password }) =>
      request("/auth/login", { method: "POST", body: { username, password } }).then((result) => {
        if (result.ok) {
          session.save({ token: result.token || result.sessionId, sessionId: result.sessionId || result.token, user: result.user });
          realtime.connect();
          realtime.subscribe();
        }
        return result;
      }),

    "auth:logout": () =>
      request("/auth/logout", { method: "POST", auth: true, body: {} }).then((result) => {
        session.clear();
        return result;
      }),

    "auth:me": () => {
      if (!session.token()) return Promise.resolve({ ok: false, code: "UNAUTHENTICATED", errors: ["Chưa đăng nhập."] });
      return request("/auth/me", { auth: true });
    },
    "auth:changePassword": (payload) => request("/auth/change-password", { method: "POST", body: payload, auth: true }),

    "feedback:submit": (payload) => request("/rpc/feedback:submit", { method: "POST", body: payload }).then((result) => {
      if (result.ok && result.deviceToken) device.set(result.deviceToken);
      realtime.subscribe();
      return result;
    }),

    "feedback:list": ({ status, ...payload } = {}) => request(`/rpc/feedback:list`, { method: "POST", body: { ...payload, status }, auth: true }),
    "feedback:review": (payload) => request("/rpc/feedback:review", { method: "POST", body: payload, auth: true }),
    "feedback:extendDisplay": (payload) => request("/rpc/feedback:extendDisplay", { method: "POST", body: payload, auth: true }),
    "feedback:setPermanent": (payload) => request("/rpc/feedback:setPermanent", { method: "POST", body: payload, auth: true }),
    "feedback:origin": (payload) => request("/rpc/feedback:origin", { method: "POST", body: payload, auth: true }),
    "feedback:publicLocations": () => request("/public-locations"),
    "regions:units": () => request("/regions"),
    "directory:regions": () => request("/rpc/directory:regions", { method: "POST", body: {} }),
    "directory:wards": () => request("/wards"),
    "directory:statistics": (payload = {}) => request(`/directory/statistics${payload.regionId ? `?regionId=${encodeURIComponent(payload.regionId)}` : ""}`, { auth: true }),
    "accounts:list": () => request("/accounts/list", { auth: true }),
    "profile:update": (payload) => request("/profile/update", { method: "POST", body: payload, auth: true }),
    "categories:list": () => request("/categories"),
    "categories:create": (payload) => request("/rpc/categories:create", { method: "POST", body: payload, auth: true }),
    "categories:update": (payload) => request("/rpc/categories:update", { method: "POST", body: payload, auth: true }),
    "categories:delete": (payload) => request("/rpc/categories:delete", { method: "POST", body: payload, auth: true }),
    "regions:create": (payload) => request("/rpc/regions:create", { method: "POST", body: payload, auth: true }),
    "regions:update": (payload) => request("/rpc/regions:update", { method: "POST", body: payload, auth: true }),
    "regions:delete": (payload) => request("/rpc/regions:delete", { method: "POST", body: payload, auth: true }),
    "device:register": (payload) => request("/rpc/device:register", { method: "POST", body: payload }),
    "device:myFeedbackIds": (payload) => request("/rpc/device:myFeedbacks", { method: "POST", body: payload }),
    "device:myFeedbacks": (payload) => request("/rpc/device:myFeedbacks", { method: "POST", body: payload }),
    "image:url": (payload) => request("/rpc/image:url", { method: "POST", body: payload }),
    "app:info": () => request("/health"),
    "dashboard:summary": (payload) => request("/rpc/dashboard:summary", { method: "POST", body: payload, auth: true }),

    "accounts:create": (payload) => request("/rpc/accounts:create", { method: "POST", body: payload, auth: true }),
    "accounts:setActive": (payload) => request("/rpc/accounts:setActive", { method: "POST", body: payload, auth: true }),
    "accounts:update": (payload) => request("/rpc/accounts:update", { method: "POST", body: payload, auth: true }),
    "accounts:resetPassword": (payload) => request("/rpc/accounts:resetPassword", { method: "POST", body: payload, auth: true }),
    "notifications:list": (payload) => request("/rpc/notifications:list", { method: "POST", body: payload, auth: true }),
    "notifications:read": (payload) => request("/rpc/notifications:read", { method: "POST", body: payload, auth: true }),
    "notifications:readAll": (payload) => request("/rpc/notifications:readAll", { method: "POST", body: payload, auth: true }),
    "notifications:remindReviewers": (payload) => request("/rpc/notifications:remindReviewers", { method: "POST", body: payload, auth: true }),
    "notifications:requestUpdate": (payload) => request("/rpc/notifications:requestUpdate", { method: "POST", body: payload, auth: true }),

    "image:url": (payload) => request("/rpc/image:url", { method: "POST", body: payload }),
  };

  async function handleRequest(channel, payload = {}) {
    if (UNSUPPORTED[channel]) return { ok: false, code: "UNSUPPORTED_ON_WEB", errors: [UNSUPPORTED[channel]] };
    const handler = routes[channel];
    if (handler) return handler(payload);
    // All remaining AppService/IPC channels use the server's authenticated RPC adapter.
    const publicChannels = new Set(["feedback:submit", "feedback:publicLocations", "directory:regions", "directory:wards", "directory:statistics", "regions:units", "device:register", "device:myFeedbacks", "feedback:origin"]);
    const auth = !publicChannels.has(channel);
    return request(`/rpc/${encodeURIComponent(channel)}`, { method: "POST", body: payload, auth });
  }

  const STATUS_LABEL = { pending: "Chờ xác minh", approved: "Đã xác nhận", rejected: "Từ chối" };

  /** Trang thái đồng bộ giữa hai phía: 'approved' = Đã xác nhận / Online. */
  const toClientFeedback = (item) => ({
    ...item,
    statusLabel: STATUS_LABEL[item.status] || item.statusLabel || item.status,
    online: item.status === "approved",
  });

  /** Chuyển kết quả nghiệp vụ sang dạng app.js đang mong đợi. */
  const compatRoutes = {
    "feedback:list": (payload = {}) => request("/rpc/feedback:list", { method: "POST", body: payload, auth: true }).then((result) =>
      result.ok ? { ...result, feedbacks: (result.feedbacks || []).map(toClientFeedback) } : result),
    "device:myFeedbacks": (payload = {}) => request("/rpc/device:myFeedbacks", { method: "POST", body: payload }).then((result) =>
      result.ok ? { ...result, feedbacks: (result.feedbacks || []).map(toClientFeedback) } : result),
  };

  async function uploadImage(file, pendingId = "") {
    if (!(file instanceof Blob)) return { ok: false, errors: ["Tệp ảnh không hợp lệ."] };
    const query = pendingId ? `?pendingId=${encodeURIComponent(pendingId)}` : "";
    try {
      const headers = { "Content-Type": file.type };
      if (session.token()) headers.Authorization = `Bearer ${session.token()}`;
      const response = await fetch(`${API_BASE}/images${query}`, { method: "POST", headers, body: file, credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      return response.ok ? data : { ok: false, errors: [data.error || "Không tải được ảnh."] };
    } catch (error) { return { ok: false, errors: [error.message || "Không tải được ảnh."] }; }
  }

  window.khanhHoa = {
    isDesktop: false,
    isWebServer: true,
    platform: "web",
    request: (channel, payload = {}) => (compatRoutes[channel] || routes[channel] || ((p) => handleRequest(channel, p)))(payload),
    channels: () => Object.keys(routes).concat(Object.keys(compatRoutes), Object.keys(UNSUPPORTED)),
    socket: () => realtime.connect(),
    onRealtime: (event, handler) => realtime.on(event, handler),
    uploadImage,
    publicLocations: async () => { const result = await request("/public-locations"); return result.ok ? result.locations : []; },
    restoreSession: async () => {
      const saved = session.get();
      if (!saved?.sessionId && !saved?.token) return null;
      const result = await request("/auth/me", { auth: true });
      if (!result.ok) { session.clear(); return null; }
      saved.user = result.user; saved.sessionId = saved.sessionId || saved.token; session.save(saved); realtime.connect();
      return saved;
    },
    session,
    device,
  };
})();
