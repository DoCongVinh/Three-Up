import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "../helpers/app-fixture.js";

/**
 * Mobile bottom sheet: the list/detail panels of #mobileSheet, the toggle
 * chevron and aria-expanded state, and the "close detail" affordance.
 */
const isExpanded = (app) => app.$("sheetToggle").getAttribute("aria-expanded") === "true";

describe("mobile sheet: list", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
  });

  test("renders the same locations as the desktop list", () => {
    const mobileIds = app.$("mobileLocationList").querySelectorAll("[data-location-id]").map((el) => el.dataset.locationId);
    const desktopIds = app.$("locationList").querySelectorAll("[data-location-id]").map((el) => el.dataset.locationId);
    assert.deepEqual(mobileIds, desktopIds);
  });

  test("caps the mobile list at 6 cards (edge case: more than 6 results)", () => {
    assert.ok(app.$("mobileLocationList").querySelectorAll("[data-location-id]").length <= 6);
  });

  test("starts collapsed, with a list visible and no detail panel", () => {
    assert.equal(isExpanded(app), false);
    assert.equal(app.$("mobileDetail").classList.contains("hidden"), true);
    assert.equal(app.$("mobileLocationList").classList.contains("hidden"), false);
    assert.equal(app.$("sheetChevron").textContent, "⌃");
  });

  test("toggle expands the sheet without any selected location", () => {
    app.click(app.$("sheetToggle"));
    assert.equal(isExpanded(app), true);
    assert.equal(app.$("sheetChevron").textContent, "⌄");
    assert.equal(app.$("mobileSheet").style.height, "auto");
  });

  test("toggle collapses again on a second tap", () => {
    app.click(app.$("sheetToggle"));
    app.click(app.$("sheetToggle"));
    assert.equal(isExpanded(app), false);
    assert.equal(app.$("sheetChevron").textContent, "⌃");
    assert.equal(app.$("mobileSheet").style.height, "");
  });
});

describe("mobile sheet: detail panel", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
  });

  test("tapping a card opens its detail instead of the list", () => {
    app.click(app.$("mobileLocationList").querySelectorAll("[data-location-id]")[0]);

    const detail = app.$("mobileDetail");
    assert.equal(detail.classList.contains("hidden"), false);
    assert.equal(app.$("mobileLocationList").classList.contains("hidden"), true);
    assert.equal(isExpanded(app), true);
    assert.equal(app.$("mobileSheet").style.height, "auto");
  });

  test("detail contains title, ward label, description and both actions", () => {
    app.click(app.document.querySelector('[data-location-id="emergency-dien-khanh"]'));
    const detail = app.$("mobileDetail");

    assert.match(detail.textContent, /Đầu mối thông tin hỗ trợ khẩn cấp/);
    assert.match(detail.textContent, /Diên Khánh/);
    assert.match(detail.textContent, /gọi số khẩn cấp phù hợp/);
    const links = detail.querySelectorAll("a");
    assert.equal(links.length, 2);
    assert.equal(links[0].getAttribute("href"), "tel:02583750000");
    assert.match(links[1].getAttribute("href"), /google\.com\/maps\/dir/);
    assert.equal(links[1].getAttribute("target"), "_blank");
  });

  test("verified and pending badges are rendered per location", () => {
    app.click(app.document.querySelector('[data-location-id="policy-nha-trang"]'));
    assert.match(app.$("mobileDetail").textContent, /Đã xác minh bởi UBND\/Đoàn thể/);

    app.click(app.$("sheetToggle"));
    app.click(app.document.querySelector('[data-location-id="support-cam-ranh"]'));
    assert.match(app.$("mobileDetail").textContent, /Chờ xác minh/);
  });

  test("the close button returns to the list and collapses the sheet", () => {
    app.click(app.document.querySelector('[data-location-id="need-cam-lam"]'));
    app.click(app.$("mobileDetail").querySelector("[data-close-detail]"));

    assert.equal(app.$("mobileDetail").classList.contains("hidden"), true);
    assert.equal(app.$("mobileLocationList").classList.contains("hidden"), false);
    assert.equal(isExpanded(app), false);
  });

  test("tapping the header while detail is open resets to the list", () => {
    app.click(app.document.querySelector('[data-location-id="need-cam-lam"]'));
    app.click(app.$("sheetToggle"));

    assert.equal(app.$("mobileDetail").classList.contains("hidden"), true);
    assert.equal(app.$("mobileLocationList").classList.contains("hidden"), false);
    // First tap clears the detail, then toggles the (expanded) sheet closed.
    assert.equal(isExpanded(app), false);
  });

  test("detail survives filter changes (documents current behaviour)", () => {
    app.click(app.document.querySelector('[data-location-id="policy-nha-trang"]'));
    app.select(app.$("wardSelect"), "cam_linh");
    assert.match(app.$("mobileDetail").textContent, /Tư vấn chính sách an sinh cộng đồng/);
  });

  test("clicking an unknown card id is ignored (negative)", () => {
    const ghost = app.$("locationList").querySelector("[data-location-id]");
    ghost.setAttribute("data-location-id", "does-not-exist");
    app.click(ghost);
    assert.equal(app.$("mobileDetail").classList.contains("hidden"), true);
    assert.equal(app.map.flyToCalls.length, 0);
  });
});
