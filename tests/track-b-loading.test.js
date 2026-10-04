// Track B: loading logs, caches, log list search, refresh, and tab/org selection.
// Loads the dashboard's classic scripts into a vm context with small DOM and chrome stand-ins.
// Run: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const EXTENSION_URL = 'chrome-extension://abcdefghijklmnop/';
const DAY = 24 * 60 * 60 * 1000;

function fakeElement(name, registry = null) {
  const classes = new Set();
  const children = {};
  const el = {
    name, innerHTML: '', textContent: '', value: '', checked: true, dataset: {}, style: {}, isConnected: true,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c),
    },
    child(selector) { return children[selector] || (children[selector] = fakeElement(selector, registry)); },
    querySelector(selector) { return el.child(selector); },
    getAttribute(attribute) { return attribute === 'data-log-id' ? el.name : null; }, // log items are named by their log id
    addEventListener() {}, removeEventListener() {}, insertAdjacentHTML(pos, html) { el.innerHTML += html; },
    // Inserting an element with an id makes document.getElementById find it
    parentNode: { insertBefore(node) { if (registry && node.id) registry[node.id] = node; } },
    remove() { if (registry && el.id && registry[el.id] === el) delete registry[el.id]; },
  };
  return el;
}

// Arrays and objects made inside the vm have other prototypes; compare them as plain data
const plain = (value) => JSON.parse(JSON.stringify(value));

function makeDashboard({ respond = () => ({ success: true, data: { records: [] } }), tabs = [], storage = {}, host = 'acme.my.salesforce.com', urlHost = host } = {}) {
  const sent = [];
  const store = { ...storage };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { if (localStorage.failWrites && localStorage.failWrites(k, v)) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
  const byId = {};
  const getEl = (id) => byId[id] || (byId[id] = fakeElement(id, byId));
  ['logsLoading', 'emptyState', 'logsList', 'welcomeState', 'limitsWelcomeState', 'debugContentPanel', 'debugContent', 'errorContent',
    'limitsContent', 'errorAndLimitsContent', 'selectedLogId', 'toggleViewBtn', 'logLimit', 'logTypeFilter', 'connectionStatusText',
    'logSearchResults', 'autoRefreshToggle'].forEach(getEl);
  const emptyState = getEl('emptyState');
  emptyState.child('h4').textContent = 'No debug logs yet';
  emptyState.child('p').textContent = 'Turn on a trace flag, then run your code';
  getEl('logTypeFilter').value = 'Monitoring';
  const logItems = {};
  const document = {
    createElement(tag) {
      // escapeHtml sets textContent and reads innerHTML; the "See more" button sets innerHTML and queries it
      const el = fakeElement(tag, byId);
      let text = null;
      let html = '';
      Object.defineProperty(el, 'textContent', { set(v) { text = String(v); }, get() { return text ?? ''; } });
      Object.defineProperty(el, 'innerHTML', {
        set(v) { html = v; text = null; },
        get() { return text !== null ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : html; },
      });
      if (tag === 'textarea') Object.defineProperty(el, 'value', { get() { return html; } });
      return el;
    },
    getElementById: (id) => byId[id] || null,
    querySelector: (selector) => {
      const m = selector.match(/data-log-id="([^"]+)"/);
      return m ? (logItems[m[1]] || null) : null;
    },
    // The rendered log list: one element per data-log-id in #logsList (same object for the same id)
    querySelectorAll: (selector) => selector === '.log-item'
      ? [...getEl('logsList').innerHTML.matchAll(/data-log-id="([^"]+)"/g)].map(m => logItems[m[1]] || (logItems[m[1]] = fakeElement(m[1])))
      : [],
    addEventListener() {},
  };
  const listeners = { focus: [], message: [] };
  const timers = [];
  const ctx = {
    document, console, localStorage, URL, URLSearchParams, Date, Promise,
    location: { search: urlHost ? `?host=${urlHost}` : '' },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},
    addEventListener: (type, fn) => { if (listeners[type]) listeners[type].push(fn); },
    chrome: {
      runtime: {
        getURL: (p) => EXTENSION_URL + p,
        sendMessage: async (msg) => { sent.push(msg); return respond(msg); },
        onMessage: { addListener: (fn) => listeners.message.push(fn) },
      },
      tabs: { query: async () => tabs, sendMessage: async () => ({ success: true }) },
      storage: { local: { get: async () => ({}), set: async () => {} } },
      scripting: { executeScript: async () => [] },
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['icons.js', 'basic-utilities.js', 'basic-parsing.js', 'complex-parsing.js', 'salesforce-response-cleaner.js',
    'formatting-utilities.js', 'error-extraction.js', 'syntax-highlighting.js', 'log-parsing.js', 'error-handler.js', 'log-cache.js',
    'tab-manager.js', 'log-loader.js', 'log-renderer.js', 'log-display.js', 'raw-view.js', 'dashboard-connection.js', 'dashboard-init.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  }
  // What dashboard-init does on DOMContentLoaded, plus functions from files not loaded here
  ctx.__getEl = getEl;
  vm.runInContext(`
    var toasts = []; showToast = (m) => toasts.push(m);
    var clearRawResponse = () => { currentRawResponse = null; };
    var checkOAuthTokenStatus = () => {};
    elements = {
      logsLoading: __getEl('logsLoading'), emptyState: __getEl('emptyState'), logsList: __getEl('logsList'),
      welcomeState: __getEl('welcomeState'), limitsWelcomeState: __getEl('limitsWelcomeState'), debugContentPanel: __getEl('debugContentPanel'),
      debugContent: __getEl('debugContent'), errorContent: __getEl('errorContent'), limitsContent: __getEl('limitsContent'),
      errorAndLimitsContent: __getEl('errorAndLimitsContent'), selectedLogIdElement: __getEl('selectedLogId'),
      toggleViewBtn: __getEl('toggleViewBtn'), logLimit: __getEl('logLimit'), logTypeFilter: __getEl('logTypeFilter'),
      connectionStatusText: __getEl('connectionStatusText')
    };
    elements.logLimit.value = '15';
    currentSession = { orgId: '00D000000000001', organizationId: '00D000000000001', key: 'sid' };
    sfHost = '${host}';
  `, ctx);
  const run = (code) => vm.runInContext(code, ctx);
  const flushTimers = () => { while (timers.length) timers.shift().fn(); };
  return { ctx, run, sent, store, localStorage, getEl, listeners, timers, flushTimers, logItems };
}

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace('Z', '+0000');
const apexLog = (i, msAgo = i * 60000, location = 'Monitoring') => ({ Id: `07L${String(i).padStart(12, '0')}`, StartTime: iso(msAgo), Location: location, Operation: 'Api', LogLength: 100 });

test('S9: Salesforce URLs are checked by host name, not by text anywhere in the URL', () => {
  const { run } = makeDashboard();
  const isSf = (url) => run(`isSalesforceUrl(${JSON.stringify(url)})`);
  for (const url of ['https://acme.my.salesforce.com/x', 'https://acme.lightning.force.com/lightning/page/home', 'https://acme--c.vf.force.com/apex/P',
    'https://acme--c.visualforce.com/apex/P', 'https://acme.my.salesforce-setup.com/', 'https://acme.my.salesforce.mil', 'https://x.cloudforce.com/', 'https://x.sfcrmproducts.cn/']) {
    assert.strictEqual(isSf(url), true, url);
  }
  for (const url of ['https://evil.example/?next=.salesforce.com', 'https://salesforce.com.evil.example/', 'https://evilforce.com/', 'https://notsalesforce.com/',
    `${EXTENSION_URL}dashboard.html?host=acme.my.salesforce.com`, 'not a url', '']) {
    assert.strictEqual(isSf(url), false, url);
  }
});

test('S9: the dashboard page with ?host= still counts as a Salesforce tab for finding the session', async () => {
  const tabs = [{ id: 1, url: `${EXTENSION_URL}dashboard.html?host=acme.my.salesforce.com` }, { id: 2, url: 'https://evil.example/?a=.force.com' },
    { id: 3, url: `${EXTENSION_URL}dashboard.html?host=evil.example` }, { id: 4, url: 'https://acme.lightning.force.com/' }];
  const { run } = makeDashboard({ tabs });
  const ids = plain(await run('getSalesforceTabs()')).map(t => t.id);
  assert.deepStrictEqual(ids, [1, 4]);
});

test('S6: queries use only tabs of the same org, never extension pages or other orgs', async () => {
  const tabs = [
    { id: 1, url: 'https://other.my.salesforce.com/', lastAccessed: 9 },
    { id: 2, url: `${EXTENSION_URL}dashboard.html?host=acme.my.salesforce.com`, lastAccessed: 8 },
    { id: 3, url: 'https://acme.lightning.force.com/lightning/page/home', lastAccessed: 7 },
    { id: 4, url: 'https://acme--c.vf.force.com/apex/Page', lastAccessed: 5 },
    { id: 5, url: 'https://acme.my.salesforce.com/setup', lastAccessed: 1 },
    { id: 6, url: 'https://acme2.lightning.force.com/', lastAccessed: 6 },
  ];
  const { run } = makeDashboard({ tabs });
  const ids = plain(await run('tabManager.getOrderedSalesforceTabs("acme.my.salesforce.com")')).map(t => t.id);
  assert.deepStrictEqual(ids, [5, 3, 4], 'exact host first, then the same org by last use');
  assert.deepStrictEqual((await run('tabManager.getOrderedSalesforceTabs(null)')).length, 0);
  const same = (a, b) => run(`isSameOrgHost(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
  assert.ok(same('acme--uat--c.sandbox.vf.force.com', 'acme--uat.sandbox.my.salesforce.com'));
  assert.ok(same('acme--uat.sandbox.lightning.force.com', 'acme--uat.sandbox.my.salesforce.com'));
  assert.ok(same('acme.my.salesforce-setup.com', 'acme.lightning.force.com'));
  assert.ok(!same('acme--dev.sandbox.my.salesforce.com', 'acme--uat.sandbox.my.salesforce.com'));
  assert.ok(!same('acme.my.salesforce.com', 'other.my.salesforce.com'));
});

test('S6: logs are queried through the background (OAuth) first; a same-org tab is only the fallback', async () => {
  const { run, sent } = makeDashboard({ respond: () => ({ success: true, data: { records: [apexLog(1)] } }) });
  run('var tabCalls = 0; tabManager.findWorkingTabForQuery = async () => { tabCalls++; return { records: [] }; }');
  const records = await run('logLoader._executeQuery("SELECT Id FROM ApexLog")');
  assert.strictEqual(records.length, 1);
  assert.strictEqual(sent[0].type, 'EXECUTE_TOOLING_QUERY');
  assert.strictEqual(run('tabCalls'), 0);

  const failing = makeDashboard({ respond: () => ({ success: false, error: 'NO_OAUTH_TOKEN' }) });
  failing.run('var tabHost = null; tabManager.findWorkingTabForQuery = async (host) => { tabHost = host; return { records: [{ Id: "fromTab" }] }; }');
  assert.deepStrictEqual(plain(await failing.run('logLoader._executeQuery("q")')).map(r => r.Id), ['fromTab']);
  assert.strictEqual(failing.run('tabHost'), 'acme.my.salesforce.com');
  failing.run('tabManager.findWorkingTabForQuery = async () => null');
  await assert.rejects(failing.run('logLoader._executeQuery("q")'), /NO_OAUTH_TOKEN/);
});

test('L13: incremental fetch looks back 10 minutes and pages past 500 logs (up to 2,000)', async () => {
  const { run } = makeDashboard();
  run(`var queries = [];
    logLoader._executeQuery = async (q) => {
      queries.push(q);
      const page = queries.length;
      if (page > 6) return [];
      return Array.from({ length: 500 }, (_, i) => ({ Id: 'L' + page + '_' + i, StartTime: new Date(Date.UTC(2026, 9, 3, 12, 0, 0) - (page * 500 + i) * 1000).toISOString() }));
    };`);
  const last = Date.UTC(2026, 9, 3, 12, 0, 0);
  const logs = await run(`logLoader._fetchNewLogs(new Date(${last}), 'Monitoring')`);
  const queries = run('queries');
  assert.match(queries[0], /StartTime >= 2026-10-03T11:50:00\.000Z AND Location = 'Monitoring'/);
  assert.match(queries[1], /StartTime <= \d{4}-\d\d-\d\dT[\d:.]+Z AND Location/);
  assert.strictEqual(queries.length, 4);
  assert.strictEqual(logs.length, 2000);
  assert.strictEqual(new Set(logs.map(l => l.Id)).size, 2000);
});

test('L13: a late log that started before newer cached logs is merged in StartTime order', () => {
  const { run } = makeDashboard();
  const merged = run(`logLoader._mergeNewLogs([{ Id: 'late', StartTime: '2026-10-03T11:55:00.000+0000' }, { Id: 'a', StartTime: '2026-10-03T12:05:00.000+0000' }],
    [{ Id: 'a', StartTime: '2026-10-03T12:05:00.000+0000' }, { Id: 'b', StartTime: '2026-10-03T12:00:00.000+0000' }])`);
  assert.deepStrictEqual(plain(merged).map(l => l.Id), ['a', 'b', 'late']);
});

test('F3: a failed body download is not cached as "no debug / no errors"', async () => {
  const { run } = makeDashboard({ respond: (msg) => msg.type === 'GET_LOG_CONTENT' ? { success: false, error: 'Network error' } : { success: true, data: {} } });
  await run(`logLoader.checkDebugStatusProgressive([{ Id: '07LFAIL' }], null)`);
  assert.strictEqual(run(`logCache.hasDebugStatus('07LFAIL') || logCache.hasErrorStatus('07LFAIL') || logCache.hasExceptionStatus('07LFAIL')`), false);
  const ok = makeDashboard({ respond: () => ({ success: true, data: { content: '12:00:00.001 (1)|USER_DEBUG|[1]|ERROR|x\n12:00:00.002 (2)|FATAL_ERROR|System.Exception: y' } }) });
  await ok.run(`logLoader.checkDebugStatusProgressive([{ Id: '07LOK' }], null)`);
  assert.deepStrictEqual([ok.run(`logCache.getDebugStatus('07LOK')`), ok.run(`logCache.getErrorStatus('07LOK')`), ok.run(`logCache.getExceptionStatus('07LOK')`)], [true, true, false]);
});

test('F13: an empty log body is an empty string', async () => {
  const { run } = makeDashboard({ respond: () => ({ success: true, data: { content: '', logId: '07L1' } }) });
  assert.strictEqual(await run(`logLoader.getLogContent('07L1')`), '');
});

test('F4: the logs panel says why logs are missing; zero logs keeps the normal empty state', async () => {
  const noToken = makeDashboard({ respond: () => ({ success: false, error: 'NO_OAUTH_TOKEN' }) });
  noToken.run('tabManager.findWorkingTabForQuery = async () => null');
  await noToken.run('loadDebugLogs()');
  const empty = noToken.getEl('emptyState');
  assert.strictEqual(empty.child('h4').textContent, 'Access token needed');
  assert.strictEqual(empty.child('p').textContent, 'Use Generate Token above.');
  assert.ok(empty.classList.contains('is-error'));

  const apiError = makeDashboard({ respond: () => ({ success: false, error: 'Tooling query failed: 401 - Session expired or invalid' }) });
  apiError.run('tabManager.findWorkingTabForQuery = async () => null');
  await apiError.run('loadDebugLogs()');
  assert.strictEqual(apiError.getEl('emptyState').child('h4').textContent, 'Could not load logs');
  assert.strictEqual(apiError.getEl('emptyState').child('p').textContent, 'Tooling query failed: 401 - Session expired or invalid');

  const none = makeDashboard({ respond: () => ({ success: true, data: { records: [] } }) });
  await none.run('loadDebugLogs()');
  assert.strictEqual(none.getEl('emptyState').child('h4').textContent, 'No debug logs yet');
  assert.ok(!none.getEl('emptyState').classList.contains('is-error'));
});

test('F4: a failed refresh does not move the last fetch time and keeps the list', async () => {
  const cacheKey = 'cachedLogs_00D000000000001_Monitoring';
  const timeKey = 'lastFetchTime_00D000000000001_Monitoring';
  const cached = [apexLog(1), apexLog(2)];
  let fail = false;
  const d = makeDashboard({
    storage: { [cacheKey]: JSON.stringify(cached), [timeKey]: cached[0].StartTime },
    respond: () => (fail ? { success: false, error: 'NO_OAUTH_TOKEN' } : { success: true, data: { records: [] } }),
  });
  d.run('tabManager.findWorkingTabForQuery = async () => null');
  await d.run('loadDebugLogs()');
  assert.strictEqual(d.run('debugLogs.length'), 2);
  fail = true;
  await d.run('loadDebugLogs({ keepPosition: true })');
  assert.strictEqual(d.store[timeKey], cached[0].StartTime);
  assert.strictEqual(d.run('debugLogs.length'), 2, 'the list stays');
  assert.match(d.run('toasts').slice(-1)[0], /^Could not refresh logs\. Use Generate Token above\.$/);
});

test('R4: calls during a load share it; a refresh keeps the opened pages', async () => {
  const logs = Array.from({ length: 40 }, (_, i) => apexLog(i + 1));
  const d = makeDashboard({ respond: () => ({ success: true, data: { records: logs.slice(0, 100) } }) });
  d.run('var loaderCalls = 0; const realLoad = logLoader.loadDebugLogs.bind(logLoader); logLoader.loadDebugLogs = async () => { loaderCalls++; return realLoad(); };');
  await d.run('Promise.all([loadDebugLogs({ keepPosition: true }), loadDebugLogs({ keepPosition: true }), loadDebugLogs({ keepPosition: true })])');
  assert.strictEqual(d.run('loaderCalls'), 1, 'one load for three focus refreshes');
  await d.run('loadMoreLogs()');
  assert.strictEqual(d.run('debugLogs.length'), 30);
  await d.run('loadDebugLogs({ keepPosition: true })');
  assert.strictEqual(d.run('debugLogs.length'), 30, 'refresh keeps two pages');
  await d.run('loadDebugLogs()');
  assert.strictEqual(d.run('debugLogs.length'), 15, 'a reset load shows the first page');
  // A reset call while a load runs loads once more afterwards (e.g. the log type changed)
  d.run('loaderCalls = 0');
  await d.run('Promise.all([loadDebugLogs({ keepPosition: true }), loadDebugLogs(), loadDebugLogs()])');
  assert.strictEqual(d.run('loaderCalls'), 2);
});

test('R4: window focus refreshes at most once per 10 seconds', () => {
  const d = makeDashboard();
  const focus = d.listeners.focus[0];
  focus();
  assert.strictEqual(d.timers.filter(t => t.ms === 100).length, 0, 'ignored right after the page opened');
  d.run('lastDashboardRefreshTime = Date.now() - 11000');
  focus();
  assert.strictEqual(d.timers.filter(t => t.ms === 100).length, 1);
});

test('R1: log search downloads at most 3 bodies at a time, searches the whole body, and ignores older searches', async () => {
  let active = 0;
  let maxActive = 0;
  const bodies = {};
  const d = makeDashboard({
    respond: async (msg) => {
      if (msg.type !== 'GET_LOG_CONTENT') return { success: true, data: {} };
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(r => setImmediate(r));
      active--;
      return { success: true, data: { content: bodies[msg.logId] } };
    },
  });
  const logs = Array.from({ length: 8 }, (_, i) => apexLog(i + 1));
  logs.forEach((l, i) => { bodies[l.Id] = '12:00:00.001 (1)|USER_DEBUG|[1]|DEBUG|' + 'x'.repeat(600 * 1024) + (i === 7 ? ' needle' : ''); });
  d.ctx.__logs = logs;
  d.run('debugLogs = __logs; logRenderer.displayDebugLogs(debugLogs)');
  await d.run('logRenderer.searchInLogs("needle")');
  assert.ok(maxActive <= 3, `at most 3 downloads at once (saw ${maxActive})`);
  const matched = Object.values(d.logItems).filter(e => e.classList.contains('search-match')).map(e => e.name);
  assert.deepStrictEqual(matched, [logs[7].Id], 'the match after 600 KB is found');

  // An older search that ends after a newer one does not overwrite its result
  const older = d.run('logRenderer.searchInLogs("zzz-older")');
  const newer = d.run('logRenderer.searchInLogs("needle")');
  await Promise.all([older, newer]);
  assert.strictEqual(d.getEl('logSearchResults').textContent, '1 match');
});

test('R1: clicking a log does not re-render the list or re-run the search', async () => {
  const d = makeDashboard({ respond: () => ({ success: true, data: { content: '12:00:00.001 (1)|USER_DEBUG|[1]|DEBUG|hello' } }) });
  d.ctx.__logs = [apexLog(1), apexLog(2)];
  d.run('debugLogs = __logs; logRenderer.displayDebugLogs(debugLogs); var renders = 0; const realDisplay = logRenderer.displayDebugLogs.bind(logRenderer); logRenderer.displayDebugLogs = (...a) => { renders++; return realDisplay(...a); }; var searches = 0; logRenderer.searchInLogs = async () => { searches++; };');
  await d.run(`logRenderer.showLogDetails('${d.ctx.__logs[0].Id}')`);
  assert.strictEqual(d.run('renders'), 0);
  assert.strictEqual(d.run('searches'), 0);
});

test('R5: the log search cache is limited by size, not by count', () => {
  const d = makeDashboard();
  d.run('logRenderer.LOG_CONTENT_CACHE_MAX_SIZE = 100');
  d.run(`logRenderer._cacheSearchableContent('a', 'x'.repeat(40)); logRenderer._cacheSearchableContent('b', 'x'.repeat(40)); logRenderer._cacheSearchableContent('c', 'x'.repeat(40))`);
  assert.deepStrictEqual(plain(d.run('[...logRenderer.logContentCache.keys()]')), ['b', 'c']);
  assert.strictEqual(d.run('logRenderer.logContentCacheSize'), 80);
  d.run(`logRenderer._cacheSearchableContent('d', 'x'.repeat(500))`);
  assert.ok(!d.run('logRenderer.logContentCache.has("d")'), 'a body bigger than the whole cache is not kept');
});

test('L14: a slow log that finishes after another log was picked is not shown', async () => {
  const resolvers = {};
  const d = makeDashboard({
    respond: (msg) => msg.type === 'GET_LOG_CONTENT'
      ? new Promise(r => { resolvers[msg.logId] = () => r({ success: true, data: { content: `12:00:00.001 (1)|USER_DEBUG|[1]|DEBUG|body of ${msg.logId}` } }); })
      : { success: true, data: {} },
  });
  const [a, b] = [apexLog(1), apexLog(2)];
  d.ctx.__logs = [a, b];
  d.run('debugLogs = __logs');
  const slow = d.run(`logRenderer.selectDebugLog('${a.Id}')`);
  d.run(`logRenderer.selectDebugLog('${b.Id}')`);
  resolvers[b.Id]();
  await new Promise(r => setImmediate(r));
  resolvers[a.Id]();
  await slow;
  await new Promise(r => setImmediate(r));
  assert.ok(d.run('currentRawResponse').includes(`body of ${b.Id}`));
  assert.ok(d.getEl('debugContent').innerHTML.includes(`body of ${b.Id}`));
});

test('F11: Monitoring logs are kept 7 days, System logs 24 hours', () => {
  const d = makeDashboard();
  d.ctx.__logs = [apexLog(1, 2 * DAY, 'Monitoring'), apexLog(2, 2 * DAY, 'SystemLog'), apexLog(3, 8 * DAY, 'Monitoring')];
  const items = d.ctx.__logs.map((_, i) => d.run(`logRenderer._renderLogItem(__logs[${i}])`));
  assert.ok(!items[0].includes('log-item-expired'));
  assert.ok(items[1].includes('log-item-expired') && items[1].includes('older than 24 hours'));
  assert.ok(items[2].includes('log-item-expired') && items[2].includes('older than 7 days'));
  // The cached log list keeps 2-day-old Monitoring logs
  d.store['cachedLogs_x_Monitoring'] = JSON.stringify(d.ctx.__logs);
  d.run('logLoader.cleanupOldCaches()');
  assert.deepStrictEqual(JSON.parse(d.store['cachedLogs_x_Monitoring']).map(l => l.Id), [d.ctx.__logs[0].Id]);
});

test('F12: read/cleared markers keep their first time, expire, and survive a full storage', () => {
  const key = 'readLogs_00D000000000001';
  const old = Date.now() - 9 * DAY;
  const recent = Date.now() - 2 * DAY;
  const d = makeDashboard({ storage: { [key]: JSON.stringify([{ logId: 'old', readAt: old }, { logId: 'recent', readAt: recent }]) } });
  d.run('loadReadLogsFromStorage(); cleanupExpiredLogs()');
  assert.deepStrictEqual(JSON.parse(d.store[key]), [{ logId: 'recent', readAt: recent }], 'expired entry dropped, time kept');
  d.run(`markLogAsRead('new'); markLogAsRead('recent')`);
  const saved = JSON.parse(d.store[key]);
  assert.strictEqual(saved.find(e => e.logId === 'recent').readAt, recent, 'marking again does not change the time');
  assert.ok(saved.find(e => e.logId === 'new'));

  // Storage full: the oldest half is dropped and the save is tried again
  let attempts = 0;
  d.localStorage.failWrites = (k) => k === key && ++attempts === 1;
  d.run(`markLogAsRead('newest')`);
  assert.strictEqual(attempts, 2);
  assert.deepStrictEqual(JSON.parse(d.store[key]).map(e => e.logId), ['newest'], 'the older two of three were dropped');
  assert.strictEqual(d.run('isLogRead("newest")'), true);
});

test('F8: LOGS_DELETED removes the logs from the list and the cache and re-renders', () => {
  const cacheKey = 'cachedLogs_00D000000000001_Monitoring';
  const logs = Array.from({ length: 20 }, (_, i) => apexLog(i + 1));
  const d = makeDashboard({ storage: { [cacheKey]: JSON.stringify(logs) } });
  d.ctx.__logs = logs;
  d.run('loadedLogs = __logs; showLoadedLogs(0)');
  assert.strictEqual(d.run('debugLogs.length'), 15);
  const handler = d.listeners.message[d.listeners.message.length - 1];
  handler({ type: 'LOGS_DELETED', logIds: [logs[0].Id, logs[1].Id] }, {}, () => {});
  assert.strictEqual(d.run('debugLogs.length'), 15, 'the page is filled up again');
  assert.ok(!d.run('debugLogs').some(l => l.Id === logs[0].Id));
  assert.ok(!d.getEl('logsList').innerHTML.includes(logs[0].Id), 'the list is rendered again');
  assert.strictEqual(JSON.parse(d.store[cacheKey]).length, 18);
});

test('F8: LOGS_DELETED from another org is ignored; the same org under another My Domain host is not', () => {
  const logs = Array.from({ length: 3 }, (_, i) => apexLog(i + 1));
  const d = makeDashboard();
  d.ctx.__logs = logs;
  d.run('loadedLogs = __logs; showLoadedLogs(0)');
  const handler = d.listeners.message[d.listeners.message.length - 1];
  handler({ type: 'LOGS_DELETED', logIds: [logs[0].Id], orgDomain: 'other.my.salesforce.com' }, {}, () => {});
  assert.strictEqual(d.run('debugLogs.length'), 3);
  handler({ type: 'LOGS_DELETED', logIds: [logs[0].Id], orgDomain: 'ACME.lightning.force.com' }, {}, () => {});
  assert.strictEqual(d.run('debugLogs.length'), 2);
});

test('Dashboards opened without ?host= use the detected org for queries and log bodies', async () => {
  const d = makeDashboard({
    urlHost: null,
    respond: (msg) => msg.type === 'GET_LOG_CONTENT' ? { success: true, data: { content: 'x' } } : { success: true, data: { records: [] } },
  });
  await d.run('logLoader._executeQuery("q")');
  await d.run(`logLoader.getLogContent('07L1')`);
  assert.deepStrictEqual(d.sent.map(m => [m.type, m.sfHost]), [['EXECUTE_TOOLING_QUERY', 'acme.my.salesforce.com'], ['GET_LOG_CONTENT', 'acme.my.salesforce.com']]);
  assert.strictEqual(d.sent[1].targetHost, 'acme.my.salesforce.com');
});
