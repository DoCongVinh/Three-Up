import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore, hashPassword, verifyPassword } from "../../src/data-store.js";
import { AppService } from "../../src/app-service.js";

const newStore = (options = {}) => {
  const dir = options.dir || mkdtempSync(join(tmpdir(), "khanhhoa-store-"));
  return new DataStore(join(dir, "db.json"), { now: () => "2026-01-01T00:00:00.000Z", ...options });
};

const validFeedback = (overrides = {}) => ({
  fullName: "Nguyễn Văn An",
  phone: "0905123456",
  email: "an.nguyen@example.com",
  address: "12 Trần Phú, phường Lộc Thọ",
  reason: "Điểm phát cơm miễn phí cho người lao động khó khăn, mở 10h-12h hằng ngày.",
  category: "ho_tro",
  wardId: "nt_loc_tho",
  lat: 12.2451,
  lng: 109.1943,
  ...overrides,
});

describe("data-store: password hashing", () => {
  test("hashes with a random salt and never stores the plain password", () => {
    const a = hashPassword("Canbo@123");
    const b = hashPassword("Canbo@123");
    assert.match(a, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    assert.notEqual(a, b);
    assert.equal(a.includes("Canbo@123"), false);
    assert.equal(verifyPassword("Canbo@123", a), true);
    assert.equal(verifyPassword("wrong", a), false);
  });

  test("rejects malformed hashes instead of throwing (edge)", () => {
    for (const value of ["", "plain", "md5$abc$def", null, undefined]) {
      assert.equal(verifyPassword("x", value), false);
    }
  });
});

describe("data-store: initialisation & persistence", () => {
  test("creates db.json seeded with the admin account on first run", () => {
    const store = newStore({ dir: mkdtempSync(join(tmpdir(), "khanhhoa-seed-")) });
    const file = store.filePath;
    assert.equal(existsSync(file), true);
    assert.equal(store.seeded, true);

    const admin = store.findUser("admin");
    assert.equal(admin.role, "admin");
    assert.equal(verifyPassword("Admin@2025", admin.passwordHash), true);
    assert.equal(admin.mustChangePassword, true);
    assert.ok(store.feedbacks().length > 0, "demo feedback is seeded");
  });

  test("reloads existing data from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "khanhhoa-reload-"));
    const first = newStore({ dir, seedFeedback: false });
    first.createWardAccount({
      actor: { id: "a", username: "admin", role: "admin" },
      username: "lan.cb",
      displayName: "Nguyễn Thị Lan",
      password: "Canbo@123",
      scope: "cr_cam_linh",
    });

    const second = new DataStore(join(dir, "db.json"), { allowSeed: false });
    assert.equal(second.publicUsers().filter((user) => user.role === "ward").length, 1);
    assert.equal(second.findUser("lan.cb").scope, "cr_cam_linh");
  });

  test("keeps a .bak copy on every write", () => {
    const store = newStore({ seedFeedback: false });
    const before = readFileSync(store.filePath, "utf8");
    store.addAudit("touch", "system");
    store.commit(store.db);
    assert.equal(existsSync(`${store.filePath}.bak`), true);
    // .bak là bản trước lần ghi gần nhất
    assert.equal(readFileSync(`${store.filePath}.bak`, "utf8"), before);
  });

  test("recovers from corrupted JSON by starting fresh and keeping a copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "khanhhoa-corrupt-"));
    const file = join(dir, "db.json");
    writeFileSync(file, "{ broken");
    const store = new DataStore(file);
    assert.equal(store.seeded, true);
    assert.equal(store.findUser("admin").role, "admin");
    const files = readFileSync(file, "utf8");
    assert.match(files, /"users"/);
  });
});

describe("data-store: authentication", () => {
  let store;
  beforeEach(() => {
    store = newStore({ seedFeedback: false });
  });

  test("logs in with correct credentials and returns a public user", () => {
    const result = store.authenticate("ADMIN ", "Admin@2025");
    assert.equal(result.ok, true);
    assert.equal(result.user.role, "admin");
    assert.equal("passwordHash" in result.user, false);
  });

  test("rejects wrong password, unknown user and disabled user (negative)", () => {
    assert.equal(store.authenticate("admin", "sai-mat-khau").ok, false);
    assert.equal(store.authenticate("khong-co", "Admin@2025").ok, false);

    store.createWardAccount({
      actor: { id: "a", username: "admin", role: "admin" },
      username: "lan.cb",
      displayName: "Nguyễn Thị Lan",
      password: "Canbo@123",
      scope: "cr_cam_linh",
    });
    const officer = store.findUser("lan.cb");
    store.setUserActive({ actor: { id: "a", username: "admin", role: "admin" }, userId: officer.id, active: false });
    assert.equal(store.authenticate("lan.cb", "Canbo@123").ok, false);
  });

  test("uses the same error message for both failure cases (no user enumeration)", () => {
    const wrongPass = store.authenticate("admin", "x");
    const noUser = store.authenticate("nobody", "x");
    assert.equal(wrongPass.error, noUser.error);
  });

  test("records login audit entries", () => {
    store.authenticate("admin", "Admin@2025");
    store.authenticate("admin", "wrong");
    const actions = store.db.audit.map((entry) => entry.action);
    assert.ok(actions.includes("login"));
    assert.ok(actions.includes("login-failed"));
  });
});

describe("data-store: ward accounts", () => {
  let store;
  const admin = { id: "a", username: "admin", role: "admin" };
  beforeEach(() => {
    store = newStore({ seedFeedback: false });
  });

  const create = (overrides = {}) =>
    store.createWardAccount({
      actor: admin,
      username: "lan.cb",
      displayName: "Nguyễn Thị Lan",
      password: "Canbo@123",
      scope: "cr_cam_linh",
      ...overrides,
    });

  test("admin creates a ward account scoped to the chosen ward", () => {
    const result = create();
    assert.equal(result.ok, true);
    assert.equal(result.user.role, "ward");
    assert.equal(result.user.scope, "cr_cam_linh");
    assert.equal(result.user.scopeName, "Phường Cam Linh");
    assert.equal(result.user.regionName, "TP. Cam Ranh");
    assert.equal(store.authenticate("lan.cb", "Canbo@123").ok, true);
  });

  test("ward officers cannot create accounts (authorization)", () => {
    const result = create({ actor: { id: "w", username: "x", role: "ward", scope: "cr_cam_linh" } });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(), /Cấp Tỉnh/);
  });

  test("blocks duplicate usernames and invalid wards", () => {
    create();
    const duplicate = create({ displayName: "Người Khác", scope: "cr_ba_ngoi" });
    assert.equal(duplicate.ok, false);
    assert.match(duplicate.errors.join(), /đã tồn tại/);

    const badWard = create({ username: "khac.cb", scope: "nope" });
    assert.equal(badWard.ok, false);
    assert.match(badWard.errors.join(), /Phường\/Xã/);
  });

  test("admin can lock/unlock but never lock an admin account", () => {
    const created = create();
    const locked = store.setUserActive({ actor: admin, userId: created.user.id, active: false });
    assert.equal(locked.ok, true);
    assert.equal(locked.user.active, false);
    assert.equal(store.authenticate("lan.cb", "Canbo@123").ok, false);

    const adminUser = store.findUser("admin");
    const lockAdmin = store.setUserActive({ actor: admin, userId: adminUser.id, active: false });
    assert.equal(lockAdmin.ok, false);
  });

  test("changes password only with the current one", () => {
    const wrong = store.changePassword({ actor: store.authenticate("admin", "Admin@2025").user, oldPassword: "x", newPassword: "NewPass@123" });
    assert.equal(wrong.ok, false);

    const actor = store.authenticate("admin", "Admin@2025").user;
    const same = store.changePassword({ actor, oldPassword: "Admin@2025", newPassword: "Admin@2025" });
    assert.equal(same.ok, false);

    const ok = store.changePassword({ actor, oldPassword: "Admin@2025", newPassword: "NewPass@123" });
    assert.equal(ok.ok, true);
    assert.equal(store.authenticate("admin", "NewPass@123").ok, true);
    assert.equal(store.authenticate("admin", "Admin@2025").ok, false);
    assert.equal(store.findUser("admin").mustChangePassword, false);
  });
});

describe("data-store: feedback pipeline", () => {
  let store;
  let service;
  let adminSession;
  let officerSession;
  beforeEach(() => {
    store = newStore({ seedFeedback: false });
    service = new AppService(store);
    adminSession = service.login({ username: "admin", password: "Admin@2025" }).sessionId;
    service.createAccount({
      sessionId: adminSession,
      username: "caml.cb",
      password: "Canbo@123",
      displayName: "Cán bộ Cam Linh",
      wardId: "cr_cam_linh",
    });
    officerSession = service.login({ username: "caml.cb", password: "Canbo@123" }).sessionId;
  });

  test("a citizen submission lands in the ward officer's pending queue", () => {
    const submit = service.submitFeedback(validFeedback({ wardId: "cr_cam_linh" }));
    assert.equal(submit.ok, true, submit.errors?.join("; "));
    assert.equal(submit.routedTo.wardName, "Phường Cam Linh");

    const queue = service.listFeedbacks({ sessionId: officerSession, status: "pending" });
    assert.equal(queue.ok, true);
    assert.equal(queue.counts.pending, 1);
    assert.equal(queue.feedbacks[0].id, submit.feedbackId);
    assert.equal(queue.feedbacks[0].canReview, true);
  });

  test("invalid submissions are rejected at the service boundary", () => {
    const result = service.submitFeedback({ fullName: "", email: "x" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "VALIDATION");
    assert.ok(result.errors.length >= 3);
    assert.equal(store.feedbacks().length, 0);
  });

  test("officers only list their own ward; admin lists all", () => {
    service.submitFeedback(validFeedback({ wardId: "cr_cam_linh" }));
    service.submitFeedback(validFeedback({ wardId: "nt_loc_tho", fullName: "Trần Bình" }));

    assert.equal(service.listFeedbacks({ sessionId: officerSession }).feedbacks.length, 1);
    assert.equal(service.listFeedbacks({ sessionId: adminSession }).feedbacks.length, 2);
  });

  test("officer can approve own ward, cannot review another ward", () => {
    const own = service.submitFeedback(validFeedback({ wardId: "cr_cam_linh" })).feedbackId;
    const foreign = service.submitFeedback(validFeedback({ wardId: "cr_ba_ngoi" })).feedbackId;

    const approved = service.reviewFeedback({ sessionId: officerSession, feedbackId: own, status: "approved" });
    assert.equal(approved.ok, true);
    assert.equal(approved.feedback.status, "approved");
    assert.equal(approved.feedback.reviewedBy, store.findUser("caml.cb").id);

    const denied = service.reviewFeedback({ sessionId: officerSession, feedbackId: foreign, status: "approved" });
    assert.equal(denied.ok, false);
    assert.match(denied.errors.join(), /phường\/xã khác/);
  });

  test("admin cannot approve feedback (only ward officers can)", () => {
    const id = service.submitFeedback(validFeedback({ wardId: "cr_cam_linh" })).feedbackId;
    const result = service.reviewFeedback({ sessionId: adminSession, feedbackId: id, status: "approved" });
    assert.equal(result.ok, false);
  });

  test("rejection needs a note and keeps the record out of the map", () => {
    const id = service.submitFeedback(validFeedback({ wardId: "cr_cam_linh" })).feedbackId;
    assert.equal(service.reviewFeedback({ sessionId: officerSession, feedbackId: id, status: "rejected" }).ok, false);

    const rejected = service.reviewFeedback({
      sessionId: officerSession,
      feedbackId: id,
      status: "rejected",
      note: "Thông tin không chính xác.",
    });
    assert.equal(rejected.ok, true);
    assert.equal(service.publicLocations().length, 0);
  });

  test("approved feedback becomes a public map location", () => {
    const id = service.submitFeedback(validFeedback({ wardId: "cr_cam_linh" })).feedbackId;
    service.reviewFeedback({ sessionId: officerSession, feedbackId: id, status: "approved" });

    const [location] = service.publicLocations();
    assert.equal(location.id, id);
    assert.equal(location.verified, true);
    assert.equal(location.ward, "cr_cam_linh");
    assert.match(location.title, /Điểm hỗ trợ/);
    assert.equal(location.lat, 12.2451);
  });

  test("pending feedback never leaks onto the public map", () => {
    service.submitFeedback(validFeedback({ wardId: "cr_cam_linh" }));
    assert.deepEqual(service.publicLocations(), []);
  });

  test("status counts match the queue", () => {
    const a = service.submitFeedback(validFeedback({ wardId: "cr_cam_linh" })).feedbackId;
    const b = service.submitFeedback(validFeedback({ wardId: "cr_cam_linh", fullName: "Lê C" })).feedbackId;
    service.submitFeedback(validFeedback({ wardId: "cr_cam_linh", fullName: "Phạm D" }));
    service.reviewFeedback({ sessionId: officerSession, feedbackId: a, status: "approved" });
    service.reviewFeedback({ sessionId: officerSession, feedbackId: b, status: "rejected", note: "Sai địa chỉ." });

    const queue = service.listFeedbacks({ sessionId: officerSession });
    assert.deepEqual(queue.counts, { all: 3, pending: 1, approved: 1, rejected: 1 });
  });
});

describe("app-service: sessions & authorization", () => {
  let store;
  let service;
  beforeEach(() => {
    store = newStore({ seedFeedback: false });
    service = new AppService(store);
  });

  test("login issues an opaque session id, logout invalidates it", () => {
    const login = service.login({ username: "admin", password: "Admin@2025" });
    assert.equal(login.ok, true);
    assert.match(login.sessionId, /^[0-9a-f-]{36}$/);
    assert.equal(service.me({ sessionId: login.sessionId }).user.role, "admin");

    service.logout({ sessionId: login.sessionId });
    const after = service.me({ sessionId: login.sessionId });
    assert.equal(after.ok, false);
    assert.equal(after.code, "UNAUTHENTICATED");
  });

  test("sessions expire after the TTL (edge)", () => {
    let now = 1_000_000;
    const timedService = new AppService(store, { now: () => now });
    const login = timedService.login({ username: "admin", password: "Admin@2025" });
    assert.equal(timedService.me({ sessionId: login.sessionId }).ok, true);

    now += 9 * 60 * 60 * 1000;
    const expired = timedService.me({ sessionId: login.sessionId });
    assert.equal(expired.ok, false);
    assert.equal(expired.code, "UNAUTHENTICATED");
  });

  test("disabled accounts lose their session immediately", () => {
    const admin = service.login({ username: "admin", password: "Admin@2025" });
    service.createAccount({ sessionId: admin.sessionId, username: "caml.cb", password: "Canbo@123", displayName: "Cán bộ Cam Linh", wardId: "cr_cam_linh" });
    const officer = service.login({ username: "caml.cb", password: "Canbo@123" });
    assert.equal(service.me({ sessionId: officer.sessionId }).ok, true);

    const officerId = store.findUser("caml.cb").id;
    service.setAccountActive({ sessionId: admin.sessionId, accountId: officerId, active: false });
    assert.equal(service.me({ sessionId: officer.sessionId }).ok, false);
  });

  test("missing or forged session ids are rejected", () => {
    for (const sessionId of [undefined, "", "forged"]) {
      const result = service.listAccounts({ sessionId });
      assert.equal(result.ok, false);
      assert.equal(result.code, "UNAUTHENTICATED");
    }
  });

  test("ward sessions get FORBIDDEN on admin endpoints", () => {
    const admin = service.login({ username: "admin", password: "Admin@2025" });
    service.createAccount({
      sessionId: admin.sessionId,
      username: "caml.cb",
      password: "Canbo@123",
      displayName: "Cán bộ Cam Linh",
      wardId: "cr_cam_linh",
    });
    const officer = service.login({ username: "caml.cb", password: "Canbo@123" });

    assert.equal(service.listAccounts({ sessionId: officer.sessionId }).code, "FORBIDDEN");
    const create = service.createAccount({
      sessionId: officer.sessionId,
      username: "hack.cb",
      password: "Canbo@123",
      displayName: "Hacker",
      wardId: "cr_cam_linh",
    });
    assert.equal(create.code, "FORBIDDEN");
  });

  test("accounts:create returns the refreshed managed list (auto categorization)", () => {
    const admin = service.login({ username: "admin", password: "Admin@2025" });
    const first = service.createAccount({
      sessionId: admin.sessionId,
      username: "nt.cb",
      password: "Canbo@123",
      displayName: "Cán bộ Nha Trang",
      wardId: "nt_tan_lap",
    });
    assert.equal(first.ok, true);
    assert.equal(first.accounts.length, 1);
    assert.equal(first.account.regionId, "nha_trang");

    const second = service.createAccount({
      sessionId: admin.sessionId,
      username: "cr.cb",
      password: "Canbo@123",
      displayName: "Cán bộ Cam Linh",
      wardId: "cr_cam_linh",
    });
    assert.equal(second.accounts.length, 2);
    assert.deepEqual(second.accounts.map((account) => account.scope).sort(), ["cr_cam_linh", "nt_tan_lap"]);
  });

  test("validation errors are surfaced, not thrown", () => {
    const admin = service.login({ username: "admin", password: "Admin@2025" });
    const result = service.createAccount({ sessionId: admin.sessionId, username: "x", password: "1", displayName: "", wardId: "" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "VALIDATION");
    assert.ok(result.errors.length >= 3);
  });

  test("directory statistics hide other wards from a ward officer", () => {
    const admin = service.login({ username: "admin", password: "Admin@2025" });
    service.createAccount({
      sessionId: admin.sessionId,
      username: "caml.cb",
      password: "Canbo@123",
      displayName: "Cán bộ Cam Linh",
      wardId: "cr_cam_linh",
    });
    const officer = service.login({ username: "caml.cb", password: "Canbo@123" });

    const all = service.directory({ sessionId: admin.sessionId });
    assert.equal(all.statistics.length, 4);
    const camRanh = all.statistics.find((region) => region.id === "cam_ranh");
    assert.equal(camRanh.accountCount, 1);

    const scoped = service.directory({ sessionId: officer.sessionId });
    assert.equal(scoped.statistics.length, 1);
    assert.deepEqual(scoped.statistics[0].wards.map((ward) => ward.id), ["cr_cam_linh"]);
  });

  test("region detail aggregates accounts + feedback counters", () => {
    const detail = service.regionDetail({ regionId: "cam_ranh" });
    assert.equal(detail.ok, true);
    assert.equal(detail.region.wardCount, 6);
    assert.equal(service.regionDetail({ regionId: "nowhere" }).ok, false);
  });

  test("dashboard totals differ by role", () => {
    const admin = service.login({ username: "admin", password: "Admin@2025" });
    service.createAccount({ sessionId: admin.sessionId, username: "caml.cb", password: "Canbo@123", displayName: "Cán bộ Cam Linh", wardId: "cr_cam_linh" });
    service.submitFeedback(validFeedback({ wardId: "cr_cam_linh" }));

    const adminDash = service.dashboard({ sessionId: admin.sessionId });
    assert.equal(adminDash.totals.accounts, 1);
    assert.equal(adminDash.totals.wardsCovered, 1);
    assert.equal(adminDash.totals.feedbacks, 1);
    // Admin xem tất cả phản hồi nhưng quyền duyệt thuộc cán bộ địa bàn.
    assert.equal(adminDash.totals.pending, 1);
    assert.equal(adminDash.latest.length, 1);
    // Dashboard chưa gắn cờ canReview (cờ này chỉ có trong hàng đợi).
    assert.equal(adminDash.latest[0].status, "pending");

    const officer = service.login({ username: "caml.cb", password: "Canbo@123" });
    const officerDash = service.dashboard({ sessionId: officer.sessionId });
    assert.equal(officerDash.totals.accounts, null);
    assert.equal(officerDash.totals.pending, 1);
  });

  test("profile update validates the name", () => {
    const admin = service.login({ username: "admin", password: "Admin@2025" });
    assert.equal(service.updateProfile({ sessionId: admin.sessionId, displayName: "AB" }).ok, false);
    const ok = service.updateProfile({ sessionId: admin.sessionId, displayName: "  Quản trị  Tỉnh " });
    assert.equal(ok.ok, true);
    assert.equal(ok.user.displayName, "Quản trị Tỉnh");
  });

  test("image attach hook is called and drops images that failed to move", () => {
    const hookCalls = [];
    const hooked = new AppService(store, {
      onFeedbackCreated: (feedback) => {
        hookCalls.push(feedback);
        return { ok: true, moved: 1 };
      },
    });
    const result = hooked.submitFeedback(validFeedback({ images: ["a.png", "b.png"], pendingImageDir: "pending-x" }));
    assert.equal(result.ok, true);
    assert.equal(hookCalls.length, 1);
    assert.equal(result.images.length, 1);
    assert.equal(store.feedbacks()[0].images.length, 1);
  });

  test("images are discarded when no pending folder was provided", () => {
    const result = service.submitFeedback(validFeedback({ images: ["a.png"] }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.images, []);
    assert.deepEqual(store.feedbacks()[0].images, []);
  });
});
