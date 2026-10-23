import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHANNELS, createIpcRouter } from "../../src/ipc-router.js";
import {
  ALLOWED_EXTENSIONS,
  MAX_IMAGE_BYTES,
  attachPendingImages,
  imageUrl,
  isAllowedImage,
  safeJoin,
  saveImage,
  savePendingImage,
} from "../../src/image-store.js";
import { DataStore } from "../../src/data-store.js";
import { AppService } from "../../src/app-service.js";

const buildRouter = (overrides = {}) => {
  const store = new DataStore(join(mkdtempSync(join(tmpdir(), "khanhhoa-ipc-")), "db.json"), { seedFeedback: false });
  const service = new AppService(store);
  const pickImages = overrides.pickImages || (async () => ({ ok: true, canceled: true, files: [] }));
  const router = createIpcRouter({
    service,
    pickImages,
    appInfo: () => ({ version: "2.0.0", platform: "win32" }),
    images: {
      save: async ({ sourcePath }) => ({ ok: true, saved: { name: "img-1.png", originalName: sourcePath }, pendingId: "pending-1" }),
      url: (feedbackId, name) => imageUrl(feedbackId, name),
    },
  });
  return { router, service, store, pickImages };
};

describe("ipc-router: contract", () => {
  test("publishes every channel the preload allows", () => {
    const { router } = buildRouter();
    assert.deepEqual(router.channels.sort(), [...CHANNELS].sort());
    for (const channel of ["auth:login", "accounts:create", "feedback:submit", "feedback:review", "dialog:pickImages", "image:save"]) {
      assert.ok(CHANNELS.includes(channel), channel);
    }
  });

  test("unknown channels are refused, never routed", async () => {
    const { router } = buildRouter();
    for (const channel of ["files:read", "process:exec", undefined, null]) {
      const result = await router.handle({ channel, payload: {} });
      assert.equal(result.ok, false);
      assert.equal(result.code, "UNKNOWN_CHANNEL");
    }
  });

  test("thrown errors become { ok:false, code:INTERNAL } without leaking the stack", async () => {
    const { router, service } = buildRouter();
    service.login = () => {
      const error = new Error("boom");
      error.stack = "SECRET STACK";
      throw error;
    };
    const result = await router.handle({ channel: "auth:login", payload: { username: "a", password: "b" } });
    assert.equal(result.ok, false);
    assert.equal(result.code, "INTERNAL");
    assert.equal(result.errors[0], "boom");
    assert.equal(JSON.stringify(result).includes("SECRET STACK"), false);
  });

  test("missing payload is treated as empty", async () => {
    const { router } = buildRouter();
    const result = await router.handle({ channel: "auth:login" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_CREDENTIALS");
  });
});

describe("ipc-router: end-to-end flows through the request envelope", () => {
  let router;
  beforeEach(() => {
    ({ router } = buildRouter());
  });

  const request = (channel, payload = {}) => router.handle({ channel, payload });

  test("login -> create account -> submit -> list -> review", async () => {
    const login = await request("auth:login", { username: "admin", password: "Admin@2025" });
    assert.equal(login.ok, true);
    const { sessionId } = login;

    const created = await request("accounts:create", {
      sessionId,
      username: "caml.cb",
      password: "Canbo@123",
      displayName: "Cán bộ Cam Linh",
      wardId: "cr_camlinh",
    });
    assert.equal(created.ok, true);
    assert.equal(created.account.scope, "cr_camlinh");

    const submitted = await request("feedback:submit", {
      fullName: "Nguyễn Văn An",
      phone: "0905123456",
      email: "an@example.com",
      address: "12 Trần Phú",
      reason: "Cần hỗ trợ lương thực cho hộ gia đình khó khăn tại tổ dân phố.",
      category: "nhu_cau",
      wardId: "cr_camlinh",
      hamlet: "Tổ dân phố 3",
      lat: 11.9214,
      lng: 109.1598,
    });
    assert.equal(submitted.ok, true);
    assert.match(submitted.message, /Phường Cam Linh/);

    const adminQueue = await request("feedback:list", { sessionId });
    assert.equal(adminQueue.ok, true);
    assert.equal(adminQueue.counts.pending, 1);

    const officerLogin = await request("auth:login", { username: "caml.cb", password: "Canbo@123" });
    const reviewed = await request("feedback:review", {
      sessionId: officerLogin.sessionId,
      feedbackId: submitted.feedbackId,
      status: "approved",
    });
    assert.equal(reviewed.ok, true);

    const locations = await request("feedback:publicLocations");
    assert.equal(locations.locations.length, 1);
    assert.equal(locations.locations[0].id, submitted.feedbackId);
  });

  test("login failures are reported with a stable code", async () => {
    const result = await request("auth:login", { username: "admin", password: "sai" });
    assert.equal(result.code, "INVALID_CREDENTIALS");
    assert.equal(result.errors.length, 1);
  });

  test("unauthorized calls do not mutate data", async () => {
    const result = await request("accounts:create", {
      sessionId: "fake",
      username: "x.cb",
      password: "Canbo@123",
      displayName: "X",
      wardId: "cr_camlinh",
    });
    assert.equal(result.code, "UNAUTHENTICATED");
    const stats = await request("directory:regions");
    assert.equal(stats.ok, true);
  });

  test("image helpers are exposed through the envelope", async () => {
    const picked = await request("dialog:pickImages");
    assert.equal(picked.ok, true);
    assert.equal(picked.canceled, true);

    const saved = await request("image:save", { sourcePath: "C:/photos/a.png" });
    assert.equal(saved.ok, true);
    assert.equal(saved.saved.name, "img-1.png");

    const url = await request("image:url", { feedbackId: "fb-1", name: "img-1.png" });
    assert.equal(url.url, "app-image://images/fb-1/img-1.png");
  });

  test("app info exposes version and platform", async () => {
    const info = await request("app:info");
    assert.equal(info.version, "2.0.0");
    assert.equal(info.platform, "win32");
  });
});

describe("image-store: validation", () => {
  test("accepts only png/jpg/jpeg/webp", () => {
    for (const ext of ALLOWED_EXTENSIONS) assert.equal(isAllowedImage(`photo${ext}`), true);
    for (const name of ["a.gif", "a.exe", "a.svg", "a", "a.PNG.exe"]) assert.equal(isAllowedImage(name), false);
  });

  test("safeJoin blocks path traversal", () => {
    const root = join(tmpdir(), "images-root");
    assert.equal(safeJoin(root, "fb-1/a.png"), join(root, "fb-1", "a.png"));
    assert.equal(safeJoin(root, "../escape.png"), null);
    assert.equal(safeJoin(root, "fb-1/../../escape.png"), null);
  });

  test("imageUrl encodes identifiers", () => {
    assert.equal(imageUrl("fb 1", "a b.png"), "app-image://images/fb%201/a%20b.png");
  });
});

describe("image-store: saving & attaching", () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "khanhhoa-images-"));
  });

  test("copies a valid image under <root>/<feedbackId> with a safe name", () => {
    const source = join(root, "source.png");
    writeFileSync(source, Buffer.from([1, 2, 3]));

    const result = saveImage({ sourcePath: source, imagesRoot: join(root, "store"), feedbackId: "fb-1" });
    assert.equal(result.ok, true);
    assert.match(result.saved.name, /^img-[a-z0-9]+\.png$/);
    assert.equal(result.saved.originalName, "source.png");
    assert.equal(result.saved.size, 3);
    assert.equal(existsSync(join(root, "store", "fb-1", result.saved.name)), true);
  });

  test("rejects wrong extension, missing file and oversized files (negative)", () => {
    const txt = join(root, "note.txt");
    writeFileSync(txt, "hello");
    assert.equal(saveImage({ sourcePath: txt, imagesRoot: root, feedbackId: "fb" }).ok, false);
    assert.equal(saveImage({ sourcePath: join(root, "missing.png"), imagesRoot: root, feedbackId: "fb" }).ok, false);
    assert.equal(saveImage({ sourcePath: "", imagesRoot: root, feedbackId: "fb" }).ok, false);

    const huge = join(root, "huge.png");
    writeFileSync(huge, Buffer.alloc(MAX_IMAGE_BYTES + 1));
    const tooBig = saveImage({ sourcePath: huge, imagesRoot: root, feedbackId: "fb" });
    assert.equal(tooBig.ok, false);
    assert.match(tooBig.errors.join(), /5MB/);
  });

  test("savePendingImage returns a pending folder id", () => {
    const source = join(root, "a.jpg");
    writeFileSync(source, Buffer.from([1]));
    const result = savePendingImage({ sourcePath: source, imagesRoot: join(root, "store") });
    assert.equal(result.ok, true);
    assert.match(result.pendingId, /^pending-[0-9a-f-]{36}$/);
    assert.equal(existsSync(join(root, "store", result.pendingId, result.saved.name)), true);
  });

  test("attachPendingImages moves files into the feedback folder and clears the temp folder", () => {
    const source = join(root, "b.png");
    writeFileSync(source, Buffer.from([1]));
    const store = join(root, "store");
    const pending = savePendingImage({ sourcePath: source, imagesRoot: store });
    const moved = attachPendingImages({ imagesRoot: store, pendingId: pending.pendingId, feedbackId: "fb-9", names: [pending.saved.name] });

    assert.deepEqual(moved, { ok: true, moved: 1 });
    assert.equal(existsSync(join(store, "fb-9", pending.saved.name)), true);
    assert.equal(existsSync(join(store, pending.pendingId)), false);
  });

  test("attachPendingImages rejects invalid ids (path traversal)", () => {
    for (const feedbackId of ["../x", "a/b", ""]) {
      const result = attachPendingImages({ imagesRoot: root, pendingId: "pending-x", feedbackId, names: ["a.png"] });
      assert.equal(result.ok, false, feedbackId);
    }
    assert.equal(attachPendingImages({ imagesRoot: root, pendingId: null, feedbackId: "fb", names: ["a.png"] }).ok, false);
    assert.deepEqual(attachPendingImages({ imagesRoot: root, pendingId: null, feedbackId: "fb", names: [] }), { ok: true, moved: 0 });
  });

  test("stored image bytes are unchanged", () => {
    const bytes = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
    const source = join(root, "c.png");
    writeFileSync(source, bytes);
    const result = saveImage({ sourcePath: source, imagesRoot: join(root, "s"), feedbackId: "fb-c" });
    assert.deepEqual(readFileSync(join(root, "s", "fb-c", result.saved.name)), bytes);
  });
});
