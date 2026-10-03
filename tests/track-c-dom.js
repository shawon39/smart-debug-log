'use strict';
// Test helper (not a test file): a very small DOM plus a loader that runs the dashboard's classic
// scripts in a vm context with a mocked chrome API, a controllable clock and manual timers.
// Built only on Node's standard library so `node --test` needs no npm packages.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

const decodeEntities = s => s.replace(/&(lt|gt|amp|quot|#39|apos|nbsp);/g, (m, e) => ENTITIES[e]);
const escapeText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const toKebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

class FakeEventTarget {
  constructor() { this._listeners = {}; }
  addEventListener(type, fn, options = {}) {
    const opts = typeof options === 'object' ? options : {};
    if (opts.signal?.aborted) return;
    (this._listeners[type] ||= []).push({ fn, once: !!opts.once });
    if (opts.signal) opts.signal.addEventListener('abort', () => this.removeEventListener(type, fn));
  }
  removeEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] || []).filter(l => l.fn !== fn);
  }
  listenerCount(type) { return (this._listeners[type] || []).length; }
  _fire(event) {
    for (const l of (this._listeners[event.type] || []).slice()) {
      event.currentTarget = this;
      if (l.once) this.removeEventListener(event.type, l.fn);
      l.fn.call(this, event);
    }
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    let node = this;
    while (node) {
      node._fire(event);
      if (event._stopped || event.bubbles === false) break;
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }
}

function makeEvent(type, props = {}) {
  return {
    type, bubbles: true, defaultPrevented: false, ...props,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stopped = true; }
  };
}

class FakeText {
  constructor(data) { this.nodeType = 3; this.data = String(data); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

// Attributes that are read and written as properties
const REFLECTED = ['id', 'title', 'type', 'placeholder', 'min', 'name', 'href', 'download', 'accept'];

class FakeElement extends FakeEventTarget {
  constructor(tag, doc) {
    super();
    this.nodeType = 1;
    this.localName = tag.toLowerCase();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.attributes = {};
    this.childNodes = [];
    this.parentNode = null;
    this.style = {};
    const el = this;
    this.dataset = new Proxy({}, {
      get: (_, prop) => typeof prop === 'string' ? (el.getAttribute('data-' + toKebab(prop)) ?? undefined) : undefined,
      set: (_, prop, value) => { el.setAttribute('data-' + toKebab(prop), String(value)); return true; },
      has: (_, prop) => el.hasAttribute('data-' + toKebab(String(prop))),
      deleteProperty: (_, prop) => { el.removeAttribute('data-' + toKebab(String(prop))); return true; }
    });
    this.classList = {
      contains: c => el.className.split(/\s+/).includes(c),
      add: (...cs) => { const l = el.className.split(/\s+/).filter(Boolean); cs.forEach(c => { if (!l.includes(c)) l.push(c); }); el.className = l.join(' '); },
      remove: (...cs) => { el.className = el.className.split(/\s+/).filter(c => c && !cs.includes(c)).join(' '); },
      toggle: (c, force) => { const on = force === undefined ? !el.classList.contains(c) : !!force; on ? el.classList.add(c) : el.classList.remove(c); return on; }
    };
  }

  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }

  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { v ? this.setAttribute('hidden', '') : this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { v ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'); }
  get checked() { return this._checked !== undefined ? this._checked : this.hasAttribute('checked'); }
  set checked(v) { this._checked = !!v; }

  get options() { return this.querySelectorAll('option'); }
  get value() {
    if (this.localName === 'select') {
      const options = this.options;
      const wanted = this._value !== undefined ? options.find(o => o.value === this._value) : options.find(o => o.hasAttribute('selected'));
      return (wanted || (this._value === undefined ? options[0] : null))?.value ?? '';
    }
    if (this._value !== undefined) return this._value;
    if (this.localName === 'option') return this.getAttribute('value') ?? this.textContent;
    if (this.localName === 'textarea') return this.textContent;
    return this.getAttribute('value') ?? '';
  }
  set value(v) { this._value = String(v); }

  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this._setChildren(v === '' || v == null ? [] : [new FakeText(v)]); }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(html) { this._setChildren(parseHTML(String(html), this.ownerDocument)); }

  _setChildren(nodes) {
    this.childNodes.forEach(n => { n.parentNode = null; });
    this.childNodes = [];
    nodes.forEach(n => this.appendChild(n));
  }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  append(...nodes) { nodes.forEach(n => this.appendChild(typeof n === 'string' ? new FakeText(n) : n)); }
  insertBefore(node, ref) {
    if (!ref) return this.appendChild(node);
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, node);
    return node;
  }
  removeChild(node) {
    this.childNodes = this.childNodes.filter(n => n !== node);
    node.parentNode = null;
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }

  _descendants() {
    const out = [];
    const walk = el => el.childNodes.forEach(n => { if (n.nodeType === 1) { out.push(n); walk(n); } });
    walk(this);
    return out;
  }
  querySelectorAll(selector) { return this._descendants().filter(el => el.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  matches(selector) { return selector.split(',').some(sel => matchesComplex(this, sel.trim().split(/\s+/))); }
  closest(selector) {
    for (let el = this; el && el.nodeType === 1; el = el.parentNode) if (el.matches(selector)) return el;
    return null;
  }

  click() { this.dispatchEvent(makeEvent('click')); }
  focus() {
    if (this.ownerDocument.activeElement === this) return;
    this.ownerDocument.activeElement = this;
    this.dispatchEvent(makeEvent('focus', { bubbles: false }));
  }
  blur() {}
  select() {}
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  setCustomValidity(message) { this.validationMessage = message; }
}

for (const attr of REFLECTED) {
  Object.defineProperty(FakeElement.prototype, attr, {
    get() { return this.getAttribute(attr) ?? ''; },
    set(value) { this.setAttribute(attr, value); }
  });
}

function serialize(node) {
  if (node.nodeType === 3) return escapeText(node.data);
  const attrs = Object.entries(node.attributes)
    .map(([k, v]) => v === '' ? ` ${k}` : ` ${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
  if (VOID_TAGS.has(node.localName)) return `<${node.localName}${attrs}>`;
  return `<${node.localName}${attrs}>${node.childNodes.map(serialize).join('')}</${node.localName}>`;
}

// Enough of an HTML parser for the extension's own well-formed markup
function parseHTML(html, doc) {
  const root = new FakeElement('#fragment', doc);
  const stack = [root];
  const tokenRe = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)([^>]*?)(\/?)>|[^<]+|</gi;
  let m;
  while ((m = tokenRe.exec(html))) {
    const [token, closeTag, openTag, attrText, selfClose] = m;
    const top = stack[stack.length - 1];
    if (token.startsWith('<!')) continue;
    if (closeTag) {
      const name = closeTag.toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].localName === name) { stack.length = i; break; }
      continue;
    }
    if (openTag) {
      const el = new FakeElement(openTag, doc);
      const attrRe = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = attrRe.exec(attrText))) el.setAttribute(a[1], decodeEntities(a[2] ?? a[3] ?? a[4] ?? ''));
      top.appendChild(el);
      if (!selfClose && !VOID_TAGS.has(el.localName)) stack.push(el);
      continue;
    }
    top.appendChild(new FakeText(decodeEntities(token)));
  }
  return root.childNodes.slice();
}

// Simple selectors: tag, #id, .class, [attr], [attr="value"], :empty, joined by descendant spaces
function matchesCompound(el, compound) {
  const re = /^([a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|:([\w-]+)/g;
  let m, consumed = 0;
  while ((m = re.exec(compound)) && m[0]) {
    consumed += m[0].length;
    if (m[1] && m[1] !== '*' && el.localName !== m[1].toLowerCase()) return false;
    if (m[2] && el.id !== m[2]) return false;
    if (m[3] && !el.classList.contains(m[3])) return false;
    if (m[4]) {
      const expected = m[5] ?? m[6] ?? m[7];
      if (!el.hasAttribute(m[4]) || (expected !== undefined && el.getAttribute(m[4]) !== expected)) return false;
    }
    if (m[8] === 'empty' && el.childNodes.length > 0) return false;
    if (m[8] && m[8] !== 'empty') return false;
  }
  return consumed === compound.length;
}

function matchesComplex(el, parts) {
  if (!matchesCompound(el, parts[parts.length - 1])) return false;
  let rest = parts.slice(0, -1);
  for (let node = el.parentNode; rest.length && node && node.nodeType === 1; node = node.parentNode) {
    if (matchesCompound(node, rest[rest.length - 1])) rest = rest.slice(0, -1);
  }
  return rest.length === 0;
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.body = new FakeElement('body', this);
    this.body.parentNode = this;
    this.activeElement = this.body;
  }
  createElement(tag) { return new FakeElement(tag, this); }
  getElementById(id) { return this.body._descendants().find(el => el.id === id) || null; }
  querySelector(selector) { return this.body.querySelector(selector); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
}

// Body markup of the real dashboard.html (scripts are not run)
function dashboardBody() {
  const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
  return html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>')).replace(/<script[^>]*><\/script>/g, '');
}

const plain = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * Loads classic scripts (paths relative to the repo) into a fresh vm context.
 * options: html (body markup), search (location.search), now (ms), handler(message) for
 * chrome.runtime.sendMessage, storage (initial chrome.storage.local), confirm (bool or fn).
 */
function loadScripts(files, options = {}) {
  const document = new FakeDocument();
  if (options.html !== undefined) document.body.innerHTML = options.html;

  const sent = [], alerts = [], confirms = [], consoleErrors = [];
  const clock = { now: options.now ?? Date.UTC(2026, 9, 3, 10, 0, 0) };
  const storageData = plain(options.storage || {});
  const timers = new Map();
  let timerSeq = 0;
  const handler = options.handler || (async () => ({ success: true, data: {} }));
  const windowTarget = new FakeEventTarget();

  const ctx = {
    // Quiet console: errors are kept for assertions instead of printed
    console: { log() {}, info() {}, debug() {}, warn() {}, error: (...args) => { consoleErrors.push(args.map(String).join(' ')); } },
    URLSearchParams, AbortController, JSON, Math, Promise,
    document,
    location: { search: options.search ?? '?host=acme.my.salesforce.com' },
    alert: message => { alerts.push(message); },
    confirm: message => { confirms.push(message); return typeof options.confirm === 'function' ? options.confirm(message) : options.confirm !== false; },
    setTimeout: (fn, ms) => { timers.set(++timerSeq, { fn, ms }); return timerSeq; },
    clearTimeout: id => { timers.delete(id); },
    setInterval: (fn, ms) => { timers.set(++timerSeq, { fn, ms, repeat: true }); return timerSeq; },
    clearInterval: id => { timers.delete(id); },
    requestAnimationFrame: fn => { fn(); return 0; },
    getComputedStyle: () => ({ lineHeight: '22px' }),
    addEventListener: (...args) => windowTarget.addEventListener(...args),
    removeEventListener: (...args) => windowTarget.removeEventListener(...args),
    chrome: {
      runtime: {
        id: 'test',
        sendMessage: async message => { sent.push(plain(message)); return plain(await handler(plain(message))); },
        onMessage: { addListener() {} }
      },
      storage: {
        local: {
          get: async keys => {
            if (keys == null) return plain(storageData);
            const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
            const out = {};
            list.forEach(k => { if (k in storageData) out[k] = plain(storageData[k]); });
            return out;
          },
          set: async items => { Object.assign(storageData, plain(items)); },
          remove: async keys => { [].concat(keys).forEach(k => { delete storageData[k]; }); }
        }
      }
    },
    __clock: clock
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`(() => {
    const RealDate = Date;
    const clock = globalThis.__clock;
    globalThis.Date = class extends RealDate {
      constructor(...args) { if (args.length === 0) super(clock.now); else super(...args); }
      static now() { return clock.now; }
    };
  })();`, ctx);

  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }

  return {
    ctx, document, sent, alerts, confirms, consoleErrors, clock, storageData, timers, windowTarget,
    get: expression => vm.runInContext(expression, ctx),
    // Runs the pending setTimeout callbacks once (intervals stay registered)
    runTimeouts() {
      for (const [id, t] of [...timers]) if (!t.repeat) { timers.delete(id); t.fn(); }
    },
    key(target, key) { target.dispatchEvent(makeEvent('keydown', { key })); },
    input(target, value) { target.value = value; target.dispatchEvent(makeEvent('input')); },
    change(target) { target.dispatchEvent(makeEvent('change')); }
  };
}

// Lets pending promise chains (mocked chrome calls) finish
async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve));
}

module.exports = { loadScripts, dashboardBody, flush, plain, makeEvent, ROOT };
