import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadApp, flushTimers, PROVINCE_CENTER } from "../helpers/app-fixture.js";

/** Cards currently rendered in the desktop list (mobile mirrors them). */
const desktopIds = (app) =>
  app.$("locationList").querySelectorAll("[data-location-id]").map((el) => el.dataset.locationId);

/**
 * Rendering: initial state, filter isolation in DOM, result counters and
 * empty states. Leaflet rendering itself is verified in map.test.js.
 */
describe("render: initial UI state", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
  });

  test("creates exactly one Leaflet map bound to #map", () => {
    assert.equal(app.registry.maps.length, 1);
    assert.equal(app.map.elementId, "map");
  });

  test("centres the map on Khánh Hòa at province zoom", () => {
    assert.deepEqual([...app.map.center], [PROVINCE_CENTER.lat, PROVINCE_CENTER.lng]);
    assert.equal(app.map.zoom, PROVINCE_CENTER.zoom);
  });

  test("shows all 5 demo locations on first paint", () => {
    assert.equal(app.$("resultCount").textContent, "5 địa điểm");
    assert.deepEqual(desktopIds(app), [
      "support-cam-linh",
      "policy-nha-trang",
      "need-cam-lam",
      "emergency-dien-khanh",
      "support-cam-ranh",
    ]);
  });

  test("mobile counter includes the call-to-action suffix", () => {
    assert.equal(app.$("mobileResultCount").textContent, "5 địa điểm · chạm để xem");
  });

  test("article card renders title and address as text, not markup", () => {
    const card = app.document.querySelector('[data-location-id="support-cam-linh"]');
    assert.ok(card);
    assert.match(card.textContent, /Điểm tiếp nhận nhu yếu phẩm Cam Linh/);
    assert.match(card.textContent, /Khu vực trung tâm phường Cam Linh/);
  });

  test("'Tất cả' category button is the only initially active filter", () => {
    const buttons = app.document.querySelectorAll(".category-button");
    const active = buttons.filter((button) => button.classList.contains("active"));
    assert.equal(active.length, 1);
    assert.equal(active[0].dataset.category, "all");
    assert.ok(active[0].classList.contains("bg-teal-700"));
  });

  test("ward select defaults to the whole province", () => {
    assert.equal(app.$("wardSelect").value, "all");
  });

  test("suggestion modal is closed and sheet is collapsed at boot", () => {
    assert.ok(app.$("suggestModal").classList.contains("hidden"));
    assert.ok(!app.$("suggestModal").classList.contains("flex"));
    assert.equal(app.$("sheetToggle").getAttribute("aria-expanded"), "false");
  });

  test("pending app timers only invalidate the map size", async () => {
    await flushTimers(app);
    assert.ok(app.map.invalidateSizeCalls >= 1);
    assert.equal(app.timers.length, 0);
  });
});

describe("render: category filtering", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
  });

  test("clicking a category keeps only that category's locations", () => {
    app.click(app.document.querySelector('[data-category="ho_tro"]'));

    const ids = desktopIds(app);
    assert.deepEqual(ids, ["support-cam-linh", "support-cam-ranh"]);
    assert.equal(app.$("resultCount").textContent, "2 địa điểm");
  });

  test("active styling moves from the old button to the new one", () => {
    const all = app.document.querySelector('[data-category="all"]');
    const emergency = app.document.querySelector('[data-category="khan_cap"]');
    app.click(emergency);

    assert.equal(all.classList.contains("active"), false);
    assert.equal(all.classList.contains("border-slate-200"), true);
    assert.equal(all.classList.contains("bg-white"), true);
    assert.equal(emergency.classList.contains("active"), true);
    assert.equal(emergency.classList.contains("border-teal-700"), true);
    assert.equal(emergency.classList.contains("text-white"), true);
  });

  test("click on the filter container padding is a no-op", () => {
    const group = app.$("categoryFilters");
    app.click(group);
    assert.equal(app.$("resultCount").textContent, "5 địa điểm");
  });

  test("returning to 'Tất cả' restores every location", () => {
    app.click(app.document.querySelector('[data-category="nhu_cau"]'));
    assert.equal(app.$("resultCount").textContent, "1 địa điểm");
    app.click(app.document.querySelector('[data-category="all"]'));
    assert.equal(app.$("resultCount").textContent, "5 địa điểm");
  });
});

describe("render: ward filtering", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
  });

  test("selecting Nha Trang shows only Nha Trang locations", () => {
    app.select(app.$("wardSelect"), "nha_trang");
    assert.deepEqual(desktopIds(app), ["policy-nha-trang"]);
  });

  test("Cam Ranh also includes Cam Linh locations (edge case)", () => {
    app.select(app.$("wardSelect"), "cam_ranh");
    assert.deepEqual(desktopIds(app), ["support-cam-linh", "support-cam-ranh"]);
  });

  test("Cam Linh filter is exact, not a subset of Cam Ranh", () => {
    app.select(app.$("wardSelect"), "cam_linh");
    assert.deepEqual(desktopIds(app), ["support-cam-linh"]);
  });

  test("unknown ward value yields the empty state (negative)", () => {
    app.select(app.$("wardSelect"), "phu_quoc");
    assert.equal(app.$("resultCount").textContent, "0 địa điểm");
    assert.match(app.$("locationList").textContent, /Không tìm thấy địa điểm phù hợp/);
  });

  test("empty state also rendered in the mobile list", () => {
    app.select(app.$("wardSelect"), "phu_quoc");
    assert.match(app.$("mobileLocationList").textContent, /Không có địa điểm phù hợp/);
    assert.equal(app.$("mobileResultCount").textContent, "0 địa điểm · chạm để xem");
  });
});

describe("render: search", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
  });

  test("matches titles case-insensitively", () => {
    app.type(app.$("searchInput"), "BẾP ĂN");
    assert.equal(app.$("resultCount").textContent, "1 địa điểm");
    assert.ok(app.document.querySelector('[data-location-id="support-cam-ranh"]'));
  });

  test("matches Vietnamese text with diacritics as typed", () => {
    app.type(app.$("searchInput"), "bữa ăn");
    assert.equal(app.$("resultCount").textContent, "1 địa điểm");
  });

  test("matches the address as well as the title", () => {
    app.type(app.$("searchInput"), "Diên Khánh");
    assert.equal(app.$("resultCount").textContent, "1 địa điểm");
  });

  test("is diacritic-sensitive (negative edge case)", () => {
    app.type(app.$("searchInput"), "bep an");
    assert.equal(app.$("resultCount").textContent, "0 địa điểm");
  });

  test("trims surrounding whitespace", () => {
    app.type(app.$("searchInput"), "   Nha Trang   ");
    assert.equal(app.$("resultCount").textContent, "1 địa điểm");
  });

  test("whitespace-only query behaves like an empty query", () => {
    app.type(app.$("searchInput"), "     ");
    assert.equal(app.$("resultCount").textContent, "5 địa điểm");
  });

  test("no match shows empty state", () => {
    app.type(app.$("searchInput"), "Không tồn tại 12345");
    assert.equal(app.$("resultCount").textContent, "0 địa điểm");
  });

  test("search and filters combine with AND semantics", () => {
    app.select(app.$("wardSelect"), "cam_ranh");
    app.click(app.document.querySelector('[data-category="ho_tro"]'));
    app.type(app.$("searchInput"), "bếp");
    assert.equal(app.$("resultCount").textContent, "1 địa điểm");

    app.type(app.$("searchInput"), "nhu yếu phẩm");
    assert.deepEqual(desktopIds(app), ["support-cam-linh"]);
  });
});

describe("render: localisation details", () => {
  test("result counters are pluralised with Vietnamese unit", () => {
    const app = loadApp();
    app.select(app.$("wardSelect"), "nhu_cau-not-a-ward");
    assert.equal(app.$("resultCount").textContent, "0 địa điểm");
    assert.equal(app.$("mobileResultCount").textContent, "0 địa điểm · chạm để xem");
  });

  test("category chips keep their data-category contract used by handlers", () => {
    const app = loadApp();
    const values = app.document.querySelectorAll("[data-category]").map((el) => el.dataset.category);
    assert.deepEqual(values, ["all", "ho_tro", "chinh_sach", "nhu_cau", "khan_cap"]);
  });
});
