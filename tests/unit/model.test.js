import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_RULES,
  CATEGORIES,
  FEEDBACK_STATUS,
  REGIONS,
  WARDS,
  buildFeedback,
  buildStatistics,
  canReview,
  createId,
  distanceKm,
  filterFeedbacksForUser,
  getWard,
  isValidEmail,
  isValidPhone,
  nearestWard,
  normalizePhone,
  sanitizeText,
  setFeedbackStatus,
  toPublicUser,
  validateAccountInput,
  validateFeedback,
  validateNewAccount,
  wardLabel,
} from "../../src/data-model.js";

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

const officer = (overrides = {}) => ({
  id: "u1",
  username: "camlinh.cb",
  displayName: "Cán bộ Cam Linh",
  role: "ward",
  scope: "cr_cam_linh",
  active: true,
  ...overrides,
});

describe("data-model: administrative directory", () => {
  test("exposes the four localities with the new ward names", () => {
    assert.deepEqual(REGIONS.map((region) => region.id), ["nha_trang", "cam_ranh", "cam_lam", "dien_khanh"]);
    assert.ok(REGIONS.every((region) => region.wards.length >= 4));
    assert.ok(REGIONS.every((region) => region.center?.lat && region.center?.zoom));
  });

  test("Cam Ranh contains Cam Linh (the example in the brief)", () => {
    const camRanh = REGIONS.find((region) => region.id === "cam_ranh");
    assert.ok(camRanh.wards.some((ward) => ward.id === "cr_cam_linh" && ward.name === "Phường Cam Linh"));
  });

  test("flattens wards with their parent region", () => {
    const ward = WARDS.find((item) => item.id === "nt_loc_tho");
    assert.equal(ward.regionId, "nha_trang");
    assert.equal(ward.regionName, "TP. Nha Trang");
    assert.match(ward.label, /Lộc Thọ · Nha Trang/);
  });

  test("ward ids are unique across the province", () => {
    const ids = WARDS.map((ward) => ward.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("wardLabel falls back for unknown ids", () => {
    assert.equal(wardLabel("nt_loc_tho"), "Phường Lộc Thọ");
    assert.equal(wardLabel("khong_ton_tai"), "Chưa xác định");
    assert.equal(getWard("khong_ton_tai"), null);
  });

  test("every category has label, icon and colour", () => {
    for (const category of Object.values(CATEGORIES)) {
      assert.ok(category.label && category.icon && /^#[0-9a-f]{6}$/i.test(category.color));
    }
  });
});

describe("data-model: phone & email", () => {
  test("accepts Vietnamese mobile and landline formats", () => {
    for (const phone of ["0905123456", "02583820000", "+84905123456", "0905 123 456", "0258.382.000"]) {
      assert.equal(isValidPhone(phone), true, phone);
    }
  });

  test("rejects malformed phone numbers", () => {
    for (const phone of ["", "12345", "abc0905123456", "0905-123", "0084905123456x"]) {
      assert.equal(isValidPhone(phone), false, phone);
    }
  });

  test("normalizePhone strips separators", () => {
    assert.equal(normalizePhone(" 0905 123.456 "), "0905123456");
  });

  test("validates email shape", () => {
    assert.equal(isValidEmail("an.nguyen@example.com"), true);
    assert.equal(isValidEmail("AN@EXAMPLE.VN"), true);
    assert.equal(isValidEmail("an@example"), false);
    assert.equal(isValidEmail("an example@x.com"), false);
    assert.equal(isValidEmail(""), false);
  });
});

describe("data-model: sanitizeText", () => {
  test("trims, collapses spaces and strips control chars", () => {
    assert.equal(sanitizeText("  Nguyễn \n\t Văn   An \u0007"), "Nguyễn Văn An");
  });

  test("truncates to the max length", () => {
    assert.equal(sanitizeText("abcdefghij", 4), "abcd");
  });

  test("handles null/undefined", () => {
    assert.equal(sanitizeText(null), "");
    assert.equal(sanitizeText(undefined), "");
  });
});

describe("data-model: validateFeedback (positive)", () => {
  test("accepts a complete payload and normalises it", () => {
    const result = validateFeedback(validFeedback({ fullName: "  Nguyễn  Văn An ", phone: " 0905 123 456 " }));
    assert.equal(result.ok, true, result.errors.join("; "));
    assert.equal(result.value.fullName, "Nguyễn Văn An");
    assert.equal(result.value.phone, "0905123456");
    assert.equal(result.value.email, "an.nguyen@example.com");
    assert.equal(result.value.lat, 12.2451);
  });

  test("accepts GPS coordinates at the poles and antimeridian (edge)", () => {
    for (const [lat, lng] of [[90, 180], [-90, -180], [0.0001, 0.0001]]) {
      assert.equal(validateFeedback(validFeedback({ lat, lng })).ok, true, `${lat},${lng}`);
    }
  });
});

describe("data-model: validateFeedback (negative & edges)", () => {
  test("collects every missing required field", () => {
    const result = validateFeedback({});
    assert.equal(result.ok, false);
    const joined = result.errors.join(" | ");
    assert.match(joined, /họ tên/i);
    assert.match(joined, /Số điện thoại/);
    assert.match(joined, /Email/);
    assert.match(joined, /địa chỉ chi tiết/i);
    assert.match(joined, /Lý do/);
    assert.match(joined, /Phường\/Xã/);
    assert.match(joined, /vị trí GPS/i);
  });

  test("rejects a too-short reason (under 20 chars)", () => {
    const result = validateFeedback(validFeedback({ reason: "Ngắn quá" }));
    assert.equal(result.ok, false);
    assert.match(result.errors.join(), /20 ký tự/);
  });

  test("rejects unknown category or ward", () => {
    const result = validateFeedback(validFeedback({ category: "hack", wardId: "atlantis" }));
    assert.equal(result.ok, false);
    assert.match(result.errors.join(), /Nhóm thông tin/);
    assert.match(result.errors.join(), /Phường\/Xã/);
  });

  test("rejects missing, NaN, zero and out-of-range coordinates", () => {
    for (const [lat, lng] of [[undefined, undefined], [NaN, 109], [0, 0], [91, 109], [12, 181], ["abc", 109]]) {
      const result = validateFeedback(validFeedback({ lat, lng }));
      assert.equal(result.ok, false, `${lat},${lng}`);
      assert.match(result.errors.join(), /GPS/);
    }
  });

  test("accepts well-formed image file names only", () => {
    assert.equal(validateFeedback(validFeedback({ images: ["img-a1b2.png", "photo.JPEG"] })).ok, true);

    const exe = validateFeedback(validFeedback({ images: ["virus.exe"] }));
    assert.equal(exe.ok, false);

    // Đường dẫn bị cắt về tên tệp (không thể thoát thư mục), đuôi vẫn phải là ảnh.
    const traversal = validateFeedback(validFeedback({ images: ["../../secret.png"] }));
    assert.equal(traversal.ok, true);
    assert.deepEqual(traversal.value.images, ["secret.png"]);

    const traversalExe = validateFeedback(validFeedback({ images: ["../../secret.exe"] }));
    assert.equal(traversalExe.ok, false);
  });

  test("caps attachments at 5", () => {
    const images = Array.from({ length: 6 }, (_, index) => `img-${index}.png`);
    const result = validateFeedback(validFeedback({ images }));
    assert.equal(result.ok, false);
    assert.match(result.errors.join(), /tối đa 5/);
  });

  test("long text is truncated instead of rejected", () => {
    const result = validateFeedback(validFeedback({ address: "a".repeat(500) }));
    assert.equal(result.ok, true);
    assert.equal(result.value.address.length, 180);
  });
});

describe("data-model: buildFeedback", () => {
  test("creates a pending record with history and routing data", () => {
    const { ok, feedback } = buildFeedback(validFeedback(), { id: "fb-1", now: "2026-01-01T00:00:00.000Z" });
    assert.equal(ok, true);
    assert.equal(feedback.id, "fb-1");
    assert.equal(feedback.status, FEEDBACK_STATUS.PENDING);
    assert.equal(feedback.createdAt, feedback.updatedAt);
    assert.equal(feedback.regionId, "nha_trang");
    assert.equal(feedback.history.at(0).action, "submitted");
  });

  test("returns errors and no record when invalid", () => {
    const result = buildFeedback({});
    assert.equal(result.ok, false);
    assert.equal(result.feedback, undefined);
    assert.ok(result.errors.length > 0);
  });

  test("createId is unique and prefixed", () => {
    const ids = new Set(Array.from({ length: 500 }, () => createId("fb")));
    assert.equal(ids.size, 500);
    for (const id of ids) assert.match(id, /^fb-/);
  });
});

describe("data-model: ward officer review", () => {
  const pending = () => buildFeedback(validFeedback({ wardId: "cr_cam_linh" }), { id: "fb-x" }).feedback;

  test("only the officer of that ward can review", () => {
    const feedback = pending();
    assert.equal(canReview(officer(), feedback), true);
    assert.equal(canReview(officer({ scope: "cr_ba_ngoi" }), feedback), false);
    assert.equal(canReview(officer({ role: "admin", scope: null }), feedback), false);
    assert.equal(canReview(officer({ active: false }), feedback), false);
    assert.equal(canReview(null, feedback), false);
  });

  test("approves a pending feedback and records the reviewer", () => {
    const result = setFeedbackStatus(pending(), "approved", officer(), { now: "2026-01-02T00:00:00.000Z" });
    assert.equal(result.ok, true);
    assert.equal(result.feedback.status, "approved");
    assert.equal(result.feedback.reviewedBy, "u1");
    assert.equal(result.feedback.history.at(-1).action, "approved");
  });

  test("rejection requires a meaningful note", () => {
    const missing = setFeedbackStatus(pending(), "rejected", officer(), { note: "" });
    assert.equal(missing.ok, false);
    assert.match(missing.errors.join(), /lý do từ chối/i);

    const ok = setFeedbackStatus(pending(), "rejected", officer(), { note: "Không tìm thấy địa điểm." });
    assert.equal(ok.ok, true);
    assert.equal(ok.feedback.reviewNote, "Không tìm thấy địa điểm.");
  });

  test("rejects invalid statuses and cross-ward reviews (negative)", () => {
    assert.equal(setFeedbackStatus(pending(), "pending", officer()).ok, false);
    assert.equal(setFeedbackStatus(pending(), "deleted", officer()).ok, false);
    const foreign = setFeedbackStatus(pending(), "approved", officer({ scope: "nt_loc_tho" }));
    assert.equal(foreign.ok, false);
    assert.match(foreign.errors.join(), /phường\/xã khác/);
  });

  test("admin never sees review permission on items", () => {
    const feedback = pending();
    assert.equal(canReview({ id: "a", role: "admin", active: true }, feedback), false);
  });
});

describe("data-model: visibility & statistics", () => {
  const feedbacks = [
    { id: "1", wardId: "cr_cam_linh", status: "pending" },
    { id: "2", wardId: "cr_cam_linh", status: "approved" },
    { id: "3", wardId: "nt_loc_tho", status: "pending" },
  ];

  test("officers only see their own ward", () => {
    assert.deepEqual(filterFeedbacksForUser(feedbacks, officer()).map((item) => item.id), ["1", "2"]);
  });

  test("admin sees everything, guests see nothing", () => {
    assert.equal(filterFeedbacksForUser(feedbacks, { role: "admin" }).length, 3);
    assert.deepEqual(filterFeedbacksForUser(feedbacks, null), []);
    assert.deepEqual(filterFeedbacksForUser(feedbacks, { role: "citizen" }), []);
    assert.deepEqual(filterFeedbacksForUser("not-an-array", { role: "admin" }), []);
  });

  test("statistics roll up accounts and feedback per ward/region", () => {
    const stats = buildStatistics({
      accounts: [{ scope: "cr_cam_linh" }, { scope: "cr_cam_linh" }, { scope: "nt_loc_tho" }],
      feedbacks,
    });
    const camRanh = stats.find((region) => region.id === "cam_ranh");
    const camLinh = camRanh.wards.find((ward) => ward.id === "cr_cam_linh");
    assert.equal(camLinh.accountCount, 2);
    assert.equal(camLinh.pendingCount, 1);
    assert.equal(camLinh.approvedCount, 1);
    assert.equal(camRanh.totalCount, 2);
    assert.equal(stats.find((region) => region.id === "dien_khanh").totalCount, 0);
  });

  test("toPublicUser never leaks the password hash", () => {
    const publicUser = toPublicUser({ ...officer(), passwordHash: "scrypt$secret$hash" });
    assert.equal("passwordHash" in publicUser, false);
    assert.equal(publicUser.scopeName, "Phường Cam Linh");
    assert.equal(publicUser.regionName, "TP. Cam Ranh");
    assert.equal(toPublicUser(null), null);
  });

  test("distanceKm is symmetric and ~0 for identical points", () => {
    const a = { lat: 12.2451, lng: 109.1943 };
    const b = { lat: 11.9214, lng: 109.1599 };
    assert.equal(distanceKm(a, a), 0);
    assert.equal(distanceKm(a, b), distanceKm(b, a));
    assert.ok(distanceKm(a, b) > 30 && distanceKm(a, b) < 40, "Nha Trang–Cam Linh ~36km");
    assert.ok(Number.isNaN(distanceKm(a, null)));
  });

  test("nearestWard returns a valid ward id", () => {
    const ward = nearestWard({ lat: 11.92, lng: 109.16 });
    assert.equal(getWard(ward)?.regionId, "cam_ranh");
    assert.equal(nearestWard(null), null);
  });
});

describe("data-model: account validation", () => {
  test("accepts a valid ward account", () => {
    const result = validateAccountInput({
      username: "CamLinh.CB",
      displayName: "  Nguyễn  Thị Lan ",
      password: "Canbo@123",
      scope: "cr_cam_linh",
    });
    assert.equal(result.ok, true, result.errors.join("; "));
    assert.equal(result.value.username, "camlinh.cb");
    assert.equal(result.value.displayName, "Nguyễn Thị Lan");
  });

  test("rejects short usernames, bad characters and short passwords", () => {
    const short = validateAccountInput({ username: "ab", displayName: "Lan", password: "Canbo@123", scope: "cr_cam_linh" });
    assert.equal(short.ok, false);
    const chars = validateAccountInput({ username: "lan@caml!nh", displayName: "Lan", password: "Canbo@123", scope: "cr_cam_linh" });
    assert.equal(chars.ok, false);
    const pass = validateAccountInput({ username: "lan.cb", displayName: "Lan", password: "1234567", scope: "cr_cam_linh" });
    assert.equal(pass.ok, false);
    assert.match(pass.errors.join(), new RegExp(String(ACCOUNT_RULES.passwordMin)));
  });

  test("requires a real ward and a real name", () => {
    const noScope = validateAccountInput({ username: "lan.cb", displayName: "Lan", password: "Canbo@123" });
    assert.equal(noScope.ok, false);
    const noName = validateAccountInput({ username: "lan.cb", displayName: "L", password: "Canbo@123", scope: "cr_cam_linh" });
    assert.equal(noName.ok, false);
  });

  test("detects duplicate usernames (case-insensitive)", () => {
    const existing = [{ id: "u1", username: "camlinh.cb", displayName: "Lan", scope: "cr_cam_linh" }];
    const result = validateNewAccount(
      { username: "CamLinh.cb", displayName: "Người khác", password: "Canbo@123", scope: "cr_ba_ngoi" },
      existing,
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join(), /đã tồn tại/);
  });

  test("detects the same officer name for the same ward", () => {
    const existing = [{ id: "u1", username: "lan.cb", displayName: "Nguyễn Thị Lan", scope: "cr_cam_linh" }];
    const result = validateNewAccount(
      { username: "lan2.cb", displayName: "Nguyễn Thị Lan", password: "Canbo@123", scope: "cr_cam_linh" },
      existing,
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join(), /cùng họ tên/);
  });
});
