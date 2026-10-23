/**
 * Kiểm tra tĩnh: mọi id mà app.js truy cập bằng $("...") đều tồn tại trong index.html.
 * Chạy: node scripts/check-dom-ids.mjs
 */
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const js = readFileSync("app.js", "utf8");

const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const used = new Set([...js.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]));

const missing = [...used].filter((id) => !htmlIds.has(id));
const unused = [...htmlIds].filter((id) => !used.has(id));

console.log("ids trong HTML:", htmlIds.size, "| $() trong app.js:", used.size);
if (missing.length) console.log("THIẾU trong index.html:", missing.join(", "));
else console.log("OK: mọi $() đều có phần tử tương ứng");

// Các id chỉ dùng trong HTML/CSS (nhãn neo, modal, toast…) — không bắt buộc app.js dùng.
const informational = ["loginView", "appView", "mapView", "feedbackView", "directoryView", "accountsView", "mainTabs", "toast"];
console.log("id chỉ có trong HTML (ổn định):", unused.filter((id) => informational.includes(id)).join(", ") || "—");
process.exitCode = missing.length ? 1 : 0;
