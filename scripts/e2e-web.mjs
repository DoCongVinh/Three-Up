/**
 * Kiểm thử end-to-end cho server web (REST + Socket.io), chạy bằng Node thuần:
 *
 *   node scripts/check-web.mjs
 *
 * Kịch bản:
 *  1. Cán bộ đăng nhập qua POST /api/auth/login.
 *  2. Cán bộ mở Socket.io (auth { role: "officer", token }).
 *  3. Người dân mở Socket.io (auth { role: "citizen", deviceToken }).
 *  4. Người dân gửi POST /api/feedbacks -> cán bộ nhận "new-feedback".
 *  5. Cán bộ POST /api/feedbacks/:id/confirm -> người dân nhận "feedback-confirmed".
 *  6. Kiểm tra SQLite đã đổi trạng thái và API cấm truy cập khi chưa đăng nhập.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as connect } from "socket.io-client";
import { startWebServer } from "../server.js";

const dir = mkdtempSync(join(tmpdir(), "khanhhoa-web-"));
const server = await startWebServer({
  port: 0,
  host: "127.0.0.1",
  dbPath: join(dir, "test.db"),
  seedDemo: false,
  importJson: false,
});
// port 0 -> cổng thật nằm trên httpServer.
const { port } = server.httpServer.address();
const base = `http://127.0.0.1:${port}`;

const results = [];
const check = (name, condition, extra = "") => {
  results.push({ name, ok: Boolean(condition), extra });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

const waitFor = (socket, event, timeout = 4000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Không nhận được "${event}" sau ${timeout}ms`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const json = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, options);
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

try {
  /* 1. Trang tĩnh + health */
  const health = await json("/api/health");
  check("GET /api/health", health.body.ok === true);
  const home = await fetch(`${base}/`);
  const homeHtml = await home.text();
  check("Trang người dân có nút gửi phản hồi", home.status === 200 && homeHtml.includes('id="feedbackForm"'));
  const officerPage = await fetch(`${base}/officer.html`);
  check("Trang cán bộ tồn tại", officerPage.status === 200);
  const socketClient = await fetch(`${base}/socket.io/socket.io.js`);
  check("Server phục vụ socket.io client", socketClient.status === 200);

  /* 2. Bảo mật cơ bản */
  const anonymous = await json("/api/feedbacks");
  check("GET /api/feedbacks cần đăng nhập (401)", anonymous.status === 401);

  const badLogin = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "sai-mat-khau" }),
  });
  check("Đăng nhập sai bị từ chối (401)", badLogin.status === 401);

  /* 3. Đăng nhập + mở socket */
  const login = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "Admin@2025" }),
  });
  check("Đăng nhập admin thành công", login.body.ok === true && !!login.body.token);
  check("Không trả password hash", !JSON.stringify(login.body).includes("scrypt$"));

  const account = await json("/api/rpc/accounts:create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.body.token}` },
    body: JSON.stringify({ username: "testcb", password: "Test1234", displayName: "Cán bộ kiểm thử", wardId: "nt_nhatrang" }),
  });
  check("Admin tạo cán bộ cho phường kiểm thử", account.body.ok === true, account.body.errors?.[0] || "");
  const officerLogin = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "testcb", password: "Test1234" }),
  });
  check("Cán bộ phường đăng nhập", officerLogin.body.ok === true, officerLogin.body.errors?.[0] || "");

  const officer = connect(base, { auth: { role: "officer", token: officerLogin.body.token }, transports: ["websocket"] });
  const ready = await waitFor(officer, "officer:ready");
  check("Cán bộ vào phòng Socket", ready.user?.username === "testcb");

  const deviceToken = "citizen-device-for-test";
  const citizen = connect(base, { auth: { role: "citizen", deviceToken }, transports: ["websocket"] });
  await new Promise((resolve) => citizen.once("connect", resolve));
  check("Người dân kết nối Socket", citizen.connected === true);

  /* 4. Người dân gửi phản hồi -> cán bộ nhận new-feedback */
  const newFeedbackEvent = waitFor(officer, "new-feedback");
  const created = await json("/api/feedbacks", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-Token": deviceToken },
    body: JSON.stringify({
      fullName: "Nguyễn Văn An",
      phone: "0905123456",
      email: "an.nguyen@example.com",
      address: "12 Trần Phú",
      reason: "Cần hỗ trợ gạo và nước uống cho 5 hộ khó khăn trong tổ dân phố.",
      category: "ho_tro",
      wardId: "nt_nhatrang",
      hamlet: "Tổ dân phố 1",
      lat: 12.2451,
      lng: 109.1943,
    }),
  });
  check("POST /api/feedbacks -> 201", created.status === 201 && created.body.ok, created.body.error || "");
  const payload = await newFeedbackEvent;
  check("Cán bộ nhận 'new-feedback'", payload.feedback?.id === created.body.feedbackId, payload.feedback?.status);
  check("Sự kiện không lộ số điện thoại thô", !JSON.stringify(payload).includes("0905123456"));

  /* 5. Xác nhận -> người dân nhận feedback-confirmed */
  const confirmedEvent = waitFor(citizen, "feedback-confirmed");
  const confirmed = await json(`/api/feedbacks/${encodeURIComponent(created.body.feedbackId)}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${officerLogin.body.token}` },
    body: JSON.stringify({ note: "Đã cử tổ dân phố hỗ trợ chiều nay." }),
  });
  check("POST /api/feedbacks/:id/confirm", confirmed.status === 200 && confirmed.body.ok);
  const confirmedPayload = await confirmedEvent;
  check(
    "Người dân nhận 'feedback-confirmed'",
    confirmedPayload.feedbackId === created.body.feedbackId && confirmedPayload.status === "approved",
    confirmedPayload.statusLabel,
  );

  /* 6. Dữ liệu bền vững + trạng thái trên API */
  const mine = await json("/api/my-feedbacks", { headers: { "X-Device-Token": deviceToken } });
  const mineItem = mine.body.feedbacks?.find((item) => item.id === created.body.feedbackId);
  check("Người dân tra lại thấy trạng thái approved", mineItem?.status === "approved");

  const list = await json("/api/feedbacks?status=approved", { headers: { Authorization: `Bearer ${officerLogin.body.token}` } });
  check("Danh sách cán bộ có phản hồi đã duyệt", list.body.feedbacks?.some((item) => item.id === created.body.feedbackId));

  const locations = await json("/api/public-locations");
  check("Bản đồ công khai có ghim mới", locations.body.locations?.some((item) => item.id === created.body.feedbackId));

  const duplicate = await json(`/api/feedbacks/${encodeURIComponent(created.body.feedbackId)}/confirm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${officerLogin.body.token}` },
  });
  check("Xác nhận lặp lại -> 409", duplicate.status === 409);

  const rejected = await json(`/api/feedbacks/${encodeURIComponent(created.body.feedbackId)}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${officerLogin.body.token}` },
    body: JSON.stringify({ reason: "x" }),
  });
  check("Từ chối thiếu lý do -> 400", rejected.status === 400);

  citizen.disconnect();
  officer.disconnect();
} catch (error) {
  check("Luồng chạy không lỗi", false, error?.message || String(error));
} finally {
  await server.close();
  rmSync(dir, { recursive: true, force: true });

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} kiểm tra đạt.`);
  process.exit(failed.length ? 1 : 0);
}
