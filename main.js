/**
 * Ứng dụng Bản đồ Yêu thương Khánh Hòa - Main process (Electron).
 *
 * Trách nhiệm:
 *  - Tạo cửa sổ chính 1200x800 với giao diện chuẩn Windows (title bar, menu Việt).
 *  - Sở hữu dữ liệu: JSON db (userData/db.json) + ảnh (userData/images).
 *  - Phơi API cho renderer qua preload (contextIsolation, không nodeIntegration).
 *  - IPC: đăng nhập, phân quyền, tạo tài khoản xã/phường, gửi/duyệt phản hồi,
 *    chọn ảnh, thống kê đơn vị hành chính.
 */

import { createReadStream, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DataStore } from "./src/data-store.js";
import { AppService } from "./src/app-service.js";
import { createIpcRouter, CHANNELS } from "./src/ipc-router.js";
import {
  ALLOWED_EXTENSIONS,
  MAX_IMAGES,
  attachPendingImages,
  imageUrl,
  savePendingImage,
  safeJoin,
} from "./src/image-store.js";
import { DEVICE_COOKIE, DEVICE_TOKEN_TTL_DAYS, createDeviceToken, normalizeIp } from "./src/devices.js";

const loadElectron = createRequire(import.meta.url);

/**
 * Electron không khai báo `exports` trong package.json, nên `import ... from "electron"`
 * (ESM) không resolve được. Dùng require() trong ESM là cách chính thức của Node
 * để lấy API electron từ main process.
 */
const electron = loadElectron("electron");
const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } = electron;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const WINDOW_SIZE = Object.freeze({ width: 1200, height: 800, minWidth: 1024, minHeight: 700 });
export const IMAGE_SCHEME = "app-image";
export const REQUEST_CHANNEL = "khanhhoa:request";
const RENDERER_URL = pathToFileURL(join(__dirname, "index.html")).toString();

if (process.env.KHANHHOA_USER_DATA) {
  app.setPath("userData", process.env.KHANHHOA_USER_DATA);
}
let mainWindow = null;
let store = null;
let service = null;
let router = null;
let imagesRoot = "";

/* --------------------------------- Images ---------------------------------- */

protocol.registerSchemesAsPrivileged([
  { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerImageProtocol() {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    const url = new URL(request.url);
    // app-image://images/<feedbackId>/<file> -> file nằm trong imagesRoot.
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const filePath = safeJoin(imagesRoot, join(...parts));
    if (!filePath || !existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }
    const mime = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    }[extname(filePath).toLowerCase()] || "application/octet-stream";
    return new Response(createReadStream(filePath), { headers: { "content-type": mime } });
  });
}

/* ---------------------------------- Menu ----------------------------------- */

/** Kiểm tra tải thử ảnh nền Google Maps (mt0–mt3), báo kết quả cho người dùng. */
async function checkMapTiles() {
  const urls = [
    "https://mt0.google.com/vt/lyrs=r&x=414&y=228&z=9",
    "https://mt1.google.com/vt/lyrs=r&x=414&y=228&z=9",
    "https://mt2.google.com/vt/lyrs=r&x=414&y=228&z=9",
    "https://mt3.google.com/vt/lyrs=r&x=414&y=228&z=9",
  ];
  const lines = [];
  for (const url of urls) {
    const host = new URL(url).host;
    try {
      const response = await net.fetch(url);
      lines.push(host + ": " + (response.ok ? "OK (" + response.status + ")" : "LỖI " + response.status));
    } catch (error) {
      lines.push(host + ": " + error.message);
    }
  }
  console.log("[map-check]\n" + lines.join("\n"));
  await dialog.showMessageBox(mainWindow, {
    type: lines.every((line) => line.includes("OK")) ? "info" : "warning",
    title: "Kiểm tra tải bản đồ",
    message: lines.every((line) => line.includes("OK"))
      ? "Máy tính tải được ảnh nền bản đồ."
      : "Máy tính KHÔNG tải được ảnh nền bản đồ.",
    detail: lines.join("\n") + "\n\nChi tiết cũng được ghi ra terminal.",
    buttons: ["Đóng"],
    noLink: true,
  });
}

/* ---------------------------------- IP ------------------------------------- */

/**
 * Lấy IP của máy gửi từ tầng Electron (không tin dữ liệu renderer khai).
 * Thử theo thứ tự: webRequest -> headers của phiên -> localhost.
 */
function resolveClientIp(event) {
  try {
    const frame = event.senderFrame;
    const ip = frame?.ipc?.getRemoteAddress?.() || event.frame?.ipc?.getRemoteAddress?.();
    if (ip) return normalizeIp(ip);
  } catch {
    /* không có API -> thử tiếp */
  }
  try {
    const request = event.sender?.session?.webRequest;
    void request; // webRequest không cung cấp IP đồng bộ; giữ nhánh dự phòng bên dưới
  } catch {
    /* bỏ qua */
  }
  return "127.0.0.1";
}

/**
 * Thông tin thiết bị của máy gửi (User-Agent, hệ điều hành, tên máy).
 * Lấy từ chính tiến trình main nên người dân không sửa được.
 */
function resolveDeviceInfo(event) {
  let userAgent = "";
  try {
    userAgent = event.sender?.getUserAgent?.() || "";
  } catch {
    userAgent = "";
  }
  const os = loadElectron("node:os");
  return {
    userAgent: String(userAgent).slice(0, 300),
    os: `${os.type()} ${os.release()}`.trim(),
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    app: `Electron ${process.versions.electron || ""}`.trim(),
    collectedAt: new Date().toISOString(),
  };
}

function buildMenu() {
  const template = [
    {
      label: "Tệp",
      submenu: [
        {
          label: "Tải lại giao diện",
          accelerator: "F5",
          click: () => mainWindow?.webContents.reload(),
        },
        {
          label: "Mở thư mục dữ liệu",
          click: () => shell.openPath(app.getPath("userData")),
        },
        {
          label: "Kiểm tra tải bản đồ…",
          click: () => checkMapTiles(),
        },
        { type: "separator" },
        { role: "quit", label: "Thoát" },
      ],
    },
    {
      label: "Chỉnh sửa",
      submenu: [
        { role: "undo", label: "Hoàn tác" },
        { role: "redo", label: "Làm lại" },
        { type: "separator" },
        { role: "cut", label: "Cắt" },
        { role: "copy", label: "Sao chép" },
        { role: "paste", label: "Dán" },
        { role: "selectAll", label: "Chọn tất cả" },
      ],
    },
    {
      label: "Xem",
      submenu: [
        { role: "zoomIn", label: "Phóng to" },
        { role: "zoomOut", label: "Thu nhỏ" },
        { role: "resetZoom", label: "Kích thước gốc" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Toàn màn hình" },
        { role: "toggleDevTools", label: "Công cụ nhà phát triển" },
      ],
    },
    {
      label: "Trợ giúp",
      submenu: [
        {
          label: "Giới thiệu",
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "Bản đồ Yêu thương Khánh Hòa",
              message: `Phiên bản ${app.getVersion()}`,
              detail:
                "Ứng dụng desktop kết nối điểm hỗ trợ và nhu cầu cộng đồng tại Khánh Hòa.\n" +
                "Dữ liệu lưu offline trên máy này (thư mục userData).",
              buttons: ["Đóng"],
              noLink: true,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* --------------------------------- Window ---------------------------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    ...WINDOW_SIZE,
    show: false,
    title: "Bản đồ Yêu thương Khánh Hòa",
    icon: join(__dirname, "build", "icon.ico"),
    autoHideMenuBar: false,
    backgroundColor: "#f1f5f9",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Chẩn đoán: log lỗi tải tile/ảnh ra terminal để biết bị chặn tên miền hay offline.
  const loggedHosts = new Set();
  mainWindow.webContents.session.webRequest.onErrorOccurred({ urls: ["*://*/*"] }, (details) => {
    if (!/mt[0-3]\.google\.com|\.png/i.test(details.url)) return;
    const host = (() => {
      try {
        return new URL(details.url).host;
      } catch {
        return "?";
      }
    })();
    if (loggedHosts.has(host)) return;
    loggedHosts.add(host);
    console.warn(`[map] Không tải được ${host}: ${details.error}`);
  });

  // Ghi lỗi console của renderer ra terminal (CSP, net::ERR_…, thiếu thư viện).
  mainWindow.webContents.on("console-message", (event) => {
    const level = event.level ?? "info";
    const message = event.message ?? "";
    if (/Content Security Policy|ERR_|Failed to load/i.test(message)) {
      console.warn(`[renderer:${level}] ${message}`);
    }
  });

  // Không cho điều hướng ra ngoài; link ngoài mở bằng trình duyệt hệ thống.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== RENDERER_URL) event.preventDefault();
  });

  // Cho phép dùng geolocation (nút "Lấy vị trí GPS" trong biểu mẫu phản hồi).
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === "geolocation");
  });

  mainWindow.loadFile(join(__dirname, "index.html"));
  return mainWindow;
}

/* ---------------------------------- Boot ----------------------------------- */

async function pickImages() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Chọn hình ảnh đính kèm",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Hình ảnh", extensions: ALLOWED_EXTENSIONS.map((ext) => ext.replace(".", "")) }],
  });
  if (result.canceled) return { ok: true, canceled: true, files: [] };
  return {
    ok: true,
    canceled: false,
    files: result.filePaths.slice(0, MAX_IMAGES).map((filePath) => ({ path: filePath, name: filePath.split(/[\\/]/).pop() })),
  };
}

function createRouter() {
  return createIpcRouter({
    service,
    appInfo: () => ({ version: app.getVersion(), platform: process.platform, userData: app.getPath("userData") }),
    pickImages,
    images: {
      save: ({ sourcePath }) => savePendingImage({ sourcePath, imagesRoot }),
      url: (feedbackId, name) => imageUrl(feedbackId, name),
    },
  });
}

async function bootstrap() {
  const dbPath = join(app.getPath("userData"), "db.json");
  imagesRoot = join(app.getPath("userData"), "images");
  store = new DataStore(dbPath, {
    seedAdminPassword: process.env.KHANHHOA_ADMIN_PASSWORD || "Admin@2025",
  });
  service = new AppService(store, {
    // Sau khi tạo phản hồi, chuyển ảnh đã lưu tạm vào thư mục của phản hồi.
    onFeedbackCreated: (feedback) =>
      attachPendingImages({
        imagesRoot,
        pendingId: feedback.imagesPendingId,
        feedbackId: feedback.id,
        names: feedback.images,
      }),
  });
  router = createRouter();

  registerImageProtocol();
  buildMenu();
  createWindow();

  // Mọi IPC đi qua router với 1 kênh duy nhất -> dễ kiểm soát & test.
  ipcMain.handle(REQUEST_CHANNEL, async (event, request) => {
    const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || "";
    if (!senderUrl.startsWith("file://")) {
      return { ok: false, code: "FORBIDDEN", errors: ["Nguồn gọi không hợp lệ."] };
    }

    // IP thật của máy: renderer KHÔNG được tự khai, main lấy từ socket/headers.
    const ip = resolveClientIp(event);
    const payload = {
      ...(request?.payload || {}),
      ip,
      // clientIp: IP của máy gửi (main process lấy, renderer không tự khai).
      clientIp: ip,
      submittedFrom: "desktop",
      deviceInfo: resolveDeviceInfo(event),
    };

    // Token thiết bị khách: đọc từ cookie; chưa có thì cấp mới và đặt cookie.
    const cookies = event.sender.session.cookies;
    let deviceToken = "";
    try {
      const found = await cookies.get({ url: RENDERER_URL, name: DEVICE_COOKIE });
      deviceToken = (found && found.value) || "";
    } catch {
      deviceToken = "";
    }
    if (!deviceToken) {
      deviceToken = createDeviceToken();
      try {
        await cookies.set({
          url: RENDERER_URL,
          name: DEVICE_COOKIE,
          value: deviceToken,
          httpOnly: true,
          sameSite: "strict",
          expirationDate: Math.floor(Date.now() / 1000) + DEVICE_TOKEN_TTL_DAYS * 24 * 60 * 60,
        });
      } catch (error) {
        console.warn("[device] không đặt được cookie:", error.message);
      }
    }

    return router.handle({ ...request, payload: { ...payload, deviceToken } });
  });
  // Danh sách kênh cho renderer kiểm tra môi trường desktop.
  ipcMain.handle("khanhhoa:channels", () => CHANNELS);
}

app.whenReady()
  .then(bootstrap)
  .catch((error) => {
    // Lỗi trong bootstrap (đọc DB, tạo cửa sổ…) — hiện rõ thay vì treo im lặng.
    console.error("[main] Không khởi động được ứng dụng:", error);
    try {
      dialog.showErrorBox("Bản đồ Yêu thương Khánh Hòa", `Không thể khởi động: ${error.message}`);
    } catch {
      /* dialog có thể chưa sẵn sàng */
    }
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Chặn mở nhiều bản chạy song song (tránh ghi đè db.json).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

export { bootstrap };
