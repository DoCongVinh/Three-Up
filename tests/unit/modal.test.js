import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadApp, flushTimers } from "../helpers/app-fixture.js";

/**
 * Modal lifecycle: open from the header button, open by picking a point on
 * the map (lat/lng autofill + temporary marker), and every documented close
 * path (×, Hủy, backdrop, Escape).
 */
const isOpen = (app) => !app.$("suggestModal").classList.contains("hidden");

describe("modal: opening", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
  });

  test("the header button opens the dialog", () => {
    app.click(app.$("openSuggestion"));
    assert.equal(isOpen(app), true);
    assert.equal(app.$("suggestModal").classList.contains("flex"), true);
  });

  test("opening clears any previous form message", () => {
    const message = app.$("formMessage");
    message.textContent = "old feedback";
    message.classList.remove("hidden");

    app.click(app.$("openSuggestion"));
    assert.equal(message.classList.contains("hidden"), true);
    // The app only hides the previous message; it clears old text on submit.
    assert.equal(message.textContent, "old feedback");
  });

  test("focus is deferred (setTimeout) instead of blocking the paint", async () => {
    app.click(app.$("openSuggestion"));
    assert.ok(app.timers.length >= 1);
    await flushTimers(app);
    assert.equal(app.timers.length, 0);
  });

  test("opening twice is idempotent", () => {
    app.click(app.$("openSuggestion"));
    app.click(app.$("openSuggestion"));
    assert.equal(isOpen(app), true);
    assert.equal(app.$("suggestModal").classList.contains("flex"), true);
  });
});

describe("modal: map click pre-fills coordinates", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
  });

  test("fills latitude/longitude with 6 decimals and opens the modal", () => {
    app.map.fire("click", { latlng: { lat: 12.238812345, lng: 109.196712345 } });

    assert.equal(app.$("selectedLat").value, "12.238812");
    assert.equal(app.$("selectedLng").value, "109.196712");
    assert.equal(isOpen(app), true);
  });

  test("handles negative coordinates (edge case)", () => {
    app.map.fire("click", { latlng: { lat: -12.5, lng: -109.25 } });
    assert.equal(app.$("selectedLat").value, "-12.500000");
    assert.equal(app.$("selectedLng").value, "-109.250000");
  });

  test("rounds half-values deterministically", () => {
    app.map.fire("click", { latlng: { lat: 10.0000005, lng: 106.0000004 } });
    assert.equal(app.$("selectedLat").value, (10.0000005).toFixed(6));
    assert.equal(app.$("selectedLng").value, "106.000000");
  });

  test("creates a temporary marker labelled for the suggestion", () => {
    app.map.fire("click", { latlng: { lat: 12.05, lng: 109.15 } });

    const temp = app.registry.markers.at(-1);
    assert.equal(temp.popupContent, "Vị trí đã chọn cho gợi ý");
    assert.equal(temp.isPopupOpen, true);
    assert.equal(temp.options.icon, undefined);
  });

  test("a second map click replaces the previous temporary marker", () => {
    app.map.fire("click", { latlng: { lat: 12.05, lng: 109.15 } });
    const first = app.registry.markers.at(-1);
    app.map.fire("click", { latlng: { lat: 12.1, lng: 109.2 } });
    const second = app.registry.markers.at(-1);

    assert.notEqual(first, second);
    // Leaflet removes detached layers from the `_layers` set first, so the
    // fake map records removal too (see FakeMap.removeLayer).
    assert.equal(app.map.removedLayers.includes(first), true);
    assert.equal(app.map._layers.has(second), true);
    assert.equal(app.$("selectedLat").value, "12.100000");
  });
});

describe("modal: closing", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
    app.click(app.$("openSuggestion"));
  });

  test("× button closes", () => {
    app.click(app.$("closeModal"));
    assert.equal(isOpen(app), false);
    assert.equal(app.$("suggestModal").classList.contains("flex"), false);
  });

  test("Hủy button closes", () => {
    app.click(app.$("cancelModal"));
    assert.equal(isOpen(app), false);
  });

  test("clicking the backdrop closes", () => {
    app.click(app.$("suggestModal"));
    assert.equal(isOpen(app), false);
  });

  test("clicking inside the dialog does not close it (negative)", () => {
    app.click(app.$("suggestForm"));
    assert.equal(isOpen(app), true);
  });

  test("Escape closes an open dialog", () => {
    app.key("Escape");
    assert.equal(isOpen(app), false);
  });

  test("Escape when already closed does not throw (edge case)", () => {
    app.click(app.$("closeModal"));
    assert.doesNotThrow(() => app.key("Escape"));
    assert.equal(isOpen(app), false);
  });

  test("other keys do not close the dialog (negative)", () => {
    app.key("Enter");
    app.key("q");
    assert.equal(isOpen(app), true);
  });
});

describe("modal: accessibility contract", () => {
  test("dialog is announced as a modal labelled by its title", () => {
    const app = loadApp();
    const modal = app.$("suggestModal");
    assert.equal(modal.getAttribute("role"), "dialog");
    assert.equal(modal.getAttribute("aria-modal"), "true");
    assert.equal(modal.getAttribute("aria-labelledby"), "modalTitle");
    assert.ok(app.$("modalTitle").textContent.includes("Gửi gợi ý điểm hỗ trợ"));
  });

  test("live region reports save results", () => {
    const message = loadApp().$("formMessage");
    assert.equal(message.getAttribute("role"), "status");
    assert.equal(message.getAttribute("aria-live"), "polite");
  });
});
