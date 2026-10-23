/**
 * Đồng bộ giao diện người dân (index.html + app.js) vào public/ để phục vụ trên web.
 *
 * index.html và app.js là nguồn duy nhất dùng chung cho cả desktop (Electron) và
 * web. Script này chèn thêm 2 thư viện của bản web vào bản copy:
 *   - /socket.io/socket.io.js  (client Socket.io do server.js phục vụ)
 *   - /js/khanhHoa-web.js      (cầu nối REST + Socket, thay cho preload.cjs)
 *
 * Chạy: npm run sync:web   (sau mỗi lần sửa index.html / app.js / src/**)
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT, "public");

const HEAD_TAG = '<script src="/socket.io/socket.io.js"></script>';
const BODY_TAGS = [
  '<script src="/js/khanhHoa-web.js"></script>',
  '<script src="app.js"></script>',
].join("\n  ");

function buildIndexHtml() {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  if (!html.includes('<script src="app.js"></script>')) {
    throw new Error("index.html: không tìm thấy <script src=\"app.js\">");
  }
  return html
    .replace('<script src="app.js"></script>', BODY_TAGS)
    .replace("</head>", `  ${HEAD_TAG}\n</head>`);
}

mkdirSync(PUBLIC_DIR, { recursive: true });
writeFileSync(join(PUBLIC_DIR, "index.html"), buildIndexHtml(), "utf8");
copyFileSync(join(ROOT, "app.js"), join(PUBLIC_DIR, "app.js"));

console.log("[sync:web] Đã tạo public/index.html và public/app.js");
