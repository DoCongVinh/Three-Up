/**
 * Lớp nền bản đồ của ứng dụng (Google Maps) + hành vi cảnh báo khi tile lỗi.
 * Thay thế phần "base layers" cũ (OpenStreetMap) trong map.test.js.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadApp, settle } from "../helpers/app-fixture.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../helpers/app-fixture.js";

const read = (path) => readFileSync(resolve(ROOT, path), "utf8");

describe("basemap: Google Maps là nền duy nhất", () => {
  test("creates exactly one tile layer using the Google tile endpoint", () => {
    const app = loadApp();
    assert.equal(app.registry.tileLayers.length, 1);
    const [layer] = app.registry.tileLayers;
    assert.equal(layer.url, "https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}");
    assert.equal(layer.options.maxZoom, 21);
    assert.equal(layer.options.minZoom, 3);
    assert.equal(layer.options.attributionControl, false);
    assert.ok(app.map._layers.has(layer));
  });

  test("does not request tiles with a file:// referer", () => {
    const [layer] = loadApp().registry.tileLayers;
    assert.equal(layer.options.referrerPolicy, "no-referrer");
  });

  test("no OpenStreetMap anywhere in the shipped renderer or markup", () => {
    for (const file of ["app.js", "index.html"]) {
      assert.doesNotMatch(read(file), /openstreetmap/i, `${file} còn tham chiếu OpenStreetMap`);
    }
  });

  test("CSP allows Google tile hosts but no longer lists OSM", () => {
    const html = read("index.html");
    const csp = /Content-Security-Policy"[\s\S]*?content="([^"]+)"/.exec(html);
    assert.ok(csp, "phải có meta CSP");
    assert.doesNotMatch(csp[1], /openstreetmap/i);
    assert.match(csp[1], /https:\/\/\*\.google\.com/);
  });

  test("no basemap toggle button is rendered anymore", () => {
    const html = read("index.html");
    assert.doesNotMatch(html, /basemapButton/);
  });

  test("map is created without the built-in zoom control, then a top-right one is added", () => {
    const app = loadApp();
    assert.equal(app.map.options.zoomControl, false);
    assert.equal(app.registry.zoomControls.length, 1);
    assert.equal(app.registry.zoomControls[0].position, "topright");
  });
});

describe("basemap: cảnh báo khi không tải được tile", () => {
  let app;
  let layer;
  beforeEach(async () => {
    app = loadApp();
    await app.loginAdmin();
    await settle();
    layer = app.registry.tileLayers.at(-1);
  });

  test("warning stays hidden while tiles are loading", () => {
    assert.equal(app.$("mapTileWarning").hidden, true);
  });

  test("shows a Google-specific warning after repeated tile errors", () => {
    layer.fire("tileerror", {});
    layer.fire("tileerror", {});
    const box = app.$("mapTileWarning");
    assert.equal(box.hidden, false);
    assert.match(box.textContent, /Không tải được ảnh nền Google Maps/);
    assert.match(box.textContent, /mt0-3\.google\.com|Thử lại/);
  });

  test("a single error is not enough to alarm the user", () => {
    layer.fire("tileerror", {});
    assert.equal(app.$("mapTileWarning").hidden, true);
  });

  test("hides the warning as soon as one tile loads", () => {
    layer.fire("tileerror", {});
    layer.fire("tileerror", {});
    layer.fire("tileload", {});
    assert.equal(app.$("mapTileWarning").hidden, true);
  });

  test("retry button re-applies the basemap and keeps exactly one layer", () => {
    layer.fire("tileerror", {});
    layer.fire("tileerror", {});
    const retry = app.$("mapTileWarning").querySelector("button");
    app.click(retry);
    assert.equal(app.registry.tileLayers.length, 2, "một layer mới được tạo");
    assert.equal(app.map._layers.size, 1, "layer cũ đã bị gỡ");
    assert.equal(app.$("mapTileWarning").hidden, true);
  });
});
