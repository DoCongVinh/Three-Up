/** Import db.json desktop vào SQLite web; chạy: npm run import:web -- "C:\\path\\db.json" */
import { existsSync, resolve } from "node:fs";
import { SqliteDataStore } from "../src/sqlite-store.js";

const source = resolve(process.argv[2] || process.env.KHANHHOA_DESKTOP_DB || "");
const target = resolve(process.env.KHANHHOA_WEB_DB || "data/khanhhoa-web.db");
if (!source || !existsSync(source)) {
  console.error("Không tìm thấy db.json. Dùng: npm run import:web -- \"đường-dẫn/db.json\"");
  process.exit(1);
}
const store = new SqliteDataStore(target, { allowSeed: false, importJsonPath: source });
try {
  const counts = store.replaceFromJson(source);
  console.log(`Đã nhập ${counts.users} tài khoản, ${counts.feedbacks} phản hồi, ${counts.categories} nhóm vào ${target}`);
} finally {
  store.close();
}
