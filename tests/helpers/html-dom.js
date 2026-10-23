/**
 * Minimal DOM implementation, used ONLY by the unit tests.
 *
 * The renderer is plain HTML + ES module + one preload bridge, so the tests
 * parse index.html with a small HTML parser and run app.js against it
 * inside node:vm, with a stub window.khanhHoa.
 *
 * Supported: elements/attributes, classList, dataset, innerHTML (re-parsed),
 * textContent, form.elements / reset / reportValidity, addEventListener
 * (incl. event-argument names, e.g. "click" / "keydown"), dispatchEvent with
 * bubbling + closest(), querySelector(All) (including selector lists,
 * ".a .b" and tag.class / tag[attr] combinations), <script> textContent.
 * Not supported (and never asserted on): layout, CSS, fonts.
 */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

/** Elements whose content is raw text (never parsed as markup). */
const RAW_TEXT = new Set(["script", "style", "textarea"]);

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"
]);

export function decodeEntities(value) {
  return String(value).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    const key = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : match;
  });
}

export class DOMException extends Error {
  constructor(message, name) {
    super(message);
    this.name = name;
  }
}

export class Event {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.detail = init.detail;
    this.key = init.key;
    this.relatedTarget = init.relatedTarget || null;
  }
  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
  stopPropagation() {}
  stopImmediatePropagation() {}
}

export class MouseEvent extends Event {}

export class Element {
  constructor(doc, localName) {
    this.ownerDocument = doc;
    this.localName = localName;
    this.nodeType = 1;
    this.childNodes = [];
    this.parentNode = null;
    this._attributes = new Map();
    this._listeners = new Map();
    this._innerHTML = "";
    this._value = "";
    this.style = new Proxy({}, {
      get: (target, prop) => (prop in target ? target[prop] : ""),
      set: (target, prop, value) => {
        target[prop] = String(value);
        return true;
      },
    });
  }

  get tagName() { return this.localName.toUpperCase(); }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
  get id() { return this.getAttribute("id") || ""; }
  set id(value) { this.setAttribute("id", value); }
  get hidden() { return this.hasAttribute("hidden"); }
  set hidden(value) {
    if (value) this.setAttribute("hidden", "");
    else this.removeAttribute("hidden");
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }

  get dataset() {
    const element = this;
    const data = {};
    for (const [name, value] of this._attributes) {
      if (name.startsWith("data-")) {
        data[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
      }
    }
    // Live proxy: `node.dataset.id = "x"` writes the real data-id attribute.
    return new Proxy(data, {
      set(target, prop, value) {
        const attr = `data-${String(prop).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
        element.setAttribute(attr, String(value));
        target[prop] = String(value);
        return true;
      },
    });
  }

  getAttribute(name) { return this._attributes.has(name) ? this._attributes.get(name) : null; }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  hasAttribute(name) { return this._attributes.has(name); }
  removeAttribute(name) { this._attributes.delete(name); }

  get title() { return this.getAttribute("title") || ""; }
  get placeholder() { return this.getAttribute("placeholder") || ""; }
  set placeholder(value) { this.setAttribute("placeholder", String(value)); }
  get readOnly() { return this.hasAttribute("readonly"); }
  set readOnly(value) {
    if (value) this.setAttribute("readonly", "");
    else this.removeAttribute("readonly");
  }
  get rows() { return Number(this.getAttribute("rows") || 0); }
  set rows(value) { this.setAttribute("rows", String(value)); }
  get maxLength() { return Number(this.getAttribute("maxlength") || -1); }
  set maxLength(value) { this.setAttribute("maxlength", String(value)); }
  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(value) {
    if (value) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }
  get checked() { return this.hasAttribute("checked"); }
  set checked(value) {
    if (value) this.setAttribute("checked", "");
    else this.removeAttribute("checked");
  }
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  get name() { return this.getAttribute("name") || ""; }
  set name(value) { this.setAttribute("name", String(value)); }
  get type() {
    const explicit = this.getAttribute("type");
    if (explicit) return explicit.toLowerCase();
    return this.localName === "button" ? "submit" : "text";
  }
  set type(value) {
    this.setAttribute("type", String(value));
  }

  get value() {
    if (this.localName === "select") {
      if (this._value) return this._value;
      const options = this.options;
      const chosen = options.find((option) => option.hasAttribute("selected")) || options[0];
      return chosen ? chosen.getAttribute("value") || "" : "";
    }
    // Giống trình duyệt: chưa gán -> lấy attribute value trong markup.
    if (this._value === "") return this.getAttribute("value") || "";
    return this._value;
  }
  set value(next) {
    const text = String(next);
    if (this.localName === "select" && text) {
      // Giống trình duyệt: chỉ nhận giá trị có trong danh sách option.
      const exists = this.options.some((option) => (option.getAttribute("value") || "") === text);
      if (!exists) return;
    }
    this._value = text;
  }
  get options() {
    if (this.localName !== "select") return [];
    // Giống trình duyệt: options gồm cả <option> nằm trong <optgroup>.
    return this.children.flatMap((child) => {
      if (child.localName === "option") return [child];
      if (child.localName === "optgroup") return child.children.filter((item) => item.localName === "option");
      return [];
    });
  }

  get classList() {
    const element = this;
    const read = () => element.className.split(/\s+/).filter(Boolean);
    const write = (classes) => { element.className = [...new Set(classes)].join(" "); };
    return {
      add(...names) {
        const classes = read();
        for (const name of names) if (!classes.includes(name)) classes.push(name);
        write(classes);
      },
      remove(...names) { write(read().filter((name) => !names.includes(name))); },
      contains(name) { return read().includes(name); },
      toggle(name, force) {
        const has = read().includes(name);
        const shouldAdd = force === undefined ? !has : Boolean(force);
        if (shouldAdd && !has) write([...read(), name]);
        if (!shouldAdd && has) write(read().filter((item) => item !== name));
        return shouldAdd;
      },
      item(index) { return read()[index] || null; },
      get length() { return read().length; },
      toString() { return element.className; },
    };
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  /** DOM Element.append(...nodes | strings) — chuỗi được thêm dưới dạng text node. */
  append(...items) {
    for (const item of items) {
      if (item instanceof Element) this.appendChild(item);
      else if (item !== null && item !== undefined) {
        this.childNodes.push({ nodeType: 3, nodeValue: String(item), parentNode: this });
      }
    }
  }
  prepend(...items) {
    const before = this.childNodes.length;
    this.append(...items);
    const added = this.childNodes.splice(before);
    this.childNodes.unshift(...added);
  }
  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  get firstChild() { return this.childNodes[0] || null; }

  get textContent() {
    if (!this.childNodes.length) return "";
    return this.childNodes.map((node) => (node.nodeType === 3 ? node.nodeValue : node.textContent)).join("");
  }
  set textContent(value) {
    this.childNodes = [];
    this._innerHTML = "";
    const text = String(value);
    if (text) this.childNodes.push({ nodeType: 3, nodeValue: text });
  }

  normalizeRelations() {
    const walk = (node, parent) => {
      node.parentNode = parent;
      for (const child of node.children) walk(child, node);
    };
    walk(this, this.parentNode);
    return this;
  }

  get innerHTML() { return this._innerHTML; }
  get innerText() { return this.textContent; }
  set innerText(value) { this.textContent = value; }
  set innerHTML(html) {
    this._innerHTML = String(html);
    this.childNodes = [];
    parseFragment(this._innerHTML, this);
  }
  insertAdjacentHTML(_position, html) {
    parseFragment(String(html), this);
  }

  matches(selector) {
    const trimmed = selector.trim();
    if (trimmed === "*") return true;
    if (/\s/.test(trimmed)) {
      // Descendant selector: ".a .b" -> match ".b" having an ancestor ".a".
      const parts = trimmed.split(/\s+/);
      const leaf = parts.pop();
      if (!this.matches(leaf)) return false;
      let current = this.parentElement;
      let need = parts.length - 1;
      while (current && need >= 0) {
        if (current.matches(parts[need])) need -= 1;
        current = current.parentElement;
      }
      return need < 0;
    }
    const compound = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+|#[\w-]+|\[[^\]]+\])*)$/.exec(trimmed);
    if (compound) {
      const [, tag, rest] = compound;
      if (tag && this.localName !== tag.toLowerCase()) return false;
      const tokens = rest.match(/\.[\w-]+|#[\w-]+|\[[^\]]+\]/g) || [];
      return tokens.every((token) => {
        if (token.startsWith(".")) return this.classList.contains(token.slice(1));
        if (token.startsWith("#")) return this.getAttribute("id") === token.slice(1);
        const attr = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(token);
        if (!attr) return false;
        if (!this.hasAttribute(attr[1])) return false;
        return attr[2] === undefined || this.getAttribute(attr[1]) === attr[2];
      });
    }
    throw new Error(`[html-dom] Unsupported selector: "${selector}"`);
  }

  closest(selector) {
    for (let node = this; node instanceof Element; ) {
      if (node.matches(selector)) return node;
      const parent = node.parentNode;
      node = parent instanceof Element ? parent : null;
    }
    return null;
  }

  querySelectorAll(selector) {
    const parts = selector.split(",").map((part) => part.trim()).filter(Boolean);
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (parts.some((part) => child.matches(part))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getElementsByTagName(tag) { return this.querySelectorAll(tag); }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const list = this._listeners.get(type) || [];
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }

  dispatchEvent(event) {
    if (!event.relatedTarget) event.relatedTarget = this;
    if (!event.target) event.target = this;
    let node = this;
    if (!event.bubbles) {
      event.currentTarget = this;
      for (const handler of [...(this._listeners.get(event.type) || [])]) handler.call(this, event);
      return !event.defaultPrevented;
    }
    while (node) {
      if (node instanceof Element || node instanceof Document || node instanceof Window) {
        event.currentTarget = node;
        for (const handler of [...(node._listeners.get(event.type) || [])]) handler.call(node, event);
      }
      node = node.parentNode || null;
    }
    return !event.defaultPrevented;
  }
}

export class Document extends Element {
  constructor() {
    super(null, "#document");
    this.nodeType = 9;
    this.ownerDocument = this;
    this._listeners = new Map();
    this._title = "";
  }
  get title() { return this._title; }
  set title(value) { this._title = String(value); }
  get readyState() { return "complete"; }
  addEventListener() {}
  get documentElement() { return this.querySelector("html"); }
  get body() { return this.querySelector("body"); }
  get head() { return this.querySelector("head"); }
  getElementById(id) {
    return this.querySelectorAll("*").find((el) => el.getAttribute("id") === id) || null;
  }
  /** Tạo phần tử mới (chưa gắn vào DOM). */
  createElement(tagName) {
    const tag = String(tagName).toLowerCase();
    const Base = tag === "form" ? HTMLFormElement : tag === "option" ? HTMLOptionElement : Element;
    return new Base(this, tag);
  }
  createTextNode(text) {
    return { nodeType: 3, nodeValue: String(text), parentNode: null };
  }
}

export class Window {
  constructor() {
    this._listeners = new Map();
    this.document = null;
  }
  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const list = this._listeners.get(type) || [];
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const handler of [...(this._listeners.get(event.type) || [])]) handler.call(this, event);
    return !event.defaultPrevented;
  }
}

export class FormData {
  constructor(form) {
    this._form = form;
  }
  entries() {
    const pairs = this._form.querySelectorAll("[name]")
      .filter((el) => ["input", "textarea", "select"].includes(el.localName))
      .map((el) => [el.getAttribute("name"), el.value]);
    return pairs[Symbol.iterator]();
  }
}

/* ---------------------------------------------------------------------- *
 * HTML parsing
 * ---------------------------------------------------------------------- */

class HTMLOptionElement extends Element {
  constructor(doc, localName = "option", value = "") {
    super(doc, localName);
    // `option.value` là thuộc tính DOM (không phải attribute): Element lưu giá trị
    // trong `_value`, nên khởi tạo bằng chuỗi ('' nếu markup không có value).
    this._value = String(value);
  }
  get value() {
    // Không có attribute value -> trình duyệt dùng text của option.
    if (!this.hasAttribute("value")) return this.textContent.trim();
    return this._value;
  }
  set value(next) {
    this._value = String(next);
    this.setAttribute("value", this._value);
  }
  get text() { return this.textContent; }
  set text(value) { this.textContent = value; }
  get selected() { return this.hasAttribute("selected"); }
  set selected(value) {
    if (value) this.setAttribute("selected", "");
    else this.removeAttribute("selected");
  }
}

function parseAttributes(source) {
  const attributes = [];
  const pattern = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    attributes.push([match[1].toLowerCase(), decodeEntities(match[2] ?? match[3] ?? match[4] ?? "")]);
  }
  return attributes;
}

function createElement(doc, tagName) {
  const Base = tagName === "form" ? HTMLFormElement : tagName === "option" ? HTMLOptionElement : Element;
  return new Base(doc, tagName);
}

export function parseFragment(html, parent) {
  const doc = parent.ownerDocument;
  const stack = [parent];
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>/g;
  let cursor = 0;
  let token;

  const appendText = (text) => {
    if (text) stack[stack.length - 1].childNodes.push({ nodeType: 3, nodeValue: decodeEntities(text) });
  };

  while ((token = tokenPattern.exec(html)) !== null) {
    appendText(html.slice(cursor, token.index));
    cursor = tokenPattern.lastIndex;
    const raw = token[0];
    if (raw.startsWith("<!--") || raw.startsWith("<!")) continue;

    const isEnd = raw.startsWith("</");
    const body = raw.slice(isEnd ? 2 : 1, -1);
    const tagName = (/^[^\s/>]+/.exec(body) || [""])[0].toLowerCase();
    if (!tagName) continue;

    if (isEnd) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].localName === tagName) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const selfClosing = /\/\s*$/.test(body);
    const el = createElement(doc, tagName);
    for (const [name, value] of parseAttributes(body.slice(tagName.length).replace(/\/\s*$/, ""))) {
      el.setAttribute(name, value);
    }
    stack[stack.length - 1].appendChild(el);
    if (!selfClosing && !VOID_TAGS.has(tagName)) stack.push(el);
    if (!selfClosing && RAW_TEXT.has(tagName)) {
      // Skip to the matching end tag; <script> content cannot be parsed as HTML.
      const closeIndex = html.toLowerCase().indexOf("</" + tagName, tokenPattern.lastIndex);
      const end = closeIndex === -1 ? html.length : closeIndex;
      appendText(html.slice(tokenPattern.lastIndex, end));
      tokenPattern.lastIndex = end;
      cursor = end;
    }
  }
  appendText(html.slice(cursor));
  return parent;
}

class HTMLFormElement extends Element {
  get elements() {
    const controls = this.querySelectorAll("input, textarea, select");
    const named = {};
    for (const control of controls) if (control.name) named[control.name] = control;
    named.length = controls.length;
    return new Proxy(named, {
      get(target, prop) {
        if (typeof prop === "string" && /^\d+$/.test(prop)) return controls[Number(prop)];
        return target[prop];
      },
    });
  }
  get invalidControls() {
    return this.querySelectorAll("input, textarea, select").filter((el) => {
      if (!el.hasAttribute("required") || el.readOnly) return false;
      return String(el.value).trim() === "";
    });
  }
  checkValidity() { return this.invalidControls.length === 0; }
  reportValidity() { return this.checkValidity(); }
  reset() {
    for (const control of this.querySelectorAll("input, textarea, select")) {
      if (control.localName === "select") {
        const options = control.options;
        const selected = options.find((option) => option.hasAttribute("selected")) || options[0];
        control.value = selected ? selected.getAttribute("value") || "" : "";
      } else {
        control.value = "";
      }
    }
  }
  submit() {
    this.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }
}

/** Parse a full HTML document into a Document. */
export function parseDocument(htmlSource) {
  const document = new Document();
  if (htmlSource) parseFragment(htmlSource, document);
  return document;
}
