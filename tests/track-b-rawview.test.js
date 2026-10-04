// Track B: raw view rendering and search (escaping, search marks, rendering big logs in steps).
// Run: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function escapeLikeDom(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;'); }

// The raw view container: keeps its HTML as a string and knows which search match is "current"
function fakeContainer() {
  return {
    html: '', current: null, isConnected: true,
    set innerHTML(value) { this.html = value; },
    get innerHTML() { return this.html; },
    insertAdjacentHTML(position, value) { this.html += value; },
    querySelector(selector) {
      if (selector === '.search-highlight.current') {
        return this.current === null ? null : { classList: { remove: () => { this.current = null; } } };
      }
      const m = selector.match(/data-match-index="(\d+)"/);
      if (m && this.html.includes(`data-match-index="${m[1]}"`)) {
        return { classList: { add: () => { this.current = Number(m[1]); } } };
      }
      return null;
    },
  };
}

function loadRawView() {
  const timers = [];
  const document = {
    createElement(tag) {
      const el = { _t: '' };
      Object.defineProperty(el, 'textContent', { set(v) { this._t = String(v); }, get() { return this._t; } });
      Object.defineProperty(el, 'innerHTML', { set(v) { this._t = v; }, get() { return escapeLikeDom(this._t); } });
      return el;
    },
    getElementById() { return null; }, querySelectorAll() { return []; }, addEventListener() {},
    querySelector(selector) { return selector === '.search-highlight.current' ? { scrollIntoView() {} } : null; },
  };
  const ctx = {
    document, console, URLSearchParams,
    // Timers run only when the test flushes them
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: (id) => { if (id) timers[id - 1] = null; },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, length: 0, key() { return null; } },
    chrome: { runtime: { onMessage: { addListener() {} } } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['core/icons.js', 'core/basic-utilities.js', 'logs/basic-parsing.js', 'logs/complex-parsing.js', 'logs/salesforce-response-cleaner.js',
    'logs/formatting-utilities.js', 'logs/error-extraction.js', 'logs/syntax-highlighting.js', 'logs/log-parsing.js', 'logs/raw-view.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  }
  const container = fakeContainer();
  ctx.__container = container;
  vm.runInContext(`var showToast = () => {}; var currentRawResponse = null;
    var elements = { debugContent: { querySelector: (s) => s === '.raw-response-container' ? __container : null },
      searchResultsInfo: { textContent: '' }, searchPrevBtn: {}, searchNextBtn: {} };
    isRawView = true;`, ctx);
  const run = (code) => vm.runInContext(code, ctx);
  const flushTimers = () => {
    for (let i = 0; i < timers.length; i++) {
      const fn = timers[i];
      timers[i] = null;
      if (fn) fn();
    }
  };
  return { ctx, run, container, flushTimers, timers };
}

// Visible text of rendered HTML
const textOf = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const line = (i, msg) => `12:00:00.${String(i % 1000).padStart(3, '0')} (${i})|USER_DEBUG|[${i % 50}]|DEBUG|${msg}`;

test('S1: search in a log over 100 KB shows tags from the log as text', () => {
  const { ctx, run, container, flushTimers } = loadRawView();
  const evil = line(1, '<img src=x onerror=alert(1)><iframe src="https://evil.example"></iframe><form action=x>');
  ctx.__text = [evil, ...Array.from({ length: 2500 }, (_, i) => line(i + 2, 'filler value ' + i)), line(9999, 'needle here')].join('\n');
  assert.ok(ctx.__text.length > 100000);
  run('currentRawResponse = __text; performSearch("needle")');
  flushTimers();
  assert.ok(!/<img|<iframe|<form/i.test(container.html), 'no tag from the log may reach the page');
  assert.ok(container.html.includes('&lt;img src=x onerror=alert(1)&gt;&lt;iframe src="https://evil.example"&gt;&lt;/iframe&gt;'));
  assert.match(container.html, /<span class="search-highlight" data-match-index="0">needle<\/span>/);
  assert.strictEqual(textOf(container.html), ctx.__text);
});

test('S7: raw view highlighting escapes tags and keeps event names and timestamps', () => {
  const { ctx, run, container } = loadRawView();
  ctx.__text = line(1, '<div class="modal-overlay">Session expired</div></pre></div>');
  run('currentRawResponse = __text; renderRawContent(__container, __text)');
  assert.ok(!container.html.includes('<div') && !container.html.includes('</pre>'));
  assert.ok(container.html.startsWith('<span class="debug-timestamp">12:00:00.001 (1)</span>|<span class="debug-operation">USER_DEBUG</span>|'));
  assert.strictEqual(textOf(container.html), ctx.__text);
});

test('P5: searching a digit does not break the markup', () => {
  const { ctx, run, container } = loadRawView();
  ctx.__text = ['12:00:00.001 (1000)|LIMIT_USAGE_FOR_NS|(default)|', '  Number of SOQL queries: 5 out of 100', line(2, 'hi 5')].join('\n');
  run('currentRawResponse = __text; performSearch("5")');
  assert.ok(!/PROTECTED_MARKER||/.test(container.html));
  assert.strictEqual((container.html.match(/<span/g) || []).length, (container.html.match(/<\/span>/g) || []).length, 'spans are balanced');
  assert.strictEqual(textOf(container.html), ctx.__text);
  assert.strictEqual(run('searchMatches.length'), 2);
});

test('P5: overlapping matches do not repeat text (small and big logs)', () => {
  for (const filler of [0, 120000]) {
    const { ctx, run, container, flushTimers } = loadRawView();
    ctx.__text = 'aaa\n' + 'b'.repeat(filler);
    run('currentRawResponse = __text; performSearch("aa")');
    flushTimers();
    assert.strictEqual(run('searchMatches.length'), 1);
    assert.strictEqual(textOf(container.html), ctx.__text);
  }
});

test('P5: log text that contains the search mark characters cannot open or close spans', () => {
  const { ctx, run, container } = loadRawView();
  ctx.__text = line(1, 'odd  chars  here and a match');
  run('currentRawResponse = __text; performSearch("match")');
  assert.strictEqual((container.html.match(/<span class="search-highlight"/g) || []).length, 1);
  assert.strictEqual((container.html.match(/<span/g) || []).length, (container.html.match(/<\/span>/g) || []).length);
});

test('R2: a big log is rendered in steps, search and navigation still work', () => {
  const { ctx, run, container, flushTimers } = loadRawView();
  ctx.__text = Array.from({ length: 20000 }, (_, i) => line(i, `value ${i} out of 100`)).join('\n'); // about 1 MB
  run('currentRawResponse = __text; renderRawContent(__container, __text)');
  const firstStep = textOf(container.html).length;
  assert.ok(firstStep > 0 && firstStep < 300 * 1024, `first step renders one slice (${firstStep} chars)`);
  flushTimers();
  assert.strictEqual(textOf(container.html), ctx.__text, 'all slices together are the whole log');

  // Search: the last match is in a slice that is not rendered yet; moving to it renders it right away
  run('performSearch("value 19999 ")');
  assert.strictEqual(run('searchMatches.length'), 1);
  assert.strictEqual(container.current, 0, 'the match is rendered and marked current');
  // Copy and search use the original text, not a copy stored on the element
  assert.ok(!('dataset' in container) || !container.dataset.originalText);
});

test('R2: a newer render stops the older one', () => {
  const { ctx, run, container, flushTimers } = loadRawView();
  ctx.__big = Array.from({ length: 20000 }, (_, i) => line(i, 'old ' + i)).join('\n');
  ctx.__small = line(1, 'new log');
  run('renderRawContent(__container, __big); renderRawContent(__container, __small)');
  flushTimers();
  assert.strictEqual(textOf(container.html), ctx.__small);
});

test('raw JSON: a search match inside a string keeps the spans nested', () => {
  const { ctx, run, container } = loadRawView();
  ctx.__text = '{"name": "Acme Corp", "n": 5}';
  run('currentRawResponse = __text; performSearch("e Co")');
  assert.strictEqual((container.html.match(/<span/g) || []).length, (container.html.match(/<\/span>/g) || []).length);
  assert.match(container.html, /<span class="search-highlight" data-match-index="0">e Co<\/span>/);
  assert.strictEqual(textOf(container.html), ctx.__text);
});
