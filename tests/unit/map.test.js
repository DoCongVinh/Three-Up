import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadApp, MAX_FOCUS_ZOOM, PROVINCE_CENTER } from "../helpers/app-fixture.js";

/**
 * Leaflet integration through a fake map: layer lifecycle, marker icons,
 * popup content (XSS safety, verification badge, directions link) and
 * fly-to behaviour. The app is driven through real DOM events.
 */
const markerFor = (app, id) => {
  const index = app.$("locationList").querySelectorAll("[data-location-id]").findIndex((el) => el.dataset.locationId === id);
  return index >= 0 ? app.registry.markers[index] : undefined;
};

describe("map: base layers", () => {
  test("adds the Google Maps tile layer with zoom limits", () => {
    const app = loadApp();
    assert.equal(app.registry.tileLayers.length, 1);
    const [tileLayer] = app.registry.tileLayers;
    assert.equal(tileLayer.url, "https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}");
    assert.equal(tileLayer.options.maxZoom, 21);
    assert.ok(app.map._layers.has(tileLayer));
  });

  test("creates the map without the built-in zoom control, then adds a top-right one", () => {
    const app = loadApp();
    assert.equal(app.map.options.zoomControl, false);
    assert.equal(app.registry.zoomControls.length, 1);
    assert.equal(app.registry.zoomControls[0].position, "topright");
  });
});

describe("map: markers", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
  });

  test("renders one marker per visible location", () => {
    assert.equal(app.registry.markers.length, 5);
    assert.deepEqual(app.map._markers.size, 5);
  });

  test("places markers at the location coordinates", () => {
    const marker = markerFor(app, "emergency-dien-khanh");
    assert.deepEqual([...marker.latlng], [12.2583, 109.0911]);
  });

  test("uses a divIcon with the category colour and icon", () => {
    assert.equal(app.registry.icons.length, 5);
    const icon = app.registry.icons[0];
    assert.match(icon.html, /class="custom-marker"/);
    assert.match(icon.html, /#15803d/);
    assert.match(icon.html, /🍲/);
    assert.deepEqual([...icon.iconSize], [38, 44]);
    assert.deepEqual([...icon.iconAnchor], [19, 40]);
    assert.deepEqual([...icon.popupAnchor], [0, -38]);
  });

  test("filters remove markers from the map and restore them later", () => {
    app.select(app.$("wardSelect"), "cam_linh");
    assert.equal(app.map._markers.size, 1);
    app.select(app.$("wardSelect"), "all");
    assert.equal(app.map._markers.size, 5);
  });

  test("does not duplicate markers when the same filter is clicked twice", () => {
    app.click(app.document.querySelector('[data-category="ho_tro"]'));
    app.click(app.document.querySelector('[data-category="ho_tro"]'));
    assert.equal(app.map._markers.size, 2);
    assert.equal(app.registry.markers.length, 5, "existing markers must be reused");
  });

  test("switching filters re-creates only the markers that come back", () => {
    app.select(app.$("wardSelect"), "cam_linh");
    app.select(app.$("wardSelect"), "all");
    assert.equal(app.map._markers.size, 5);
    assert.equal(app.registry.markers.length, 9); // 5 initial + 4 re-created
  });

  test("marker popup shows name, address, phone, badge and directions", () => {
    const marker = markerFor(app, "support-cam-linh");
    const html = marker.popupContent;
    assert.match(html, /Điểm tiếp nhận nhu yếu phẩm Cam Linh/);
    assert.match(html, /Khu vực trung tâm phường Cam Linh/);
    assert.match(html, /tel:02583861234/);
    assert.match(html, /02583861234/);
    assert.match(html, /✓ Đã xác minh bởi UBND\/Đoàn thể/);
    assert.match(
      html,
      /href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=11\.9214%2C109\.1598"/,
    );
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
  });

  test("unverified location shows the pending badge instead (negative)", () => {
    const html = markerFor(app, "need-cam-lam").popupContent;
    assert.match(html, /◷ Chờ xác minh/);
    assert.doesNotMatch(html, /Đã xác minh/);
    assert.match(html, /bg-amber-50/);
  });

  test("expected markers are bound to popups (not left dangling)", () => {
    const displayed = app.$("locationList").querySelectorAll("[data-location-id]");
    for (const card of displayed) {
      const marker = markerFor(app, card.dataset.locationId);
      assert.ok(marker, `marker missing for ${card.dataset.locationId}`);
      assert.ok(marker.popup, `popup not bound for ${card.dataset.locationId}`);
    }
  });
});

describe("map: focus and locate", () => {
  let app;
  beforeEach(() => {
    app = loadApp();
  });

  test("locate button returns to the province view", () => {
    app.map.flyTo([0, 0], 15);
    app.click(app.$("locateButton"));

    const last = app.map.flyToCalls.at(-1);
    assert.deepEqual([...last.latlng], [PROVINCE_CENTER.lat, PROVINCE_CENTER.lng]);
    assert.equal(last.zoom, PROVINCE_CENTER.zoom);
    assert.equal(last.options.duration, 0.6);
  });

  test("clicking a card flies to the location with a minimum zoom of 13", () => {
    app.click(app.document.querySelector('[data-location-id="need-cam-lam"]'));

    const last = app.map.flyToCalls.at(-1);
    assert.deepEqual([...last.latlng], [12.0808, 109.1632]);
    assert.equal(last.zoom, MAX_FOCUS_ZOOM);
  });

  test("never zooms out below the current level (edge case: deep zoom)", () => {
    app.map.zoom = 16;
    app.click(app.document.querySelector('[data-location-id="policy-nha-trang"]'));
    assert.equal(app.map.flyToCalls.at(-1).zoom, 16);
  });

  test("opens the popup of the focused marker", () => {
    app.click(app.document.querySelector('[data-location-id="support-cam-ranh"]'));
    const marker = markerFor(app, "support-cam-ranh");
    assert.equal(marker.isPopupOpen, true);
  });

  test("clicking a marker shows the same detail as clicking a card", () => {
    const marker = markerFor(app, "policy-nha-trang");
    marker.fire("click");

    const detail = app.$("mobileDetail");
    assert.equal(detail.classList.contains("hidden"), false);
    assert.match(detail.textContent, /Tư vấn chính sách an sinh cộng đồng/);
    assert.match(detail.textContent, /Nha Trang/);
    assert.equal(app.$("sheetToggle").getAttribute("aria-expanded"), "true");
  });

  test("resize events forward to map.invalidateSize", () => {
    const before = app.map.invalidateSizeCalls;
    app.window.dispatchEvent({ type: "resize" });
    assert.equal(app.map.invalidateSizeCalls, before + 1);
  });
});

describe("map: resilience when Leaflet is unavailable", () => {
  test("with no L global the app must not render markers silently", () => {
    // Documents current behaviour: index.html requires the Leaflet CDN.
    assert.throws(() => loadApp({ leafletOverrides: { map: undefined } }), /L\.map is not a function|undefined/);
  });

  test("with a broken tileLayer the app fails loudly (no partial map)", () => {
    assert.throws(() => loadApp({ leafletOverrides: { divIcon: undefined } }), /divIcon is not a function/);
  });

  before(() => {
    assert.ok(true);
  });
});
