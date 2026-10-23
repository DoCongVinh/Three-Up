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

  const API_BASE = window.KHANHHOA_API_BASE || "/api";
  const STORAGE_KEY = "khanhhoa.web.session";
  const DEVICE_KEY = "khanhhoa.web.deviceToken";

  /** Các kênh app.js dùng mà bản web chưa hỗ trợ (ảnh, hộp thoại desktop). */
  const UNSUPPORTED = {
    "dialog:pickImages": "Chọn ảnh từ máy chỉ có trên bản desktop. Trên web hãy dùng nút chụp/chọn ảnh của trình duyệt.",
    "image:save": "Tải ảnh lên chỉ có trên bản desktop.",
    "image:url": "Ảnh đính kèm chưa hỗ trợ trên web.",
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
      return this.get()?.token || "";
    },
  };

  /** Mã thiết bị của người dân — để nhận đúng sự kiện 'feedback-confirmed'. */
  const device = {
    get() {
      let token = localStorage.getItem(DEVICE_KEY);
      if (!token) {
        token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        localStorage.setItem(DEVICE_KEY, token);
      }
      return token;
    },
    set(token) {
      if (token) localStorage.setItem(DEVICE_KEY, token);
    },
  };

  /* --------------------------------- REST --------------------------------- */

  async function request(path, { method = "GET", body, auth = false } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) headers.Authorization = `Bearer ${session.token()}`;
    headers["X-Device-Token"] = device.get();

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
      if (this.socket || typeof io !== "function") return this.socket;
      this.socket = io({ auth: { token: window.KHANHHOA_SOCKET_TOKEN || undefined } });
      this.socket.on("connect", () => {
        this.ready = true;
        const token = session.token();
        if (token) this.socket.emit("officer:subscribe", { token });
        this.socket.emit("citizen:subscribe", { deviceToken: device.get() });
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
      if (token) this.socket.emit("officer:subscribe", { token });
      this.socket.emit("citizen:subscribe", { deviceToken: device.get() });
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
          session.save({ token: result.token, user: result.user });
          realtime.subscribe();
        }
        return result;
      }),

    "auth:logout": () =>
      request("/auth/logout", { method: "POST", auth: true }).then((result) => {
        session.clear();
        return result;
      }),

    "auth:me": () => {
      if (!session.token()) return Promise.resolve({ ok: false, code: "UNAUTHENTICATED", errors: ["Chưa đăng nhập."] });
      return request("/auth/me", { auth: true });
    },

    "feedback:submit": (payload) => request("/feedbacks", { method: "POST", body: payload }),

    "feedback:list": ({ status } = {}) =>
      request(`/feedbacks?status=${encodeURIComponent(status || "all")}`, { auth: true }),

    "feedback:review": ({ feedbackId, status, note }) =>
      status === "approved"
        ? request(`/feedbacks/${encodeURIComponent(feedbackId)}/confirm`, { method: "POST", body: { note }, auth: true })
        : request(`/feedbacks/${encodeURIComponent(feedbackId)}/reject`, { method: "POST", body: { reason: note }, auth: true }),

    "feedback:publicLocations": () => request("/public-locations"),

    "regions:units": () => request("/regions"),

    "directory:regions": () =>
      request("/regions").then((result) =>
        result.ok ? { ok: true, regions: result.regions, categories: result.categories } : result,
      ),

    "device:myFeedbackIds": () => request("/my-feedbacks"),

    "device:myFeedbacks": () => request("/my-feedbacks"),
  };

  async function handleRequest(channel, payload = {}) {
    if (UNSUPPORTED[channel]) {
      return { ok: false, code: "UNSUPPORTED_ON_WEB", errors: [UNSUPPORTED[channel]] };
    }
    const handler = routes[channel];
    if (!handler) {
      return { ok: false, code: "UNKNOWN_CHANNEL", errors: [`Kênh chưa hỗ trợ trên bản web: ${channel}`] };
    }
    return handler(payload);
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
    "feedback:list": (payload) =>
      request(`/feedbacks?status=${encodeURIComponent(payload.status || "all")}`, { auth: true }).then((result) =>
        result.ok ? { ...result, feedbacks: (result.feedbacks || []).map(toClientFeedback) } : result,
      ),

    "device:myFeedbacks": () =>
      request("/my-feedbacks").then((result) =>
        result.ok ? { ...result, feedbacks: (result.feedbacks || []).map(toClientFeedback) } : result,
      ),
  };

  window.khanhHoa = {
    isDesktop: false,
    platform: "web",
    request: (channel, payload = {}) => (compatRoutes[channel] || handleRequest)(channel, payload),
    channels: () => Object.keys(routes).concat(Object.keys(compatRoutes), Object.keys(UNSUPPORTED)),
    // Tiện ích cho trang tùy biến / trang cán bộ thời gian thực.
    socket: () => realtime.connect(),
    onRealtime: (event, handler) => realtime.on(event, handler),
    session,
    device,
  };
})();
