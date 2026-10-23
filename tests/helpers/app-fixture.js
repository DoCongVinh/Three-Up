/**
 * Shared fixture for the renderer tests (Electron app).
 *
 * Boots the REAL app: index.html markup + app.js in a vm with a minimal DOM,
 * fake Leaflet and a stub window.khanhHoa that talks to the REAL backend
 * (DataStore + AppService + createIpcRouter). Each loadApp() is isolated
 * (fresh tmp DB, DOM, timers) so tests never leak state.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  Window,
  FormData,
  Event,
  MouseEvent,
  DOMException,
  parseDocument,
} from "./html-dom.js";
import { DataStore } from "../../src/data-store.js";
import { AppService } from "../../src/app-service.js";
import { createIpcRouter } from "../../src/ipc-router.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const INDEX_PATH = resolve(ROOT, "index.html");
export const APP_PATH = resolve(ROOT, "app.js");

/** Default centre of Khánh Hòa used by the app. */
export const PROVINCE_CENTER = { lat: 12.05, lng: 109.15, zoom: 9 };
export const MAX_FOCUS_ZOOM = 13;

export function readIndexHtml() {
  return readFileSync(INDEX_PATH, "utf8");
}

/** Extract every inline <script> body (external src= scripts excluded). */
export function extractInlineScripts(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const attrs = match[1] || "";
    if (/\bsrc\s*=/.test(attrs)) continue;
    scripts.push(match[2]);
  }
  return scripts;
}

/* --------------------------- fake Leaflet ------------------------------ */

class FakeTileLayer {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.map = null;
    this.boundTo = null;
    this._listeners = new Map();
  }
  addTo(map) {
    this.boundTo = map;
    map.addLayer(this);
    return this;
  }
  on(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
    return this;
  }
  /** Mô phỏng Leaflet phát sự kiện tileload / tileerror. */
  fire(type, payload) {
    for (const handler of [...(this._listeners.get(type) || [])]) handler(payload);
    return this;
  }
}

class FakePopup {
  constructor(marker) {
    this.marker = marker;
  }
  setContent(html) {
    this.marker.popupContent = html;
    return this;
  }
}

class FakeMarker {
  constructor(latlng, options = {}) {
    this.latlng = latlng;
    this.options = options;
    this.map = null;
    this.boundTo = null;
    this.popup = null;
    this.popupContent = "";
    this.isPopupOpen = false;
    this._listeners = new Map();
  }
  addTo(map) {
    // `map` comes from the page's realm, so avoid instanceof and use the API.
    this.boundTo = map;
    this.map = map;
    map.addLayer(this);
    return this;
  }
  remove() {
    if (this.boundTo) this.boundTo.removeLayer(this);
    return this;
  }
  bindPopup(content) {
    this.popup = new FakePopup(this);
    this.popupContent = content;
    return this;
  }
  openPopup() {
    this.isPopupOpen = true;
    return this;
  }
  closePopup() {
    this.isPopupOpen = false;
    return this;
  }
  on(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
    return this;
  }
  fire(type, payload) {
    for (const handler of [...(this._listeners.get(type) || [])]) handler(payload);
    return this;
  }
}

export class FakeLayerGroup {
  constructor() {
    this.layers = [];
    this.map = null;
    this.boundTo = null;
  }
  addLayer(layer) {
    this.layers.push(layer);
    return this;
  }
  addTo(map) {
    this.boundTo = map;
    this.map = map;
    map.addLayer(this);
    return this;
  }
  clearLayers() {
    for (const layer of this.layers) layer.remove?.();
    this.layers = [];
    return this;
  }
  getBounds() {
    const points = this.layers.map((layer) => layer.latlng);
    return { points };
  }
}

export class FakeMap {
  constructor(elementId, options = {}) {
    this.elementId = elementId;
    this.options = options;
    this.center = null;
    this.zoom = null;
    this._markers = new Set();
    this._layers = new Set();
    this._listeners = new Map();
    // Leaflet keeps every layer in _layers and every marker target in _markers;
    // keep _markers a single Set (markers/map may live in another vm realm).
    this.flyToCalls = [];
    this.fitBoundsCalls = [];
    this.removedLayers = [];
    this.invalidateSizeCalls = 0;
  }
  setView(latlng, zoom) {
    this.center = latlng;
    this.zoom = zoom;
    return this;
  }
  getZoom() {
    return this.zoom;
  }
  flyTo(latlng, zoom, options) {
    this.flyToCalls.push({ latlng, zoom, options });
    this.center = [latlng[0], latlng[1]];
    this.zoom = zoom;
    return this;
  }
  addLayer(layer) {
    this._layers.add(layer);
    if (layer instanceof FakeMarker || layer instanceof FakeLayerGroup) this._markers.add(layer);
    return this;
  }
  removeLayer(layer) {
    this._layers.delete(layer);
    this._markers.delete(layer);
    this.removedLayers.push(layer);
    return this;
  }
  invalidateSize() {
    this.invalidateSizeCalls += 1;
    return this;
  }
  fitBounds(bounds, options) {
    this.fitBoundsCalls.push({ bounds, options });
    return this;
  }
  fire(type, payload) {
    for (const handler of [...(this._listeners.get(type) || [])]) handler(payload);
    return this;
  }
  on(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
    return this;
  }
}

export function createFakeLeaflet(registry, options = {}) {
  const L = {
    map(elementId, mapOptions) {
      const map = new FakeMap(elementId, mapOptions);
      registry.maps.push(map);
      return map;
    },
    tileLayer(url, options) {
      const layer = new FakeTileLayer(url, options);
      registry.tileLayers.push(layer);
      return layer;
    },
    control: {
      zoom(options) {
        registry.zoomControls.push(options);
        return { addTo: (map) => map };
      },
    },
    marker(latlng, options) {
      const marker = new FakeMarker(latlng, options);
      registry.markers.push(marker);
      return marker;
    },
    circleMarker(latlng, options) {
      const marker = new FakeMarker(latlng, options);
      marker.kind = "circle";
      registry.markers.push(marker);
      return marker;
    },
    layerGroup() {
      const group = new FakeLayerGroup();
      registry.groups.push(group);
      return group;
    },
    latLngBounds(points) {
      return { points: [...points], extend(point) { this.points.push(point); return this; } };
    },
    divIcon(iconOptions) {
      registry.icons.push(iconOptions);
      return { kind: "divIcon", ...iconOptions };
    },
  };
  // Allows a test to boot the app on a page whose Leaflet build is broken.
  return Object.assign(L, options.overrides || {});
}

/* -------------------------- fake storage ------------------------------- */

export function createStorage({ failOnSet = null } = {}) {
  const data = new Map();
  const storage = {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (failOnSet) throw failOnSet;
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
    get size() {
      return data.size;
    },
    raw() {
      return Object.fromEntries(data);
    },
    /** Escape hatch: stash a raw value (e.g. corrupted JSON) without validation. */
    seed(key, value) {
      data.set(key, String(value));
    },
  };
  return storage;
}

/* --------------------------- world factory ----------------------------- */

/** Flush pending timers registered by the app (invalidateSize, toast...). */
export async function flushTimers(app) {
  await new Promise((resolve) => setImmediate(resolve));
  while (app.timers.length) {
    const fn = app.timers.shift();
    fn();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Chờ microtask/promise của handler async chạy xong. */
export async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function createSandbox({ window, document, fakeLeaflet, events, timers, extra = {} }) {
  return createContext({
    window,
    document,
    console,
    L: fakeLeaflet,
    ...events,
    setTimeout(fn, _ms) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    ...extra,
  });
}

/**
 * Boot the real app in an isolated world.
 *
 * - Backend thật: DataStore (file JSON tạm) + AppService + createIpcRouter.
 * - DOM thật (parser ở html-dom.js) + Leaflet giả + app.js chạy trong vm.
 * - window.khanhHoa là stub gọi thẳng router (đúng như main process làm).
 *
 * @param {{db?: DataStore, api?: object, seedFeedback?: boolean, storage?: object}} [options]
 */
export function loadApp(options = {}) {
  const html = readIndexHtml();
  const document = parseDocument(html);
  const window = new Window();
  window.document = document;

  const registry = { maps: [], markers: [], groups: [], tileLayers: [], zoomControls: [], icons: [] };
  const fakeLeaflet = createFakeLeaflet(registry, { overrides: options.leafletOverrides });
  const timers = [];
  const events = { Event, MouseEvent, DOMException };

  let store = options.db || null;
  if (!store) {
    const dir = options.dir || mkdtempSync(join(tmpdir(), "khanhhoa-ui-"));
    store = new DataStore(join(dir, "db.json"), {
      allowSeed: true,
      seedFeedback: options.seedFeedback ?? true,
      seedAdminPassword: options.adminPassword || "Admin@2025",
    });
  }
  const service = options.service || new AppService(store, options.serviceOptions || {});

  const calls = [];
  const router = options.router || createIpcRouter({
    service,
    appInfo: () => ({ version: "2.0.0", platform: "win32" }),
    pickImages: async () => options.pickImages
      ? options.pickImages()
      : { ok: true, canceled: true, files: [] },
    images: {
      save: async ({ sourcePath }) => options.saveImage
        ? options.saveImage({ sourcePath })
        : { ok: true, saved: { name: "img-test.png", originalName: "test.png", size: 10 }, pendingId: "pending-00000000-0000-0000-0000-000000000000" },
      url: (feedbackId, name) => `app-image://images/${feedbackId}/${name}`,
    },
  });
  const api = options.api || (async (channel, payload = {}) => {
    // Giống main process: tự gắn IP + token thiết bị (từ "cookie" mô phỏng)
    // để test được luồng nhận diện thiết bị khách.
    const enriched = {
      ...payload,
      ip: options.ip || "203.113.45.67",
      submittedFrom: "desktop",
      deviceToken: options.deviceToken || "test-device-token",
      // Giống main process: gắn User-Agent + thông tin máy vào mọi request.
      deviceInfo: options.deviceInfo || {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Electron/37",
        os: "Windows_NT 10.0.19045",
        platform: "win32",
        arch: "x64",
        hostname: "TEST-PC",
        app: "Electron 37.2.0",
        collectedAt: new Date().toISOString(),
      },
    };
    calls.push({ channel, payload: enriched });
    return router.handle({ channel, payload: enriched });
  });

  window.khanhHoa = { isDesktop: true, platform: "win32", request: api };
  window.navigator = {
    geolocation: options.geolocation || {
      getCurrentPosition: (success) => success({ coords: { latitude: 12.2451, longitude: 109.1943 } }),
    },
  };

  const storage = options.storage ?? createStorage();
  const context = createSandbox({
    window,
    document,
    fakeLeaflet,
    events,
    timers,
    // `navigator` global giống trình duyệt (app.js dùng navigator.geolocation trực tiếp).
    extra: { localStorage: storage, FormData, navigator: window.navigator },
  });
  Object.assign(window, events, { L: fakeLeaflet, localStorage: storage, FormData });

  const appSource = readFileSync(APP_PATH, "utf8");
  runInContext(appSource, context, { filename: APP_PATH });

  const $ = (id) => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`[fixture] #${id} not found in index.html`);
    return node;
  };

  return {
    html,
    document,
    window,
    context,
    store,
    service,
    router,
    calls,
    storage,
    registry,
    timers,
    $,
    map: registry.maps[0],
    /** Click helper that bubbles through the document (as a real click does). */
    click(target) {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    },
    fire(target, type, init = {}) {
      const event = new Event(type, { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    },
    submit(form) {
      return this.fire(form, "submit");
    },
    key(keyName, target = document) {
      return this.fire(target, "keydown", { key: keyName });
    },
    setValue(control, value) {
      control.value = value;
      return this.fire(control, control.localName === "select" ? "change" : "input");
    },
    /** Đăng nhập qua giao diện thật (điền form + submit). */
    async loginAs(username, password) {
      this.setValue($("loginUsername"), username);
      this.setValue($("loginPassword"), password);
      this.submit($("loginForm"));
      await settle();
      await flushTimers(this);
    },
    /** Đăng nhập admin mặc định. */
    async loginAdmin(password = "Admin@2025") {
      await this.loginAs("admin", password);
    },
    /** Gọi thẳng service để tạo dữ liệu test (không qua UI). */
    loginDirect(username, password) {
      return service.login({ username, password });
    },
  };
}

/** Tạo tài khoản cán bộ nhanh qua service (dùng để seed test). */
export function createWardOfficer(app, { username, wardId, displayName = "Cán bộ", password = "Canbo@123", adminSession } = {}) {
  const sessionId = adminSession || app.loginDirect("admin", "Admin@2025").sessionId;
  return app.service.createAccount({ sessionId, username, password, displayName, wardId });
}

/** Phản hồi hợp lệ mặc định cho test UI. */
export function validFeedback(overrides = {}) {
  return {
    fullName: "Nguyễn Văn An",
    phone: "0905123456",
    email: "an.nguyen@example.com",
    address: "12 Trần Phú, phường Lộc Thọ",
    reason: "Điểm phát cơm miễn phí cho người lao động khó khăn, mở 10h-12h hằng ngày.",
    category: "ho_tro",
    wardId: "p_nha_trang",
    lat: 12.2451,
    lng: 109.1943,
    ...overrides,
  };
}
