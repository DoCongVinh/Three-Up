import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROOT,
  loadApp,
  readIndexHtml,
  extractInlineScripts,
  createStorage,
  STORAGE_KEY,
} from "../helpers/app-fixture.js";
import { runInContext } from "node:vm";

/**
 * The single-file delivery contract (desktop + mobile from one index.html):
 * document metadata, CDN dependencies, responsive layout and safe rendering.
 */
const read = (path) => readFileSync(resolve(ROOT, path), "utf8");

/**
 * The app's escapeHtml lives inside an IIFE, so tests evaluate the same
 * source text in the app realm instead of reimplementing it.
 */
const ESCAPE_HTML_SOURCES = extractInlineScripts(readIndexHtml())
  .map((source) => /function escapeHtml\(value\) \{\s*return ([\s\S]*?);\s*\n\s*\}/.exec(source))
  .filter(Boolean)
  .map((match) => match[1].replace(/\s+/g, " "));

const escapeHtmlFromApp = () => {
  const app = loadApp();
  const body = ESCAPE_HTML_SOURCES[0];
  // Keep the app's original source text; only mirror it as an arrow function.
  return runInContext(`(value) => { return ${body}; }`, app.context);
};

describe("index.html: document shell", () => {
  const html = readIndexHtml();

  test("declares Vietnamese language and UTF-8", () => {
    assert.match(html, /<html lang="vi">/);
    assert.match(html, /<meta charset="UTF-8">/);
  });

  test("is responsive: viewport fits notches on both phone platforms", () => {
    const viewport = /<meta name="viewport" content="([^"]+)">/.exec(html);
    assert.ok(viewport, "viewport meta is required for mobile");
    assert.match(viewport[1], /width=device-width/);
    assert.match(viewport[1], /initial-scale=1(\.0)?/);
    assert.match(viewport[1], /viewport-fit=cover/);
  });

  test("sets the mobile browser chrome colour to the brand teal", () => {
    assert.match(html, /<meta name="theme-color" content="#0f766e">/);
  });

  test("has an SEO description and a Vietnamese title", () => {
    assert.match(html, /<meta name="description" content="[^"]*Khánh Hòa[^"]*">/);
    assert.match(html, /<title>Bản đồ Yêu thương Khánh Hòa<\/title>/);
  });

  test("loads Tailwind and Leaflet from pinned CDNs", () => {
    assert.match(html, /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/);
    assert.match(html, /href="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css"/);
    assert.match(html, /<script src="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js"><\/script>/);
  });

  test("works offline-safe DOM wise: no inline event handler attributes", () => {
    assert.doesNotMatch(html, /\son(click|change|input|submit|load|keydown)=/i);
  });
});

describe("index.html: responsive layout contract", () => {
  const html = readIndexHtml();

  test("uses a desktop sidebar + map split that stacks on mobile", () => {
    assert.match(html, /<main class="[^"]*flex h-full w-full flex-col[^"]*md:flex-row[^"]*">/);
    assert.match(html, /<aside class="[^"]*\bmd:w-\[390px\]/);
    assert.match(html, /<section class="absolute inset-0 z-0 md:relative md:flex-1"/);
  });

  test("bottom sheet only exists on small screens", () => {
    assert.match(html, /id="mobileSheet"[^>]*\bmd:hidden/);
  });

  test("filters stay visible on mobile via a horizontal scroll strip", () => {
    assert.match(html, /id="categoryFilters" class="[^"]*overflow-x-auto[^"]*md:flex-col/);
  });

  test("respects iPhone safe-area insets", () => {
    assert.match(html, /\.safe-bottom\s*\{[^}]*env\(safe-area-inset-bottom\)/);
  });
});

describe("security: rendering is XSS-safe", () => {
  test("escapeHtml neutralises every dangerous character", () => {
    const escapeHtml = escapeHtmlFromApp();
    const payload = `<img src=x onerror="alert('x')">&`;
    const encoded = escapeHtml(payload);

    assert.equal(encoded, "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;");
    assert.doesNotMatch(encoded, /[<>"']/);
  });

  test("no raw payload can survive escaping (regression guard)", () => {
    const escapeHtml = escapeHtmlFromApp();
    const samples = [
      `<script>alert(1)</script>`,
      `" onmouseover="alert(1)`,
      `'; DROP TABLE places; --`,
      `<svg/onload=alert(1)>`,
    ];
    for (const sample of samples) {
      const escaped = escapeHtml(sample);
      assert.doesNotMatch(escaped, /[<>"']/, `unescaped output for ${sample}`);
    }
  });

  test("phone numbers are URL-encoded inside tel: links", () => {
    const app = loadApp();
    app.click(app.document.querySelector('[data-location-id="support-cam-linh"]'));
    const link = app.$("mobileDetail").querySelector("a");
    assert.equal(link.getAttribute("href"), `tel:${encodeURIComponent("02583861234")}`);
  });

  test("external links open in a new tab without leaking the opener", () => {
    const app = loadApp();
    app.click(app.document.querySelector('[data-location-id="need-cam-lam"]'));
    const external = app.$("mobileDetail").querySelectorAll("a").filter((a) => a.getAttribute("target") === "_blank");
    assert.equal(external.length, 1);
    assert.equal(external[0].getAttribute("rel"), "noopener noreferrer");
  });
});

describe("project: package.json scripts", () => {
  const pkg = JSON.parse(read("package.json"));

  test("is a private, ES-module project with the expected identity", () => {
    assert.equal(pkg.name, "khanh-hoa-love-map");
    assert.equal(pkg.private, true);
    assert.equal(pkg.type, "module");
  });

  test("test script points at the unit test folder", () => {
    assert.match(pkg.scripts.test, /node --test/);
    assert.match(pkg.scripts.test, /tests\/unit\//);
  });

  test("watch script enables node's built-in watcher", () => {
    assert.match(pkg.scripts["test:watch"], /--watch/);
  });

  test("has no runtime dependencies (single-file CDN app)", () => {
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
  });
});

describe("harness: isolation between test worlds", () => {
  test("two app instances never share localStorage", () => {
    const first = loadApp({ storage: createStorage() });
    const second = loadApp({ storage: createStorage() });
    first.fillForm();
    first.submitForm();

    assert.equal(first.savedSuggestions().length, 1);
    assert.equal(second.storage.getItem(STORAGE_KEY), null);
  });

  test("inline scripts are extracted without pulling in CDN bundles", () => {
    const scripts = extractInlineScripts(readIndexHtml());
    assert.equal(scripts.length, 1);
    assert.match(scripts[0], /\(\(\) => \{/);
    assert.doesNotMatch(scripts[0], /cdn\.tailwindcss\.com/);
  });

  test("index.html contains no unescaped backtick breakages in the app script", () => {
    const scripts = extractInlineScripts(readIndexHtml());
    assert.equal(scripts.length, 1);
    const [script] = scripts;
    assert.match(script, /const locations = \[/);
    assert.match(script, /render\(\);/);
  });
});
