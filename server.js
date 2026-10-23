/** Bản đồ Yêu thương Khánh Hòa — máy chủ web Express + SQLite + Socket.io. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server as SocketServer } from "socket.io";
import { SqliteDataStore } from "./src/sqlite-store.js";
import { AppService } from "./src/app-service.js";
import { createIpcRouter, CHANNELS } from "./src/ipc-router.js";
import { attachPendingImages, safeJoin } from "./src/image-store.js";
import { DEVICE_COOKIE, createDeviceToken, hashDeviceToken, normalizeIp } from "./src/devices.js";
import { findWardInUnits, STATUS_LABELS } from "./src/data-model.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const IMAGE_ROOT = resolve(process.env.KHANHHOA_IMAGES || join(ROOT, "data", "images"));
const DOC_ROOTS = [resolve(process.env.KHANHHOA_DOCS || join(ROOT, "data", "docs")), resolve(join(ROOT, "public", "docs"))];
const DOC_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function defaultDesktopDbPath() {
  if (process.env.KHANHHOA_DESKTOP_DB) return resolve(process.env.KHANHHOA_DESKTOP_DB);
  const appData = process.env.APPDATA;
  return appData ? join(appData, "BanDoYeuThuongKhanhHoa", "db.json") : "";
}

function readCookie(header = "", name) {
  for (const part of String(header).split(";")) {
    const at = part.indexOf("=");
    if (at < 0 || part.slice(0, at).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(at + 1).trim()); } catch { return ""; }
  }
  return "";
}

function bearer(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ""));
  return match?.[1]?.trim() || "";
}

function maskedPhone(phone) {
  const value = String(phone || "");
  return value.length >= 7 ? `${value.slice(0, 4)}***${value.slice(-3)}` : "***";
}

function safeDocumentList() {
  const files = [];
  for (const root of DOC_ROOTS) {
    if (!existsSync(root)) continue;
    const walk = (folder, depth = 0) => {
      if (depth > 4) return;
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path, depth + 1);
        else if (entry.isFile() && DOC_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          const relative = path.slice(root.length + 1).split(sep).join("/");
          files.push({ name: entry.name, type: extname(entry.name).slice(1).toLowerCase(), size: statSync(path).size, url: `/docs/${encodeURIComponent(relative).replaceAll("%2F", "/")}` });
        }
      }
    };
    walk(root);
  }
  return files;
}

function safeStaticUrl(value) {
  const name = String(value || "").split(/[\\/]/).pop();
  return /^[\w-]+\.(png|jpe?g|webp)$/i.test(name) ? name : "";
}

export function createWebApp(options = {}) {
  const dbPath = resolve(options.dbPath || process.env.KHANHHOA_WEB_DB || join(ROOT, "data", "khanhhoa-web.db"));
  const publicDir = resolve(options.publicDir || join(ROOT, "public"));
  const desktopJson = options.importJson === false ? "" : (options.importJsonPath || defaultDesktopDbPath());
  const store = new SqliteDataStore(dbPath, {
    seedAdminPassword: options.adminPassword || process.env.KHANHHOA_ADMIN_PASSWORD || "Admin@2025",
    seedFeedback: options.seedDemo !== false,
    importJsonPath: desktopJson,
  });
  mkdirSync(IMAGE_ROOT, { recursive: true });
  for (const dir of DOC_ROOTS) mkdirSync(dir, { recursive: true });

  const service = new AppService(store, {
    onFeedbackCreated: ({ id, imagesPendingId }) => attachPendingImages({ imagesRoot: IMAGE_ROOT, pendingId: imagesPendingId, feedbackId: id, names: store.feedbacks().find((f) => f.id === id)?.images || [] }),
  });
  const router = createIpcRouter({ service, images: {}, pickImages: async () => ({ ok: false, errors: ["Chọn ảnh qua trình duyệt."] }), appInfo: () => ({ version: "2.0.0", platform: "web" }) });
  const sessions = service.sessions;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY === "true");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    next();
  });
  if (process.env.KHANHHOA_CORS_ORIGIN) {
    const allowed = process.env.KHANHHOA_CORS_ORIGIN.split(",").map((x) => x.trim());
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && allowed.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Token");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") return res.sendStatus(204);
      next();
    });
  }
  app.use(express.json({ limit: "1mb" }));

  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: process.env.KHANHHOA_CORS_ORIGIN ? { origin: process.env.KHANHHOA_CORS_ORIGIN.split(",").map((x) => x.trim()) } : undefined,
    maxHttpBufferSize: 1024 * 1024,
  });

  const resolveUser = (token) => service.resolveSession(token)?.publicUser || null;
  const sessionFor = (req) => bearer(req) || String(req.body?.sessionId || req.query.sessionId || "");
  const requireUser = (req, res, next) => {
    const sessionId = sessionFor(req);
    const result = service.requireSession(sessionId);
    if (!result.ok) return res.status(401).json({ ...result, error: result.errors?.[0] });
    req.sessionId = sessionId;
    req.user = result.publicUser;
    next();
  };
  const requireAdmin = (req, res, next) => {
    if (req.user?.role !== "admin") return res.status(403).json({ ok: false, code: "FORBIDDEN", error: "Chỉ Cấp Tỉnh được thực hiện thao tác này." });
    next();
  };

  function deviceTokenFrom(req) {
    return String(req.headers["x-device-token"] || "").trim() || readCookie(req.headers.cookie, DEVICE_COOKIE) || "";
  }
  const knownDeviceTokens = new Map();
  function deviceRoomForFeedback(feedback) {
    const device = store.devices().find((item) => item.id === feedback?.deviceId);
    if (!device?.tokenHash) return "";
    const rawToken = knownDeviceTokens.get(device.tokenHash);
    return rawToken ? `device:${hashDeviceToken(rawToken)}` : `device:${device.tokenHash}`;
  }
  function officerFeedbackView(feedback) {
    if (!feedback) return null;
    return { ...feedback, phoneMasked: maskedPhone(feedback.phone), phone: maskedPhone(feedback.phone), email: "", clientIp: undefined, ip: undefined, deviceInfo: undefined };
  }
  function publicFeedback(feedback) {
    if (!feedback) return null;
    const { deviceId, clientIp, ip, deviceInfo, ...safe } = feedback;
    return { ...safe, phoneMasked: maskedPhone(feedback.phone), statusLabel: STATUS_LABELS[feedback.status] || feedback.status };
  }
  function emitAfterRpc(channel, payload, result) {
    if (!result?.ok) return;
    if (channel === "feedback:submit") {
      const feedback = store.feedbacks().find((item) => item.id === result.feedbackId);
      if (!feedback) return;
      const eventData = { feedback: officerFeedbackView(feedback), wardName: findWardInUnits(store.regions(), feedback.wardId)?.name || "", emergency: feedback.category === "khan_cap", unreadPending: store.feedbacks().filter((x) => x.status === "pending" && x.wardId === feedback.wardId).length };
      io.to(`ward:${feedback.wardId}`).to("role:admin").emit("new-feedback", eventData);
      io.to(`ward:${feedback.wardId}`).to("role:admin").emit("notifications:changed", { wardId: feedback.wardId });
    }
    if (channel === "feedback:review") {
      const feedback = store.feedbacks().find((item) => item.id === payload.feedbackId);
      if (!feedback) return;
      const data = { feedbackId: feedback.id, status: feedback.status, statusLabel: STATUS_LABELS[feedback.status], reviewNote: feedback.reviewNote || "", reviewedAt: feedback.reviewedAt, wardName: findWardInUnits(store.regions(), feedback.wardId)?.name || "" };
      const room = deviceRoomForFeedback(feedback);
      if (room) io.to(room).emit(feedback.status === "approved" ? "feedback-confirmed" : "feedback-rejected", data);
      io.to(`ward:${feedback.wardId}`).to("role:admin").emit("feedback-reviewed", data);
      if (feedback.status === "approved") io.emit("map:changed", { id: feedback.id });
    }
    if (channel.startsWith("notifications:") || channel.startsWith("accounts:") || channel.startsWith("regions:") || channel.startsWith("categories:")) {
      io.emit("data:changed", { channel });
    }
  }

  io.use((socket, next) => {
    const auth = socket.handshake.auth || {};
    if (auth.role === "officer") {
      const user = resolveUser(auth.sessionId || auth.token);
      if (!user) return next(new Error("UNAUTHENTICATED"));
      socket.data.user = user;
      socket.data.sessionId = auth.sessionId || auth.token;
    } else {
      socket.data.deviceToken = auth.deviceToken || readCookie(socket.handshake.headers.cookie, DEVICE_COOKIE);
    }
    next();
  });
  io.on("connection", (socket) => {
    const joinCitizen = (rawToken) => {
      if (!rawToken) return false;
      knownDeviceTokens.set(hashDeviceToken(rawToken), rawToken);
      const room = `device:${hashDeviceToken(rawToken)}`;
      socket.data.deviceRoom = room;
      socket.join(room);
      return true;
    };
    const joinOfficer = (sessionId) => {
      const user = resolveUser(sessionId);
      if (!user) return false;
      socket.data.user = user;
      socket.data.sessionId = sessionId;
      if (user.role === "admin") socket.join("role:admin");
      if (user.scope) socket.join(`ward:${user.scope}`);
      socket.emit("officer:ready", { ok: true, user, counts: { pending: store.feedbacks().filter((f) => f.status === "pending" && (user.role === "admin" || f.wardId === user.scope)).length } });
      return true;
    };
    const auth = socket.handshake.auth || {};
    if (auth.role === "officer") joinOfficer(auth.sessionId || auth.token);
    else joinCitizen(socket.data.deviceToken);
    socket.on("citizen:subscribe", (value, ack) => {
      const token = typeof value === "string" ? value : value?.deviceToken;
      const ok = joinCitizen(token);
      if (typeof ack === "function") ack({ ok });
    });
    socket.on("officer:subscribe", (value, ack) => {
      const token = typeof value === "string" ? value : value?.sessionId || value?.token;
      const ok = joinOfficer(token);
      if (typeof ack === "function") ack({ ok });
    });
  });

  /* Health + app metadata */
  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "khanhhoa-web", version: "2.0.0", time: new Date().toISOString() }));
  app.get("/api/officers", (_req, res) => {
    const officers = store.publicUsers().filter((user) => user.role === "ward" && user.active !== false).map((user) => ({ id: user.id, displayName: user.displayName, scope: user.scope, scopeName: user.scopeName }));
    res.json({ ok: true, officers });
  });
  app.get("/api/categories", (_req, res) => res.json({ ok: true, categories: store.categories() }));
  app.get("/api/stats", requireUser, (req, res) => res.json(service.dashboard({ sessionId: req.sessionId })));
  app.get("/api/channels", (_req, res) => res.json({ ok: true, channels: CHANNELS.filter((x) => !["dialog:pickImages", "image:save"].includes(x)) }));

  /* REST auth; cùng AppService/session với RPC cũ. */
  const loginAttempts = new Map();
  app.post("/api/auth/login", (req, res) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const previous = loginAttempts.get(key) || { start: now, count: 0 };
    if (now - previous.start > 60_000) { previous.start = now; previous.count = 0; }
    previous.count += 1;
    loginAttempts.set(key, previous);
    if (previous.count > 10) return res.status(429).json({ ok: false, code: "RATE_LIMIT", error: "Thử đăng nhập quá nhiều lần. Vui lòng chờ một phút." });
    const result = service.login(req.body || {});
    if (!result.ok) return res.status(401).json({ ...result, error: result.errors?.[0] });
    res.json({ ...result, token: result.sessionId });
  });
  app.post("/api/auth/logout", requireUser, (req, res) => res.json(service.logout({ sessionId: req.sessionId })));
  app.get("/api/auth/me", requireUser, (_req, res) => res.json({ ok: true, user: _req.user }));
  app.post("/api/auth/change-password", requireUser, (req, res) => res.json(service.changePassword({ ...req.body, sessionId: req.sessionId })));

  /* Public data directories: exact store administrative hierarchy. */
  app.get("/api/regions", (_req, res) => res.json({ ok: true, regions: store.regions(), categories: store.categories() }));
  app.get("/api/wards", (_req, res) => res.json({ ok: true, wards: service.wards() }));
  app.get("/api/wards/:id", (req, res) => {
    const ward = findWardInUnits(store.regions(), req.params.id);
    if (!ward) return res.status(404).json({ ok: false, error: "Không tìm thấy phường/xã." });
    const officer = store.publicUsers().find((user) => user.role === "ward" && user.scope === req.params.id && user.active !== false);
    const feedbacks = store.feedbacks().filter((feedback) => feedback.wardId === req.params.id);
    res.json({ ok: true, ward, officer: officer ? { displayName: officer.displayName, scope: officer.scope } : null, counts: { all: feedbacks.length, pending: feedbacks.filter((x) => x.status === "pending").length, approved: feedbacks.filter((x) => x.status === "approved").length } });
  });
  app.get("/api/documents", (_req, res) => res.json({ ok: true, documents: safeDocumentList() }));
  app.get("/api/public-locations", (_req, res) => res.json({ ok: true, locations: service.publicLocations(), categories: store.categories() }));

  /* Citizen endpoints: APIs run through the same validation/services as Electron. */
  const feedbackAttempts = new Map();
  app.post("/api/feedbacks", async (req, res) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const previous = feedbackAttempts.get(key) || { start: now, count: 0 };
    if (now - previous.start > 60_000) { previous.start = now; previous.count = 0; }
    previous.count += 1;
    feedbackAttempts.set(key, previous);
    if (previous.count > 20) return res.status(429).json({ ok: false, code: "RATE_LIMIT", error: "Gửi phản hồi quá nhanh. Vui lòng thử lại sau." });
    const token = deviceTokenFrom(req) || createDeviceToken();
    knownDeviceTokens.set(hashDeviceToken(token), token);
    const payload = {
      ...req.body,
      deviceToken: token,
      ip: normalizeIp(req.ip),
      clientIp: normalizeIp(req.ip),
      submittedFrom: "web",
      deviceInfo: { userAgent: String(req.headers["user-agent"] || "").slice(0, 300) },
    };
    const result = await router.handle({ channel: "feedback:submit", payload });
    if (!result.ok) return res.status(400).json({ ...result, error: result.errors?.[0] });
    if (!req.headers["x-device-token"] && !readCookie(req.headers.cookie, DEVICE_COOKIE)) {
      res.cookie(DEVICE_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 365 * 86400000, path: "/" });
    }
    emitAfterRpc("feedback:submit", payload, result);
    res.status(201).json({ ...result, feedback: publicFeedback(store.feedbacks().find((f) => f.id === result.feedbackId)) });
  });

  app.get("/api/my-feedbacks", (req, res) => {
    const token = deviceTokenFrom(req);
    res.json(service.myFeedbacks({ deviceToken: token }));
  });

  app.get("/api/feedbacks", requireUser, (req, res) => {
    const result = service.listFeedbacks({ sessionId: req.sessionId, status: req.query.status || "all" });
    if (result.ok) result.feedbacks = result.feedbacks.map((item) => ({ ...item, phoneMasked: maskedPhone(item.phone) }));
    res.json(result);
  });
  app.get("/api/feedbacks/:id", requireUser, (req, res) => {
    const result = service.listFeedbacks({ sessionId: req.sessionId, status: "all" });
    const feedback = result.feedbacks?.find((item) => item.id === req.params.id);
    if (!feedback) return res.status(404).json({ ok: false, error: "Không tìm thấy phản hồi hoặc không có quyền xem." });
    res.json({ ok: true, feedback });
  });
  app.post("/api/feedbacks/:id/confirm", requireUser, (req, res) => {
    const current = store.feedbacks().find((item) => item.id === req.params.id);
    if (current?.status === "approved") return res.status(409).json({ ok: false, code: "ALREADY_CONFIRMED", error: "Phản hồi này đã được xác nhận." });
    reviewFeedback(req, res, "approved");
  });
  app.post("/api/feedbacks/:id/reject", requireUser, (req, res) => reviewFeedback(req, res, "rejected"));
  function reviewFeedback(req, res, status) {
    const payload = { sessionId: req.sessionId, feedbackId: req.params.id, status, note: req.body?.note || req.body?.reason || "" };
    const result = service.reviewFeedback(payload);
    if (!result.ok) {
      const code = result.code || "VALIDATION";
      const statusCode = code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : 400;
      return res.status(statusCode).json({ ...result, error: result.errors?.[0] });
    }
    emitAfterRpc("feedback:review", payload, result);
    res.json(result);
  }
  /* Generic RPC bridge handles all existing app.js channels; never expose file paths. */
  app.post("/api/rpc/:channel", async (req, res) => {
    const channel = req.params.channel;
    if (!CHANNELS.includes(channel)) return res.status(404).json({ ok: false, code: "UNKNOWN_CHANNEL", errors: [`Kênh không hỗ trợ: ${channel}`] });
    if (["dialog:pickImages", "image:save"].includes(channel)) return res.status(400).json({ ok: false, code: "WEB_UPLOAD_REQUIRED", errors: ["Dùng chức năng tải ảnh web."] });
    if (channel === "feedback:review" && req.body?.status === "approved") {
      const feedback = store.feedbacks().find((item) => item.id === req.body?.feedbackId);
      if (feedback?.status === "approved") return res.status(409).json({ ok: false, code: "ALREADY_CONFIRMED", errors: ["Phản hồi này đã được xác nhận."] });
    }
    const payload = { ...(req.body || {}) };
    const token = sessionFor(req);
    if (token) payload.sessionId = token;
    if (channel === "feedback:submit") {
      payload.deviceToken = deviceTokenFrom(req) || createDeviceToken();
      knownDeviceTokens.set(hashDeviceToken(payload.deviceToken), payload.deviceToken);
      payload.ip = normalizeIp(req.ip);
      payload.clientIp = normalizeIp(req.ip);
      payload.submittedFrom = "web";
      payload.deviceInfo = { userAgent: String(req.headers["user-agent"] || "").slice(0, 300) };
    }
    if (channel === "image:url") {
      const name = safeStaticUrl(payload.name);
      return res.json(name ? { ok: true, url: `/images/${encodeURIComponent(payload.feedbackId)}/${encodeURIComponent(name)}` } : { ok: false, errors: ["Tên ảnh không hợp lệ."] });
    }
    if (channel === "feedback:review") {
      const feedback = store.feedbacks().find((item) => item.id === payload.feedbackId);
      if (feedback?.status === "approved" && payload.status === "approved") return res.status(409).json({ ok: false, code: "ALREADY_CONFIRMED", errors: ["Phản hồi này đã được xác nhận."] });
    }
    try {
      const result = await router.handle({ channel, payload });
      emitAfterRpc(channel, payload, result);
      if (channel === "feedback:submit" && result.ok) {
        const rawToken = payload.deviceToken;
        if (!req.headers["x-device-token"] && !readCookie(req.headers.cookie, DEVICE_COOKIE)) {
          res.cookie(DEVICE_COOKIE, rawToken, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 365 * 86400000, path: "/" });
        }
        return res.json({ ...result, deviceToken: req.headers["x-device-token"] ? rawToken : undefined });
      }
      return res.json(result);
    } catch (error) {
      console.error(`[rpc:${channel}]`, error);
      return res.status(500).json({ ok: false, code: "INTERNAL", errors: ["Máy chủ gặp lỗi."] });
    }
  });

  /* Upload image bytes; generated names and pendingId are controlled by server. */
  app.post("/api/images", (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const previous = feedbackAttempts.get(`upload:${key}`) || { start: Date.now(), count: 0 };
    if (Date.now() - previous.start > 60_000) { previous.start = Date.now(); previous.count = 0; }
    previous.count += 1; feedbackAttempts.set(`upload:${key}`, previous);
    if (previous.count > 30) return res.status(429).json({ ok: false, error: "Tải ảnh quá nhanh. Vui lòng chờ một phút." });
    next();
  }, express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "5mb" }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ ok: false, error: "Thiếu nội dung ảnh." });
    const ext = ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" })[req.headers["content-type"]?.split(";")[0]];
    if (!ext || !IMAGE_EXTENSIONS.has(ext)) return res.status(415).json({ ok: false, error: "Chỉ nhận PNG, JPEG, WebP." });
    const pendingId = String(req.query.pendingId || `pending-${randomUUID()}`);
    if (!/^pending-[0-9a-f-]{36}$/i.test(pendingId)) return res.status(400).json({ ok: false, error: "pendingId không hợp lệ." });
    const header = req.body.subarray(0, 12);
    const validMagic = ext === ".png" ? header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : ext === ".jpg" ? header[0] === 0xff && header[1] === 0xd8 : header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP";
    if (!validMagic) return res.status(400).json({ ok: false, error: "Nội dung ảnh không khớp định dạng." });
    const name = `img-${randomUUID()}${ext}`;
    const directory = safeJoin(IMAGE_ROOT, pendingId);
    if (!directory) return res.status(400).json({ ok: false, error: "Thư mục ảnh không hợp lệ." });
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, name), req.body, { flag: "wx" });
    res.status(201).json({ ok: true, pendingId, saved: { name, size: req.body.length }, name });
  });
  app.get("/images/:feedbackId/:name", (req, res) => {
    if (!/^[\w-]{1,100}$/.test(req.params.feedbackId) || !safeStaticUrl(req.params.name)) return res.sendStatus(404);
    const file = safeJoin(IMAGE_ROOT, join(req.params.feedbackId, basename(req.params.name)));
    if (!file || !existsSync(file)) return res.sendStatus(404);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(file);
  });

  /* Documents served only from configured document roots. */
  app.get("/docs/*path", (req, res) => {
    const relative = Array.isArray(req.params.path) ? req.params.path.join("/") : String(req.params.path || "");
    if (relative.split(/[\\/]/).some((part) => part === "..")) return res.sendStatus(400);
    for (const root of DOC_ROOTS) {
      const file = safeJoin(root, relative);
      if (file && existsSync(file) && DOC_EXTENSIONS.has(extname(file).toLowerCase())) return res.sendFile(file);
    }
    res.sendStatus(404);
  });

  /* Serve the current root UI dynamically with the web bridge injected. */
  const indexFile = join(ROOT, "index.html");
  app.get(["/", "/index.html"], (_req, res) => {
    if (!existsSync(indexFile)) return res.status(404).send("index.html missing");
    let html = readFileSync(indexFile, "utf8");
    const scripts = '<script src="/socket.io/socket.io.js"></script>\n  <script src="/js/khanhHoa-web.js"></script>\n  <script src="app.js"></script>';
    html = html.replace(/<script\s+src=["']app\.js["']\s*>\s*<\/script>/i, scripts);
    if (!html.includes('id="imageFileInput"')) {
      html = html.replace("</body>", '  <input id="imageFileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>\n</body>');
    }
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(html);
  });
  app.get("/app.js", (_req, res) => res.sendFile(join(ROOT, "app.js")));
  app.use(express.static(publicDir, { maxAge: "5m", fallthrough: true }));
  // Also serve other safe static assets in the repo, excluding private data/node_modules.
  app.use("/assets", express.static(join(ROOT, "build"), { fallthrough: true }));
  app.use("/api", (_req, res) => res.status(404).json({ ok: false, error: "API không tồn tại." }));
  app.use((_req, res) => res.status(404).send("Không tìm thấy trang."));
  app.use((error, _req, res, _next) => {
    console.error("[web]", error?.message || error);
    const status = error?.status === 413 ? 413 : error?.type === "entity.parse.failed" ? 400 : 500;
    res.status(status).json({ ok: false, error: status === 413 ? "Ảnh vượt giới hạn 5MB." : "Máy chủ gặp lỗi." });
  });

  return {
    app, io, httpServer, store, service, router, dbPath,
    async close() {
      await new Promise((resolveClose) => io.close(() => resolveClose()));
      store.close();
    },
  };
}

export async function startWebServer(options = {}) {
  const web = createWebApp(options);
  const port = Number(options.port ?? process.env.PORT ?? DEFAULT_PORT);
  const host = options.host || process.env.HOST || "0.0.0.0";
  await new Promise((ok, fail) => {
    web.httpServer.once("error", fail);
    web.httpServer.listen(port, host, ok);
  });
  return { ...web, port: web.httpServer.address().port, host, url: `http://localhost:${web.httpServer.address().port}` };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && !process.env.NODE_TEST_CONTEXT) {
  startWebServer().then((server) => {
    console.log(`Bản đồ Yêu thương Khánh Hòa web: ${server.url}`);
    console.log(`SQLite: ${server.dbPath}`);
    if (server.store.importedFrom) console.log(`Đã nhập dữ liệu từ: ${server.store.importedFrom}`);
    console.log(`Tài liệu: ${server.url}/api/documents`);
    const stop = async () => { await server.close(); process.exit(0); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }).catch((error) => { console.error("Không khởi động được web server:", error); process.exit(1); });
}
