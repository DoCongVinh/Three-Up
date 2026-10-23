/**
 * Bản đồ Yêu thương Khánh Hòa — máy chủ web (Node.js + Express + SQLite + Socket.io).
 *
 * Chạy:   npm run start:web        (mặc định http://localhost:3000)
 * Cổng:   PORT=8080 npm run start:web
 * DB:     KHANHHOA_WEB_DB=./data/khanhhoa.db (mặc định ./data/khanhhoa.db)
 *
 * Kiến trúc:
 *  - REST API cho cả hai phía: người dân (không đăng nhập) và cán bộ (Bearer session).
 *  - Socket.io phát thông báo thời gian thực:
 *      · 'new-feedback'        -> cán bộ (đúng phường/xã hoặc Cấp Tỉnh) phát thông báo
 *      · 'feedback-confirmed'  -> người dân (phòng theo mã thiết bị) đổi trạng thái
 *  - Trả về đúng dạng { ok, ... } mà app.js / AppService đang dùng để giao diện
 *    desktop và bản web dùng chung một cấu trúc dữ liệu.
 *
 * Biến môi trường:
 *  - PORT, HOST                 cổng và địa chỉ lắng nghe
 *  - KHANHHOA_WEB_DB            đường dẫn file SQLite
 *  - KHANHHOA_ADMIN_PASSWORD    mật khẩu admin mặc định (chỉ dùng khi DB rỗng)
 *  - KHANHHOA_SOCKET_TOKEN      nếu đặt: client phải gửi token này khi kết nối socket
 *  - KHANHHOA_CORS_ORIGIN       nguồn được phép gọi API (mặc định: cùng nguồn)
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { Server as SocketServer } from "socket.io";

import { DataStore } from "./src/data-store.js";
import { AppService } from "./src/app-service.js";
import {
  FEEDBACK_STATUS,
  ROLE_ADMIN,
  ROLE_WARD,
  STATUS_LABELS,
  buildFeedback,
  canReview,
  createId,
  findWardInUnits,
  sanitizeText,
} from "./src/data-model.js";
import { DEVICE_COOKIE, DEVICE_TOKEN_TTL_DAYS, createDeviceToken, normalizeIp } from "./src/devices.js";
import { WebDatabase, maskIp, rowToFeedback, rowToUser, verifyPassword } from "./src/web-db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_PORT = 3000;
/** Thời gian sống của phiên đăng nhập cán bộ (8 giờ, như bản desktop). */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/* =============================== Helpers ================================== */

/** Khoá của một thiết bị người dân: chỉ lưu hash sha256, không lưu token thô. */
export function deviceKey(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  return /^Bearer\s+(.+)$/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : "";
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return normalizeIp(forwarded || req.socket?.remoteAddress || "");
}

/** Chỉ nhận tệp .png/.jpg/.jpeg/.webp trơn (không đường dẫn) — chống path traversal. */
function safeImageName(name) {
  const base = String(name || "").split(/[\\/]/).pop();
  return /^[\w-]+\.(png|jpe?g|webp)$/i.test(base) ? base : null;
}

function wardNameOf(store, wardId) {
  const ward = findWardInUnits(store.regions(), wardId);
  return ward?.name || ward?.wardName || "";
}

/* ============================ App factory ================================= */

/**
 * Tạo ứng dụng Express + Socket.io (tách khỏi listen() để test được).
 *
 * @param {{
 *   dbPath?: string,
 *   publicDir?: string,
 *   corsOrigin?: string | string[] | false,
 *   socketToken?: string,
 *   seedDemo?: boolean,
 *   adminPassword?: string,
 * }} [options]
 */
export function createWebApp(options = {}) {
  const dbPath = resolve(options.dbPath || process.env.KHANHHOA_WEB_DB || join(__dirname, "data", "khanhhoa.db"));
  const publicDir = resolve(options.publicDir || join(__dirname, "public"));
  const corsOrigin = options.corsOrigin ?? process.env.KHANHHOA_CORS_ORIGIN ?? false;
  const socketToken = options.socketToken ?? process.env.KHANHHOA_SOCKET_TOKEN ?? "";

  /* ------------------------------ Dữ liệu ------------------------------- */
  const store = new DataStore(join(dirname(dbPath), "db.json"), {
    allowSeed: false,
    seedFeedback: false,
    seedAdminPassword: options.adminPassword || process.env.KHANHHOA_ADMIN_PASSWORD || "Admin@2025",
  });
  const webDb = new WebDatabase(dbPath, { seedDemo: options.seedDemo !== false });
  const service = new AppService(store);

  /** Phiên cán bộ: token ngẫu nhiên -> { userId, expiresAt }. Sống trong RAM. */
  const sessions = new Map();

  function resolveSession(token) {
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    const row = webDb.findUserById(session.userId);
    if (!row || !row.active) {
      sessions.delete(token);
      return null;
    }
    return { token, user: rowToUser(row) };
  }

  function createSession(user) {
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
    return token;
  }

  /** Middleware xác thực cán bộ; gắn req.user. */
  function requireUser(req, res, next) {
    const session = resolveSession(bearerToken(req));
    if (!session) {
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED", error: "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại." });
    }
    req.session = session;
    req.user = session.user;
    return next();
  }

  /**
   * Cán bộ chỉ được xác nhận phản hồi thuộc phường/xã mình phụ trách. Cấp Tỉnh
   * mặc định cũng được xác nhận trên bản web (bản desktop để Cấp Tỉnh chỉ đọc);
   * đặt KHANHHOA_ADMIN_CAN_CONFIRM=false để giữ đúng nghiệp vụ desktop.
   */
  const adminCanConfirm = String(process.env.KHANHHOA_ADMIN_CAN_CONFIRM ?? "true").toLowerCase() !== "false";
  const canConfirm = (user, feedback) =>
    canReview(user, feedback) || (adminCanConfirm && user.role === ROLE_ADMIN);

  /* ------------------------------ Express -------------------------------- */
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  if (corsOrigin) {
    app.use((req, res, next) => {
      const origin = String(corsOrigin) === "*" ? "*" : String(corsOrigin).split(",")[0].trim();
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Token");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") return res.sendStatus(204);
      return next();
    });
  }

  // Phiên bản app để client biết đang chạy backend web.
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "khanhhoa-web", version: "2.0.0", time: new Date().toISOString() });
  });

  /* ------------------------------ Auth ----------------------------------- */

  app.post("/api/auth/login", (req, res) => {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const row = webDb.findUserByUsername(username);
    const valid = row && row.active && verifyPassword(password, row.password_hash);
    if (!valid) {
      return res.status(401).json({ ok: false, code: "INVALID_CREDENTIALS", error: "Tên đăng nhập hoặc mật khẩu không đúng." });
    }
    webDb.touchLogin(row.id);
    const user = rowToUser(row);
    // Socket của cán bộ join phòng riêng theo phường/xã + phòng Cấp Tỉnh.
    res.json({ ok: true, token: createSession(user), user, mustChangePassword: false });
  });

  app.get("/api/auth/me", requireUser, (req, res) => {
    res.json({ ok: true, user: req.user });
  });

  app.post("/api/auth/logout", requireUser, (req, res) => {
    sessions.delete(req.session.token);
    res.json({ ok: true });
  });

  /* --------------------------- Dữ liệu danh mục -------------------------- */

  app.get("/api/regions", (_req, res) => {
    res.json({ ok: true, regions: store.regions(), categories: store.categories() });
  });

  /* ------------------------------ Feedbacks ------------------------------ */

  /**
   * Người dân gửi phản hồi (không cần đăng nhập).
   * Body: fullName, phone, email, address, reason, category, wardId, hamlet, lat, lng
   */
  app.post("/api/feedbacks", (req, res) => {
    const body = req.body || {};
    const ip = clientIp(req);
    // Mã thiết bị: ưu tiên header X-Device-Token, sau đó cookie kh_device, cuối cùng là IP+UA.
    const headerToken = String(req.headers["x-device-token"] || "").trim();
    const cookieToken = readCookie(req, DEVICE_COOKIE);
    const deviceToken = headerToken || cookieToken || createDeviceToken();
    const key = deviceKey(deviceToken);

    const built = buildFeedback(
      {
        ...body,
        ip,
        clientIp: ip,
        ipMasked: maskIp(ip),
        deviceId: key,
        submittedFrom: "web",
        deviceInfo: {
          userAgent: sanitizeText(req.headers["user-agent"], 300),
          mode: "web",
        },
        images: Array.isArray(body.images) ? body.images.filter(safeImageName) : [],
      },
      { id: createId("fb"), units: store.regions(), categories: store.categories() },
    );

    if (!built.ok) {
      return res.status(400).json({
        ok: false,
        code: "VALIDATION",
        error: built.errors[0],
        errors: built.errors,
        fieldErrors: {},
      });
    }

    const wardName = wardNameOf(store, built.feedback.wardId);
    const feedback = webDb.insertFeedback({ ...built.feedback, wardName });
    const publicFeedback = publicFeedbackView(feedback);

    // Đếm số phản hồi thiết bị này đã gửi (cảnh báo spam phía cán bộ).
    const submissionsFromDevice = webDb.feedbackIdsOfDevice(key).length;

    // Bắn thông báo tới máy cán bộ: đúng phường/xã + tất cả Cấp Tỉnh.
    io.to(`ward:${feedback.wardId}`).to("role:admin").emit("new-feedback", {
      feedback: publicFeedback,
      submittedAt: feedback.createdAt,
      wardName,
      emergency: feedback.category === "khan_cap",
      submissionsFromDevice,
      unreadPending: webDb.countByStatus().pending,
    });
    io.to("role:admin").emit("dashboard:counts", webDb.countByStatus());

    // Thiết bị mới -> đặt cookie HttpOnly để các lần sau tra lại đúng phản hồi của mình.
    if (!headerToken && !cookieToken) {
      const maxAge = DEVICE_TOKEN_TTL_DAYS * 24 * 60 * 60;
      res.setHeader(
        "Set-Cookie",
        `${DEVICE_COOKIE}=${encodeURIComponent(deviceToken)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`,
      );
    }

    res.status(201).json({
      ok: true,
      feedbackId: feedback.id,
      feedback: publicFeedback,
      deviceToken,
      wardId: feedback.wardId,
      wardName,
      emergency: feedback.category === "khan_cap",
      message: feedback.category === "khan_cap"
        ? `Đã gửi cảnh báo khẩn cấp tới cán bộ ${wardName || "phường/xã"}.`
        : `Đã gửi tới cán bộ ${wardName || "phường/xã"} để xác minh.`,
    });
  });

  /** Danh sách phản hồi cho cán bộ (lọc theo trạng thái; Cấp Tỉnh xem tất cả). */
  app.get("/api/feedbacks", requireUser, (req, res) => {
    const status = String(req.query.status || "all");
    const scoped = req.user.role === ROLE_ADMIN ? {} : { wardId: req.user.scope };
    const feedbacks = webDb
      .listFeedbacks({ status, ...scoped })
      .map((item) => ({
        ...publicFeedbackView(item),
        statusLabel: STATUS_LABELS[item.status] || item.status,
        canReview: canConfirm(req.user, item),
      }));
    res.json({
      ok: true,
      feedbacks,
      counts: webDb.countByStatus(),
      user: req.user,
    });
  });

  /** Một phản hồi cụ thể (cán bộ) */
  app.get("/api/feedbacks/:id", requireUser, (req, res) => {
    const feedback = webDb.getFeedback(req.params.id);
    if (!feedback) return res.status(404).json({ ok: false, error: "Không tìm thấy phản hồi." });
    if (req.user.role !== ROLE_ADMIN && feedback.wardId !== req.user.scope) {
      return res.status(403).json({ ok: false, error: "Bạn không có quyền xem phản hồi của phường/xã khác." });
    }
    res.json({ ok: true, feedback: { ...publicFeedbackView(feedback), statusLabel: STATUS_LABELS[feedback.status] } });
  });

  /**
   * Cán bộ xác nhận (duyệt) phản hồi.
   * Body tuỳ chọn: { note: "Ghi chú cho người dân" }
   */
  app.post("/api/feedbacks/:id/confirm", requireUser, (req, res) => {
    const feedback = webDb.getFeedback(req.params.id);
    if (!feedback) return res.status(404).json({ ok: false, error: "Không tìm thấy phản hồi." });
    if (!canConfirm(req.user, feedback)) {
      return res.status(403).json({ ok: false, error: "Bạn không có quyền xác nhận phản hồi của phường/xã khác." });
    }
    if (feedback.status === FEEDBACK_STATUS.APPROVED) {
      return res.status(409).json({ ok: false, code: "ALREADY_CONFIRMED", error: "Phản hồi này đã được xác nhận." });
    }

    const now = new Date().toISOString();
    const note = sanitizeText(req.body?.note ?? "", 300);
    const updated = webDb.setStatus(feedback.id, { status: FEEDBACK_STATUS.APPROVED, by: req.user.username, note, now });
    const publicFeedback = publicFeedbackView(updated);

    // Sự kiện tới người dân của đúng thiết bị đã gửi: giao diện chuyển "Đã xác nhận / Online".
    io.to(roomOfFeedback(feedback)).emit("feedback-confirmed", {
      feedbackId: updated.id,
      status: updated.status,
      statusLabel: STATUS_LABELS[updated.status] || updated.status,
      reviewNote: note,
      reviewedAt: now,
      reviewedBy: req.user.displayName,
      wardName: updated.wardName,
      feedback: publicFeedback,
    });
    // Cán bộ/Cấp Tỉnh cập nhật lại danh sách đang mở.
    io.to(`ward:${updated.wardId}`).to("role:admin").emit("feedback-reviewed", {
      feedbackId: updated.id,
      status: updated.status,
      counts: webDb.countByStatus(),
    });

    res.json({ ok: true, feedback: publicFeedback, message: "Đã xác nhận phản hồi và thông báo tới người dân." });
  });

  /** Cán bộ từ chối phản hồi (bắt buộc có lý do >= 5 ký tự). */
  app.post("/api/feedbacks/:id/reject", requireUser, (req, res) => {
    const feedback = webDb.getFeedback(req.params.id);
    if (!feedback) return res.status(404).json({ ok: false, error: "Không tìm thấy phản hồi." });
    if (!canConfirm(req.user, feedback)) {
      return res.status(403).json({ ok: false, error: "Bạn không có quyền từ chối phản hồi của phường/xã khác." });
    }
    const note = sanitizeText(req.body?.reason ?? req.body?.note ?? "", 300);
    if (note.length < 5) {
      return res.status(400).json({ ok: false, code: "VALIDATION", error: "Vui lòng ghi lý do từ chối (ít nhất 5 ký tự)." });
    }
    const updated = webDb.setStatus(feedback.id, { status: FEEDBACK_STATUS.REJECTED, by: req.user.username, note }).valueOf() || null;
    io.to(roomOfFeedback(feedback)).emit("feedback-rejected", {
      feedbackId: updated.id,
      status: updated.status,
      reason: note,
      reviewedAt: updated.reviewedAt,
    });
    io.to(`ward:${updated.wardId}`).to("role:admin").emit("feedback-reviewed", {
      feedbackId: updated.id,
      status: updated.status,
      counts: webDb.countByStatus(),
    });
    res.json({ ok: true, feedback: publicFeedbackView(updated) });
  });

  /** Thiết bị người dân tra cứu lại các phản hồi của mình (để đồng bộ trạng thái). */
  app.get("/api/my-feedbacks", (req, res) => {
    const raw =
      String(req.headers["x-device-token"] || "").trim() ||
      readCookie(req, DEVICE_COOKIE) ||
      String(req.query.deviceToken || "");
    if (!raw) return res.json({ ok: true, feedbacks: [] });
    const key = deviceKey(raw);
    const feedbacks = webDb.listFeedbacks({ deviceId: key, limit: 100 });
    res.json({ ok: true, feedbacks: feedbacks.map((item) => ({ ...publicFeedbackView(item), online: item.status === "approved" })) });
  });

  /* ------------------------- Điểm công khai trên bản đồ ------------------ */

  /** Điểm đã duyệt (không lộ số điện thoại/địa chỉ) để vẽ ghim cho mọi người. */
  app.get("/api/public-locations", (_req, res) => {
    const categories = store.categories();
    const categoryMap = Object.fromEntries(categories.map((item) => [item.id, item]));
    const locations = webDb
      .listFeedbacks({ status: FEEDBACK_STATUS.APPROVED, limit: 1000 })
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng))
      .map((item) => ({
        id: item.id,
        name: item.reason.length > 80 ? `${item.reason.slice(0, 77)}...` : item.reason,
        category: item.category,
        categoryLabel: categoryMap[item.category]?.label || item.category,
        icon: categoryMap[item.category]?.icon || "📍",
        color: categoryMap[item.category]?.color || "#0f766e",
        wardId: item.wardId,
        wardName: item.wardName,
        lat: item.lat,
        lng: item.lng,
        reviewedAt: item.reviewedAt,
        online: true,
      }));
    res.json({ ok: true, locations, categories });
  });

  /* ------------------------------- Socket.io ------------------------------ */
  const httpServer = createHttpServer(app);
  const io = new SocketServer(httpServer, {
    cors: corsOrigin ? { origin: String(corsOrigin) } : undefined,
    // Giới hạn payload để chống spam qua websocket.
    maxHttpBufferSize: 1e6,
  });

  io.use((socket, next) => {
    if (socketToken && socket.handshake.auth?.token !== socketToken) {
      return next(new Error("SOCKET_UNAUTHORIZED"));
    }
    return next();
  });

  /** Vai trò của socket chỉ do server quyết định từ token — không tin client tự khai. */
  function joinCitizen(socket, rawToken) {
    if (!rawToken) return false;
    const key = deviceKey(rawToken);
    socket.data.deviceKey = key;
    socket.join(`device:${key}`);
    return true;
  }

  function joinOfficer(socket, rawToken) {
    const session = resolveSession(rawToken);
    if (!session) {
      socket.emit("auth:error", { ok: false, error: "Phiên đăng nhập không hợp lệ." });
      return false;
    }
    socket.data.user = session.user;
    socket.data.officerToken = rawToken;
    if (session.user.role === ROLE_ADMIN) socket.join("role:admin");
    if (session.user.role === ROLE_WARD) socket.join("role:officer");
    if (session.user.scope) socket.join(`ward:${session.user.scope}`);
    socket.emit("officer:ready", { ok: true, user: session.user, counts: webDb.countByStatus() });
    return true;
  }

  io.on("connection", (socket) => {
    const { role, deviceToken: device, token: sessionToken } = socket.handshake.auth || {};
    if (role === "officer" && sessionToken) joinOfficer(socket, sessionToken);
    if (role === "citizen" && device) joinCitizen(socket, device);

    // Người dân đăng ký phòng riêng sau khi gửi phản hồi (nhận lại deviceToken).
    socket.on("citizen:subscribe", (payload = {}, ack) => {
      const raw = typeof payload === "string" ? payload : payload.deviceToken;
      const joined = joinCitizen(socket, raw);
      if (typeof ack === "function") ack({ ok: joined });
    });

    // Cán bộ xác thực lại bằng session token (dùng khi token đến sau handshake).
    socket.on("officer:subscribe", (payload = {}, ack) => {
      const raw = typeof payload === "string" ? payload : payload.token;
      const joined = joinOfficer(socket, raw);
      if (typeof ack === "function") ack({ ok: joined });
    });
  });

  /** Người dân nhận thông báo theo thiết bị đã gửi (deviceKey lưu ở cột device_id). */
  const roomOfFeedback = (feedback) => `device:${feedback.deviceId}`;

  /* ------------------------------- Tĩnh ---------------------------------- */

  app.use(express.static(publicDir, { index: "index.html", maxAge: "5m" }));

  // API không khớp -> JSON 404 (không trả HTML gây lỗi parse ở client).
  app.use("/api", (_req, res) => res.status(404).json({ ok: false, error: "API không tồn tại." }));

  // Mọi đường dẫn khác -> trang chủ (SPA đơn trang).
  app.use((_req, res) => {
    const indexFile = join(publicDir, "index.html");
    if (existsSync(indexFile)) return res.sendFile(indexFile);
    return res.status(404).send("Chưa có thư mục public/index.html");
  });

  // Xử lý lỗi tập trung: không bao giờ trả stack trace cho trình duyệt.
  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    console.error("[web] Lỗi xử lý request:", error?.message || error);
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ ok: false, error: "Dữ liệu JSON không hợp lệ." });
    }
    return res.status(500).json({ ok: false, error: "Máy chủ gặp lỗi, vui lòng thử lại." });
  });

  /**
   * Phản hồi gửi cho trình duyệt: bỏ dữ liệu nhạy cảm (số điện thoại, email,
   * địa chỉ chi tiết, định danh thiết bị). Cán bộ cần đủ dữ liệu thì xem qua
   * /api/feedbacks (kèm xác thực) — nơi đó vẫn là dữ liệu nghiệp vụ.
   */
  function publicFeedbackView(feedback) {
    if (!feedback) return null;
    const { deviceId: _device, phone: _phone, email: _email, address: _address, ...rest } = feedback;
    return {
      ...rest,
      fullName: maskName(feedback.fullName),
      phoneMasked: maskPhone(feedback.phone),
      statusLabel: STATUS_LABELS[feedback.status] || feedback.status,
      online: feedback.status === FEEDBACK_STATUS.APPROVED,
    };
  }

  return {
    app,
    io,
    httpServer,
    publicFeedbackView,
    store,
    webDb,
    service,
    sessions,
    dbPath,
    publicDir,
    socketToken,
    /** Đóng server + DB (dùng trong test). */
    async close() {
      await new Promise((done) => io.close(() => done()));
      webDb.close();
    },
  };
}

/* ============================== Server start =============================== */

/**
 * Khởi động server.
 * @param {{ port?: number, host?: string } & Parameters<typeof createWebApp>[0]} [options]
 */
export async function startWebServer(options = {}) {
  const webApp = createWebApp(options);
  const port = Number(options.port ?? process.env.PORT ?? DEFAULT_PORT);
  const host = options.host || process.env.HOST || "0.0.0.0";
  const { httpServer } = webApp;

  await new Promise((done, fail) => {
    httpServer.once("error", fail);
    httpServer.listen(port, host, done);
  });

  return {
    ...webApp,
    port,
    host,
    url: `http://localhost:${port}`,
    async close() {
      await webApp.close();
      await new Promise((done) => {
        httpServer.close(() => done());
        httpServer.closeAllConnections?.();
      });
    },
  };
}

/* ------------------------------ Tiện ích nhỏ ------------------------------ */

function readCookie(req, name) {
  const header = String(req.headers.cookie || "");
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

/** Ẩn bớt họ tên: "Nguyễn Văn An" -> "Nguyễn Văn A." (sự kiện realtime cho cán bộ khác). */
export function maskName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] || "";
  return `${parts.slice(0, -1).join(" ")} ${parts.at(-1)[0]}.`;
}

/** Ẩn bớt số điện thoại: 0905123456 -> 0905***456 */
export function maskPhone(phone) {
  const value = String(phone || "");
  if (value.length < 7) return value ? "***" : "";
  return `${value.slice(0, 4)}***${value.slice(-3)}`;
}

/* ------------------------------ CLI entry -------------------------------- */

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
// `node --test` cũng đặt process.argv[1]; tránh tự mở cổng khi chạy unit test.
if (isMain && !process.env.NODE_TEST_CONTEXT) {
  startWebServer()
    .then((server) => {
      console.log(`\n🏠 Bản đồ Yêu thương Khánh Hòa — web`);
      console.log(`   Người dân : ${server.url}/`);
      console.log(`   Cán bộ    : ${server.url}/officer.html`);
      console.log(`   SQLite    : ${server.dbPath}`);
      console.log(`   Admin     : admin / ${process.env.KHANHHOA_ADMIN_PASSWORD || "Admin@2025"}\n`);

      const shutdown = async () => {
        console.log("\n[web] Đang tắt server...");
        await server.close();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((error) => {
      if (error?.code === "EADDRINUSE") {
        console.error(`[web] Cổng ${process.env.PORT || DEFAULT_PORT} đang bị chiếm. Đổi bằng: PORT=8080 npm run start:web`);
      } else {
        console.error("[web] Không khởi động được server:", error);
      }
      process.exit(1);
    });
}

/* Re-export cho những phần khác cần dùng (dashboard, test). */
export { FEEDBACK_STATUS, ROLE_ADMIN, ROLE_WARD, rowToFeedback, rowToUser };
