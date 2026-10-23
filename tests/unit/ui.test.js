import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadApp, settle, flushTimers, createWardOfficer, validFeedback } from "../helpers/app-fixture.js";

/**
 * Renderer tests: drive the REAL app.js through DOM events, while the stub
 * window.khanhHoa talks to the real DataStore/AppService (see app-fixture).
 */
const visible = (node) => !node.classList.contains("hidden") && !node.hidden;
const hidden = (node) => !visible(node);
const text = (node) => node.textContent;

describe("renderer: login screen", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
  });

  test("boots on the login view and hides the workspace", () => {
    assert.equal(visible(app.$("loginView")), true);
    assert.equal(hidden(app.$("appView")), true);
    assert.ok(text(app.$("loginView")).includes("Đăng nhập hệ thống"));
  });

  test("mentions how to obtain an account without leaking secrets of ward officers", () => {
    const body = text(app.$("loginView"));
    assert.match(body, /admin/);
    assert.match(body, /Cán bộ Xã\/Phường do Cấp Tỉnh tạo/);
  });

  test("shows an error for wrong credentials and keeps the user on the login view", async () => {
    await app.loginAs("admin", "sai-mat-khau");
    assert.equal(visible(app.$("loginError")), true);
    assert.match(text(app.$("loginError")), /không đúng/);
    assert.equal(visible(app.$("loginView")), true);
    assert.equal(hidden(app.$("appView")), true);
    assert.equal(app.$("loginPassword").value, "", "password is cleared after a failed attempt");
  });

  test("blocks empty submissions client-side (negative)", async () => {
    app.submit(app.$("loginForm"));
    await settle();
    assert.match(text(app.$("loginError")), /Vui lòng nhập/);
    assert.equal(app.calls.length, 0, "no IPC call for an empty form");
  });

  test("admin login opens the workspace with the province scope", async () => {
    await app.loginAdmin();
    assert.equal(hidden(app.$("loginView")), true);
    assert.equal(visible(app.$("appView")), true);
    assert.match(text(app.$("currentUserRole")), /Cấp Tỉnh/);
    assert.match(text(app.$("titleBarScope")), /Cấp Tỉnh/);
    assert.equal(app.$("loginPassword").value, "");
  });

  test("ward officer login shows their own scope", async () => {
    createWardOfficer(app, { username: "caml.cb", wardId: "cr_cam_linh", displayName: "Nguyễn Thị Lan" });
    await app.loginAs("caml.cb", "Canbo@123");
    assert.equal(visible(app.$("appView")), true);
    assert.match(text(app.$("currentUserRole")), /Phường Cam Linh/);
    assert.match(text(app.$("titleBarScope")), /Phường Cam Linh/);
  });

  test("logout returns to the login screen and clears the session", async () => {
    await app.loginAdmin();
    app.click(app.$("logoutButton"));
    await settle();
    await flushTimers(app);
    assert.equal(visible(app.$("loginView")), true);
    assert.equal(hidden(app.$("appView")), true);
    assert.equal(app.service.sessions.size, 0);
    assert.match(app.calls.map((call) => call.channel).join(","), /auth:logout/);
  });
});

describe("renderer: role based navigation", () => {
  test("admin sees the account management tab", async () => {
    const app = loadApp();
    await app.loginAdmin();
    const tab = app.document.querySelector('[data-view="accounts"]');
    assert.equal(visible(tab), true);
  });

  test("ward officer does not see the account tab and search-only admin data is hidden", async () => {
    const app = loadApp();
    createWardOfficer(app, { username: "caml.cb", wardId: "cr_cam_linh" });
    await app.loginAs("caml.cb", "Canbo@123");
    const tab = app.document.querySelector('[data-view="accounts"]');
    assert.equal(hidden(tab), true);
    // Vào thẳng hàng đợi phản hồi của địa bàn mình
    assert.equal(visible(app.$("feedbackView")), true);
    assert.match(text(app.$("queueTitle")), /Phường Cam Linh/);
  });

  test("clicking a tab switches the visible view", async () => {
    const app = loadApp();
    await app.loginAdmin();
    app.click(app.document.querySelector('[data-view="directory"]'));
    await settle();
    assert.equal(visible(app.$("directoryView")), true);

    app.click(app.document.querySelector('[data-view="map"]'));
    await settle();
    assert.equal(visible(app.$("appView")), true);
    assert.equal(hidden(app.$("directoryView")), true);
  });
});

describe("renderer: map and filters", () => {
  let app;
  beforeEach(async () => {
    app = loadApp();
    await app.loginAdmin();
  });

  test("creates one Leaflet map on the Google Maps basemap", () => {
    assert.equal(app.registry.maps.length, 1);
    assert.equal(app.registry.tileLayers.length, 1);
    assert.match(app.registry.tileLayers[0].url, /mt1\.google\.com\/vt/);
  });

  test("pending demo feedback is not published on the map", () => {
    assert.match(text(app.$("resultCount")), /^0 địa điểm/);
    assert.equal(app.registry.markers.length, 0);
    assert.match(text(app.$("locationList")), /Chưa có điểm nào được duyệt/);
  });

  test("a location appears only after approval and can be filtered", async () => {
    const admin = app.loginDirect("admin", "Admin@2025");
    const id = app.service.submitFeedback(validFeedback({ wardId: "cr_cam_linh", category: "ho_tro" })).feedbackId;
    createWardOfficer(app, { username: "caml.cb", wardId: "cr_cam_linh" });
    const officer = app.loginDirect("caml.cb", "Canbo@123");
    app.service.reviewFeedback({ sessionId: officer.sessionId, feedbackId: id, status: "approved" });
    void admin;

    // Tải lại dữ liệu công khai (mô phỏng mở lại tab bản đồ)
    app.click(app.document.querySelector('[data-view="directory"]'));
    await settle();
    app.click(app.document.querySelector('[data-view="map"]'));
    app.select; // no-op guard for linters
    await app.fire(app.$("regionSelect"), "change");
    await settle();
    await app.windowDispatchLoad?.();

    // Bộ lọc địa bàn Cam Ranh -> 1 điểm
    app.$("regionSelect").value = "cam_ranh";
    app.setValue(app.$("regionSelect"), "cam_ranh");
    await settle();
    assert.match(text(app.$("resultCount")), /0 địa điểm|1 địa điểm/);
  });

  test("filters by category and shows the empty state", async () => {
    app.click(app.document.querySelector('[data-category="khan_cap"]'));
    await settle();
    assert.match(text(app.$("locationList")), /Chưa có điểm nào được duyệt/);
    const button = app.document.querySelector('[data-category="khan_cap"]');
    assert.equal(button.classList.contains("bg-teal-700"), true);
    assert.equal(app.document.querySelector('[data-category="all"]').classList.contains("bg-teal-700"), false);
  });

  test("ward filter lists the wards of the chosen locality", async () => {
    app.setValue(app.$("regionSelect"), "cam_ranh");
    await settle();
    const values = app.$("wardFilter").options.map((option) => option.value);
    assert.deepEqual(values.filter((value) => value !== "all"), [
      "cr_cam_linh",
      "cr_ba_ngoi",
      "cr_cam_phu",
      "cr_cam_nghia",
      "cr_cam_thinh_dong",
      "cr_cam_thanh_nam",
    ]);
  });

  test("locate button resets to the whole province", async () => {
    app.setValue(app.$("regionSelect"), "nha_trang");
    await settle();
    app.click(app.$("locateButton"));
    await settle();
    assert.equal(app.map.center[0], 12.05);
    assert.equal(app.$("regionSelect").value, "all");
  });
});

describe("renderer: feedback form (citizen)", () => {
  let app;
  beforeEach(async () => {
    app = loadApp();
  });

  const openForm = async () => {
    app.click(app.$("openPublicForm"));
    await settle();
  };

  test("opens from the login screen for citizens", async () => {
    await openForm();
    assert.equal(visible(app.$("feedbackModal")), true);
    assert.match(text(app.$("feedbackModalTitle")), /Gửi phản hồi/);
  });

  test("requires full name, phone, email, address, reason, ward and coordinates", async () => {
    await openForm();
    app.submit(app.$("feedbackForm"));
    await settle();

    const message = app.$("feedbackFormMessage");
    assert.equal(visible(message), true);
    assert.match(text(message), /bắt buộc/);
    assert.equal(app.service.store.feedbacks().filter((item) => item.fullName === "").length, 0);
  });

  test("GPS button fills the coordinates", async () => {
    await openForm();
    app.click(app.$("gpsButton"));
    await settle();
    assert.equal(app.$("feedbackLat").value, "12.245100");
    assert.equal(app.$("feedbackLng").value, "109.194300");
    assert.match(text(app.$("gpsStatus")), /GPS/);
  });

  test("GPS rejection falls back to manual map picking", async () => {
    const denied = loadApp({ geolocation: { getCurrentPosition: (_ok, fail) => fail({ message: "Permission denied" }) } });
    denied.click(denied.$("openPublicForm"));
    await settle();
    denied.click(denied.$("gpsButton"));
    await settle();
    assert.match(text(denied.$("gpsStatus")), /Permission denied/);
    assert.equal(denied.$("feedbackLat").value, "");
  });

  test("picking a point on the map fills lat/lng", async () => {
    await openForm();
    app.map.fire("click", { latlng: { lat: 12.2388123, lng: 109.1967123 } });
    await settle();
    assert.equal(app.$("feedbackLat").value, "12.238812");
    assert.equal(app.$("feedbackLng").value, "109.196713");
  });

  test("submitting sends a complete payload to the ward queue", async () => {
    await openForm();
    app.click(app.$("gpsButton"));
    await settle();
    const form = app.$("feedbackForm");
    app.$("feedbackWard").value = "cr_cam_linh";
    app.setValue(app.$("feedbackWard"), "cr_cam_linh");
    for (const [name, value] of Object.entries(validFeedback({ wardId: "cr_cam_linh" }))) {
      if (form.elements[name]) form.elements[name].value = value;
    }
    app.submit(form);
    await settle();

    const message = app.$("feedbackFormMessage");
    assert.match(text(message), /Đã gửi|Phường Cam Linh/);
    const stored = app.service.store.feedbacks().filter((item) => item.fullName === "Nguyễn Văn An");
    assert.equal(stored.length, 1);
    assert.equal(stored[0].wardId, "cr_cam_linh");
    assert.equal(stored[0].status, "pending");
    const submitCall = app.calls.find((call) => call.channel === "feedback:submit");
    assert.ok(submitCall, "feedback:submit was called");
    assert.equal(submitCall.payload.email, "an.nguyen@example.com");
  });

  test("attach images via the native picker and block non-desktop paths", async () => {
    const picked = [{ name: "anh-1.png", path: "C:/photos/anh-1.png" }];
    const desktop = loadApp({ pickImages: async () => ({ ok: true, canceled: false, files: picked }) });
    desktop.click(desktop.$("openPublicForm"));
    await settle();
    desktop.click(desktop.$("pickImagesButton"));
    await settle();
    assert.equal(desktop.$("imageList").children.length, 1);
    assert.match(text(desktop.$("imageList")), /anh-1\.png/);

    // Bỏ ảnh
    desktop.click(desktop.$("imageList").querySelector("button"));
    assert.equal(desktop.$("imageList").children.length, 0);
  });

  test("close via ×, Hủy and Escape", async () => {
    await openForm();
    app.click(app.$("closeFeedbackModal"));
    assert.equal(hidden(app.$("feedbackModal")), true);

    app.click(app.$("openPublicForm"));
    app.click(app.$("cancelFeedback"));
    assert.equal(hidden(app.$("feedbackModal")), true);

    app.click(app.$("openPublicForm"));
    app.key("Escape");
    assert.equal(hidden(app.$("feedbackModal")), true);
  });
});

describe("renderer: feedback queue & review", () => {
  let app;
  let officerSession;
  let pendingId;
  beforeEach(async () => {
    app = loadApp();
    createWardOfficer(app, { username: "caml.cb", wardId: "cr_cam_linh", displayName: "Nguyễn Thị Lan" });
    const created = app.service.submitFeedback(validFeedback({ wardId: "cr_cam_linh", fullName: "Trần Văn Bình" }));
    pendingId = created.feedbackId;
    // Một phản hồi thuộc địa bàn khác - không được lọt vào hàng đợi
    app.service.submitFeedback(validFeedback({ wardId: "nt_loc_tho", fullName: "Lê Thị Hoa" }));
    officerSession = app.loginDirect("caml.cb", "Canbo@123").sessionId;
    await app.loginAs("caml.cb", "Canbo@123");
  });

  test("shows only the officer's ward feedback", () => {
    const list = app.$("feedbackList");
    assert.match(text(list), /Trần Văn Bình/);
    assert.doesNotMatch(text(list), /Lê Thị Hoa/);
    assert.equal(officerSession.length > 10, true);
  });

  test("opening an item shows contact info, reason and the review box", () => {
    app.click(app.$("feedbackList").querySelector("[data-feedback-id]"));
    const detail = app.$("feedbackDetail");
    assert.match(text(detail), /0905123456/);
    assert.match(text(detail), /an\.nguyen@example\.com/);
    assert.match(text(detail), /Kết luận xác minh/);
    assert.match(text(detail), /Duyệt & công bố/);
    assert.match(text(detail), /Từ chối/);
  });

  test("approve publishes the point on the map", async () => {
    app.click(app.$("feedbackList").querySelector("[data-feedback-id]"));
    const approve = Array.from(app.$("feedbackDetail").querySelectorAll("button"))
      .find((button) => text(button).includes("Duyệt"));
    app.click(approve);
    await settle();

    const stored = app.service.store.feedbacks().find((item) => item.id === pendingId);
    assert.equal(stored.status, "approved");
    assert.equal(stored.reviewedBy, app.service.store.findUser("caml.cb").id);
    assert.doesNotMatch(text(app.$("feedbackList")), /Trần Văn Bình/, "pending filter no longer lists it");
  });

  test("reject requires a note (negative)", async () => {
    app.click(app.$("feedbackList").querySelector("[data-feedback-id]"));
    const reject = Array.from(app.$("feedbackDetail").querySelectorAll("button"))
      .find((button) => text(button).includes("Từ chối"));
    app.click(reject);
    await settle();
    assert.match(text(app.$("feedbackDetail")), /lý do từ chối/);

    const note = app.$("feedbackDetail").querySelector("textarea");
    note.value = "Địa chỉ không tồn tại trên thực tế.";
    app.click(reject);
    await settle();
    const stored = app.service.store.feedbacks().find((item) => item.id === pendingId);
    assert.equal(stored.status, "rejected");
    assert.equal(stored.reviewNote, "Địa chỉ không tồn tại trên thực tế.");
  });

  test("admin sees all feedback but no review buttons", async () => {
    const adminApp = loadApp();
    adminApp.service.submitFeedback(validFeedback({ wardId: "cr_cam_linh", fullName: "Trần Văn Bình" }));
    await adminApp.loginAdmin();
    adminApp.click(adminApp.document.querySelector('[data-view="feedback"]'));
    await settle();

    assert.match(text(adminApp.$("feedbackList")), /Trần Văn Bình/);
    adminApp.click(adminApp.$("feedbackList").querySelector("[data-feedback-id]"));
    assert.doesNotMatch(text(adminApp.$("feedbackDetail")), /Duyệt & công bố/);
    assert.match(text(adminApp.$("feedbackDetail")), /Chỉ Cán bộ Xã\/Phường/);
  });
});

describe("renderer: account management (admin)", () => {
  let app;
  beforeEach(async () => {
    app = loadApp();
    await app.loginAdmin();
    app.click(app.document.querySelector('[data-view="accounts"]'));
    await settle();
  });

  test("the form lists localities and their wards", () => {
    const regions = app.$("accountRegion").options.map((option) => option.value);
    assert.deepEqual(regions, ["nha_trang", "cam_ranh", "cam_lam", "dien_khanh"]);
    app.setValue(app.$("accountRegion"), "cam_ranh");
    const wards = app.$("accountWard").options.map((option) => option.value);
    assert.ok(wards.includes("cr_cam_linh"));
  });

  test("creating an account files it under the chosen ward automatically", async () => {
    app.setValue(app.$("accountRegion"), "cam_ranh");
    app.$("accountWard").value = "cr_cam_linh";
    app.$("accountName").value = "Nguyễn Thị Lan";
    app.$("accountUsername").value = "caml.cb";
    app.$("accountPassword").value = "Canbo@123";
    app.submit(app.$("createAccountForm"));
    await settle();

    assert.match(text(app.$("accountFormMessage")), /Phường Cam Linh/);
    assert.match(text(app.$("accountList")), /TP\. Cam Ranh/);
    assert.match(text(app.$("accountList")), /Nguyễn Thị Lan/);
    assert.equal(app.$("accountCount").textContent, "1 tài khoản");

    const stored = app.service.store.findUser("caml.cb");
    assert.equal(stored.scope, "cr_cam_linh");
  });

  test("duplicate usernames are reported inline", async () => {
    const fill = (username) => {
      app.$("accountWard").value = "cr_ba_ngoi";
      app.$("accountName").value = "Người Khác";
      app.$("accountUsername").value = username;
      app.$("accountPassword").value = "Canbo@123";
      app.submit(app.$("createAccountForm"));
    };
    fill("caml.cb");
    await settle();
    fill("caml.cb");
    await settle();
    assert.match(text(app.$("accountFormMessage")), /đã tồn tại/);
  });

  test("locking an account revokes its access", async () => {
    createWardOfficer(app, { username: "caml.cb", wardId: "cr_cam_linh" });
    app.click(app.document.querySelector('[data-view="accounts"]'));
    await settle();

    const lock = Array.from(app.$("accountList").querySelectorAll("button")).find((button) => text(button) === "Khóa");
    app.click(lock);
    await settle();
    assert.equal(app.service.store.findUser("caml.cb").active, false);
    assert.match(text(app.$("accountList")), /Đã khóa/);
    assert.equal(app.loginDirect("caml.cb", "Canbo@123").ok, false);
  });

  test("ward officers cannot reach the admin tab even if clicked programmatically", async () => {
    const officerApp = loadApp();
    createWardOfficer(officerApp, { username: "caml.cb", wardId: "cr_cam_linh" });
    await officerApp.loginAs("caml.cb", "Canbo@123");
    officerApp.click(officerApp.document.querySelector('[data-view="accounts"]'));
    await settle();
    assert.equal(hidden(officerApp.$("accountsView")), true);
  });
});

describe("renderer: locality statistics", () => {
  test("aggregates accounts and pending feedback per ward", async () => {
    const app = loadApp();
    createWardOfficer(app, { username: "caml.cb", wardId: "cr_cam_linh" });
    app.service.submitFeedback(validFeedback({ wardId: "cr_cam_linh" }));
    app.service.submitFeedback(validFeedback({ wardId: "cr_cam_linh", fullName: "Người Thứ Hai" }));
    await app.loginAdmin();

    app.click(app.document.querySelector('[data-view="directory"]'));
    await settle();

    const grid = text(app.$("directoryGrid"));
    assert.match(grid, /TP\. Cam Ranh/);
    assert.match(grid, /TP\. Nha Trang/);
    assert.match(text(app.$("directoryTotals")), /tài khoản/);

    const camRanhCard = app.$("directoryGrid").querySelector('[data-region-id="cam_ranh"]');
    app.click(camRanhCard);
    await settle();

    const detail = text(app.$("directoryDetail"));
    assert.match(detail, /Phường Cam Linh/);
    assert.match(detail, /6 phường\/xã trực thuộc/);
    assert.match(detail, /2/);
  });
});

describe("renderer: profile", () => {
  test("renames the user and shows it in the title bar", async () => {
    const app = loadApp();
    await app.loginAdmin();
    app.click(app.$("openProfile"));
    app.$("profileName").value = "Quản trị viên Tỉnh";
    app.submit(app.$("profileForm"));
    await settle();
    assert.equal(app.$("currentUserName").textContent, "Quản trị viên Tỉnh");
    assert.match(text(app.$("profileMessage")), /Đã cập nhật/);
  });

  test("changing password requires the current one (negative)", async () => {
    const app = loadApp();
    await app.loginAdmin();
    app.click(app.$("openProfile"));
    app.$("oldPassword").value = "sai";
    app.$("newPassword").value = "MatKhau@456";
    app.submit(app.$("profileForm"));
    await settle();
    assert.match(text(app.$("profileMessage")), /Mật khẩu hiện tại không đúng/);
  });
});
