import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadApp, createStorage, STORAGE_KEY } from "../helpers/app-fixture.js";
import { DOMException } from "../helpers/html-dom.js";

/**
 * "Gửi gợi ý điểm hỗ trợ" form: required-field validation, the persisted
 * payload shape, storage failure handling and post-save reset.
 */
const isHidden = (app) => app.$("formMessage").classList.contains("hidden");

const ISO_2024 = `
  const Fixed = class extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super("2024-03-01T08:30:00.000Z");
    }
  };
  globalThis.Date = Fixed;
`;

function validSuggestion(overrides = {}) {
  return {
    title: "Điểm phát cơm miễn phí",
    category: "ho_tro",
    ward: "nha_trang",
    address: "12 Trần Phú, Nha Trang",
    phone: "02583820000",
    description: "Phát cơm trưa cho người lao động khó khăn.",
    ...overrides,
  };
}

describe("form: happy path", () => {
  let app;
  beforeEach(() => {
    app = loadApp({ prelude: ISO_2024 });
    app.fillForm(validSuggestion());
  });

  test("saves one suggestion to localStorage under the documented key", () => {
    app.submitForm();

    const saved = app.savedSuggestions();
    assert.ok(Array.isArray(saved));
    assert.equal(saved.length, 1);
  });

  test("persists every field plus status and createdAt", () => {
    app.map.fire("click", { latlng: { lat: 12.2388123, lng: 109.1967123 } });
    app.fillForm(validSuggestion());
    app.submitForm();

    const [suggestion] = app.savedSuggestions();
    assert.equal(suggestion.title, "Điểm phát cơm miễn phí");
    assert.equal(suggestion.category, "ho_tro");
    assert.equal(suggestion.ward, "nha_trang");
    assert.equal(suggestion.address, "12 Trần Phú, Nha Trang");
    assert.equal(suggestion.phone, "02583820000");
    assert.equal(suggestion.description, "Phát cơm trưa cho người lao động khó khăn.");
    assert.equal(suggestion.latitude, "12.238812");
    assert.equal(suggestion.longitude, "109.196712");
    assert.equal(suggestion.status, "pending_verification");
    assert.equal(suggestion.createdAt, "2024-03-01T08:30:00.000Z");
  });

  test("shows a success message in the live region", () => {
    app.submitForm();

    const message = app.$("formMessage");
    assert.equal(isHidden(app), false);
    assert.match(message.textContent, /Đã lưu gợi ý/);
    assert.match(message.textContent, /chờ xác minh/);
    assert.match(message.className, /bg-emerald-50/);
    assert.doesNotMatch(message.className, /bg-red-50/);
  });

  test("resets the form and the picked coordinates after saving", () => {
    app.map.fire("click", { latlng: { lat: 12.05, lng: 109.15 } });
    app.fillForm(validSuggestion());
    app.submitForm();

    assert.equal(app.$("suggestForm").elements.title.value, "");
    assert.equal(app.$("suggestForm").elements.description.value, "");
    assert.equal(app.$("selectedLat").value, "");
    assert.equal(app.$("selectedLng").value, "");
  });

  test("removes the temporary marker after saving", () => {
    app.map.fire("click", { latlng: { lat: 12.05, lng: 109.15 } });
    const temp = app.registry.markers.at(-1);
    app.fillForm(validSuggestion());
    app.submitForm();

    assert.equal(app.map.removedLayers.includes(temp), true);
  });

  test("saving does not change the modal visibility by itself", () => {    // The message lives inside the dialog, so the dialog must be on screen
    // (already the case after openModal/map click) when the save succeeds.
    app.click(app.$("openSuggestion"));
    app.submitForm();
    assert.equal(app.$("suggestModal").classList.contains("hidden"), false);
    assert.equal(isHidden(app), false);
  });

  test("previous success message is hidden when the modal is reopened", () => {
    app.submitForm();
    assert.equal(isHidden(app), false);
    app.click(app.$("openSuggestion"));
    assert.equal(isHidden(app), true);
  });
});

describe("form: appending to existing history", () => {
  test("appends to previously stored suggestions without mutating them", () => {
    const storage = createStorage();
    storage.seed(STORAGE_KEY, JSON.stringify([{ title: "Cũ", status: "pending_verification" }]));
    const app = loadApp({ storage });
    app.fillForm(validSuggestion({ title: "Mới" }));
    app.submitForm();

    const saved = app.savedSuggestions();
    assert.equal(saved.length, 2);
    assert.equal(saved[0].title, "Cũ");
    assert.equal(saved[1].title, "Mới");
  });

  test("empty-string storage initialises a new list", () => {
    const storage = createStorage();
    storage.seed(STORAGE_KEY, "");
    const app = loadApp({ storage });
    app.fillForm();
    app.submitForm();

    assert.equal(app.savedSuggestions().length, 1);
  });

  test("two saves in a row produce two independent entries", () => {
    const app = loadApp({ prelude: ISO_2024 });
    app.fillForm(validSuggestion({ title: "Lần 1" }));
    app.submitForm();
    app.fillForm(validSuggestion({ title: "Lần 2" }));
    app.submitForm();

    assert.deepEqual(app.savedSuggestions().map((item) => item.title), ["Lần 1", "Lần 2"]);
  });
});

describe("form: validation (negative)", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
  });

  test("blocks saving when required fields are empty", () => {
    app.submitForm();
    assert.equal(app.savedSuggestions(), null);
    assert.equal(isHidden(app), true);
  });

  test("blocks saving when only the description is missing", () => {
    app.fillForm(validSuggestion({ description: "" }));
    app.submitForm();
    assert.equal(app.storage.getItem(STORAGE_KEY), null);
  });

  test("blocks a whitespace-only title (edge case)", () => {
    app.fillForm(validSuggestion({ title: "   " }));
    app.submitForm();
    assert.equal(app.storage.getItem(STORAGE_KEY), null);
  });

  test("never writes a partial payload", () => {
    app.fillForm(validSuggestion({ address: "" }));
    app.submitForm();
    assert.equal(app.storage.size, 0);
  });

  test("submit event is cancelled so the page never reloads", () => {
    app.fillForm();
    const event = app.submitForm();
    assert.equal(event.defaultPrevented, true);
  });

  test("readonly coordinates are never required", () => {
    app.fillForm();
    assert.equal(app.$("selectedLat").getAttribute("readonly") !== null, true);
    app.submitForm();
    assert.equal(app.savedSuggestions().length, 1);
  });
});

describe("form: storage failures", () => {
  test("corrupted JSON surfaces a readable red error and keeps the data intact", () => {
    const storage = createStorage();
    storage.seed(STORAGE_KEY, "{not-json");
    const app = loadApp({ storage });
    app.fillForm();
    app.submitForm();

    const message = app.$("formMessage");
    assert.equal(isHidden(app), false);
    assert.match(message.textContent, /Không thể lưu gợi ý trên thiết bị/);
    assert.match(message.className, /bg-red-50/);
    assert.equal(storage.getItem(STORAGE_KEY), "{not-json");
    assert.equal(app.$("suggestForm").elements.title.value, "Điểm phát cơm miễn phí", "form must stay filled");
  });

  test("a JSON object instead of an array is rejected", () => {
    const storage = createStorage();
    storage.seed(STORAGE_KEY, JSON.stringify({ title: "not-a-list" }));
    const app = loadApp({ storage });
    app.fillForm();
    app.submitForm();

    assert.match(app.$("formMessage").textContent, /Dữ liệu gợi ý đã lưu không hợp lệ/);
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).title, "not-a-list");
  });

  test("QuotaExceededError gets a dedicated, actionable message", () => {
    const quota = Object.assign(new DOMException("quota", "QuotaExceededError"));
    const app = loadApp({ storage: createStorage({ failOnSet: quota }) });
    app.fillForm();
    app.submitForm();

    const message = app.$("formMessage");
    assert.match(message.textContent, /bộ nhớ trình duyệt đã đầy/);
    assert.match(message.className, /bg-red-50/);
  });

  test("other storage errors echo the original message", () => {
    const app = loadApp({ storage: createStorage({ failOnSet: new Error("Thiết bị chỉ đọc") }) });
    app.fillForm();
    app.submitForm();
    assert.match(app.$("formMessage").textContent, /Thiết bị chỉ đọc/);
  });

  test("a failing save does not reset the form", () => {
    const app = loadApp({ storage: createStorage({ failOnSet: new Error("boom") }) });
    app.fillForm();
    app.submitForm();

    assert.equal(app.$("suggestForm").elements.title.value, "Điểm phát cơm miễn phí");
    assert.equal(app.$("suggestForm").elements.phone.value, "02583820000");
  });

  test("retry succeeds once storage recovers", () => {
    let failing = true;
    const storage = createStorage();
    const original = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (failing) throw new Error("temporary");
      original(key, value);
    };

    const app = loadApp({ storage });
    app.fillForm();
    app.submitForm();
    assert.match(app.$("formMessage").textContent, /Không thể lưu gợi ý trên thiết bị: temporary/);

    failing = false;
    app.submitForm();
    assert.equal(app.savedSuggestions().length, 1);
    assert.match(app.$("formMessage").textContent, /Đã lưu gợi ý/);
  });
});

describe("form: markup contract", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
  });

  test("required fields match the documented rules", () => {
    const form = app.$("suggestForm");
    for (const name of ["title", "address", "phone", "description"]) {
      assert.equal(form.elements[name].hasAttribute("required"), true, `${name} must be required`);
    }
    assert.equal(form.elements.title.getAttribute("maxlength"), "100");
    assert.equal(form.elements.address.getAttribute("maxlength"), "180");
    assert.equal(form.elements.phone.getAttribute("maxlength"), "20");
    assert.equal(form.elements.description.getAttribute("maxlength"), "700");
    assert.equal(form.elements.phone.getAttribute("pattern"), "[0-9+() .-]{8,20}");
  });

  test("offers exactly the four supported categories", () => {
    const values = app.$("suggestForm").elements.category.options.map((option) => option.getAttribute("value"));
    assert.deepEqual(values, ["ho_tro", "chinh_sach", "nhu_cau", "khan_cap"]);
  });

  test("offers the five supported wards and defaults to the first one", () => {
    const wardOptions = app.$("suggestForm").elements.ward.options;
    assert.deepEqual(
      wardOptions.map((option) => option.getAttribute("value")),
      ["nha_trang", "cam_ranh", "cam_linh", "cam_lam", "dien_khanh"],
    );
    assert.equal(app.$("suggestForm").elements.ward.value, "nha_trang");
  });

  test("contains a privacy warning about not sending data", () => {
    const text = app.$("suggestForm").textContent;
    assert.match(text, /chưa gửi dữ liệu tới UBND/);
    assert.match(text, /Không nhập thông tin cá nhân nhạy cảm/);
  });
});
