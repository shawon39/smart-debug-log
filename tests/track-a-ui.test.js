// Track A: popup and dashboard logic in a vm sandbox with small DOM stubs
// L15 popup uses one org, F10 popup errors are visible, F13 Revoke after a dismissed banner,
// M1 OAuth error shown in the token banner.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const EXT = 'chrome-extension://extid/';
const tick = () => new Promise(resolve => setTimeout(resolve, 15));

function makeElement(id) {
  const classes = new Set();
  return {
    id, textContent: '', hidden: false, disabled: false, value: '15', dataset: {}, style: {}, handlers: {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    addEventListener(type, fn) { this.handlers[type] = fn; },
    querySelector() { return null; }
  };
}

function loadPopup({ activeTab, allTabs, contexts, reply, globals = {} }) {
  const elements = {};
  const domListeners = {};
  const messages = [];
  const context = vm.createContext({
    console, URL, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => { },
    document: {
      getElementById: (id) => (elements[id] ||= makeElement(id)),
      addEventListener: (type, fn) => { domListeners[type] = fn; }
    },
    window: { close() { } },
    confirm: () => true,
    isSalesforceUrl: (url) => /\.(salesforce|force)\.com/.test(url),
    ...globals,
    initializeTheme: async () => { },
    setupThemeToggle: () => { },
    chrome: {
      tabs: { query: async (q) => (q.active ? [activeTab] : allTabs), update: async () => { }, create: async () => { } },
      windows: { update: async () => { } },
      storage: { local: { get: async () => ({}), set: async () => { } } },
      runtime: {
        getURL: (p) => EXT + p,
        getContexts: async () => contexts,
        sendMessage: async (message) => { messages.push(JSON.parse(JSON.stringify(message))); return reply(message); }
      }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'popup/popup.js'), 'utf8'), context, { filename: 'popup.js' });
  domListeners.DOMContentLoaded();
  return { elements, messages };
}

test('L15 on the dashboard tab the popup uses the dashboard org for status and every action', async () => {
  const replies = {
    GET_SALESFORCE_HOST: (m) => ({ success: true, data: { salesforceHost: m.url.startsWith(EXT) ? new URL(m.url).searchParams.get('host') : 'orga.my.salesforce.com' } }),
    GET_SESSION: (m) => ({ success: true, data: { hostname: m.sfHost } }),
    CHECK_TOKEN_STATUS: () => ({ success: true, data: { hasToken: true, isExpired: false } }),
    GET_TRACE_FLAG_STATUS: () => ({ success: true, data: { active: false } }),
    ENSURE_TRACE_FLAG: () => ({ success: false, error: 'Tooling update failed: 400 - This entity is already being traced.' }),
    REVOKE_OAUTH_TOKEN: () => ({ success: true, warning: 'Salesforce did not confirm the revoke (HTTP 400). The token was removed from this browser.' })
  };
  const { elements, messages } = loadPopup({
    // Without the "tabs" permission the dashboard tab has no url in tabs.query
    activeTab: { id: 5 },
    allTabs: [{ id: 2, url: 'https://orga.lightning.force.com/lightning/page/home', lastAccessed: Date.now() }, { id: 5 }],
    contexts: [{ tabId: 5, windowId: 1, documentUrl: `${EXT}dashboard.html?host=orgb.my.salesforce.com` }],
    reply: (m) => replies[m.type](m)
  });
  await tick();

  assert.equal(messages[0].type, 'GET_SALESFORCE_HOST');
  assert.equal(messages[0].url, `${EXT}dashboard.html?host=orgb.my.salesforce.com`);
  for (const type of ['GET_SESSION', 'CHECK_TOKEN_STATUS', 'GET_TRACE_FLAG_STATUS']) {
    assert.equal(messages.find(m => m.type === type).sfHost, 'orgb.my.salesforce.com', type);
  }
  assert.equal(elements.orgName.textContent, 'orgb.my.salesforce.com');

  // F10: Enable failure shows the real reason
  await elements.enableLoggingBtn.handlers.click();
  assert.equal(messages.find(m => m.type === 'ENSURE_TRACE_FLAG').sfHost, 'orgb.my.salesforce.com');
  assert.equal(elements.popupError.hidden, false);
  assert.equal(elements.popupError.textContent, 'Could not turn on logging: Tooling update failed: 400 - This entity is already being traced.');

  // Revoke uses the same org and shows the warning
  await elements.revokeTokenBtn.handlers.click();
  assert.equal(messages.find(m => m.type === 'REVOKE_OAUTH_TOKEN').sfHost, 'orgb.my.salesforce.com');
  assert.match(elements.popupError.textContent, /did not confirm the revoke/);
});

test('F2 popup shows a scheduled trace flag instead of "Not recording"', async () => {
  const startTime = '2026-10-03T15:30:00.000Z';
  const { elements } = loadPopup({
    activeTab: { id: 2, url: 'https://acme.my.salesforce.com/lightning/page/home' },
    allTabs: [],
    contexts: [],
    reply: (m) => ({
      GET_SALESFORCE_HOST: { success: true, data: { salesforceHost: 'acme.my.salesforce.com' } },
      GET_SESSION: { success: true, data: { hostname: 'acme.my.salesforce.com' } },
      CHECK_TOKEN_STATUS: { success: true, data: { hasToken: true, isExpired: false } },
      GET_TRACE_FLAG_STATUS: { success: true, data: { active: false, scheduled: true, startTime, expirationDate: '2026-10-03T16:30:00.000Z' } }
    })[m.type]
  });
  await tick();
  assert.match(elements.loggingStatusText.textContent, /^Recording starts at /);
});

const SF_TAB = { id: 2, url: 'https://acme.my.salesforce.com/lightning/page/home' };
const noTokenReplies = (traceStatus) => (m) => ({
  GET_SALESFORCE_HOST: { success: true, data: { salesforceHost: 'acme.my.salesforce.com' } },
  GET_SESSION: { success: true, data: { hostname: 'acme.my.salesforce.com' } },
  CHECK_TOKEN_STATUS: { success: true, data: { hasToken: false } },
  GET_TRACE_FLAG_STATUS: { success: true, data: traceStatus }
})[m.type];

test('popup without a token: logging controls are off, but a running trace flag still shows', async () => {
  const running = loadPopup({ activeTab: SF_TAB, allTabs: [], contexts: [],
    reply: noTokenReplies({ active: true, expirationDate: new Date(Date.now() + 20 * 60000).toISOString() }) });
  await tick();
  assert.strictEqual(running.elements.loggingStatusText.textContent, 'Recording your debug logs');
  assert.match(running.elements.loggingCountdown.textContent, /^(19|20):\d\d$/);
  assert.strictEqual(running.elements.enableLoggingBtn.disabled, true);
  assert.strictEqual(running.elements.durationSelect.disabled, true);

  const idle = loadPopup({ activeTab: SF_TAB, allTabs: [], contexts: [], reply: noTokenReplies({ active: false }) });
  await tick();
  assert.strictEqual(idle.elements.loggingStatusText.textContent, 'Generate a token to record debug logs');
  assert.strictEqual(idle.elements.enableLoggingBtn.disabled, true);
});

test('popup on a dashboard tab: the main button goes back to that org in Salesforce', async () => {
  const backTo = [];
  const { elements, messages } = loadPopup({
    activeTab: { id: 5 },
    allTabs: [{ id: 5 }],
    contexts: [{ tabId: 5, windowId: 1, documentUrl: `${EXT}dashboard.html?host=orgb.my.salesforce.com` }],
    reply: (m) => ({
      GET_SALESFORCE_HOST: { success: true, data: { salesforceHost: 'orgb.my.salesforce.com' } },
      GET_SESSION: { success: true, data: { hostname: 'orgb.my.salesforce.com' } },
      CHECK_TOKEN_STATUS: { success: true, data: { hasToken: true, isExpired: false } },
      GET_TRACE_FLAG_STATUS: { success: true, data: { active: false } }
    })[m.type],
    globals: { focusSalesforceTab: async (host) => { backTo.push(host); } }
  });
  await tick();
  assert.strictEqual(elements.openDashboardBtn.textContent, 'Back to Salesforce');
  await elements.openDashboardBtn.handlers.click();
  assert.deepStrictEqual(backTo, ['orgb.my.salesforce.com']);
  assert.ok(!messages.some(m => m.type === 'ENSURE_TRACE_FLAG'), 'does not open or refresh the dashboard');
});

function loadDashboardConnection({ dismissed, reply }) {
  const warningClasses = makeElement('devConsoleWarning');
  const subtitle = makeElement('subtitle');
  warningClasses.querySelector = () => subtitle;
  const revokeBtn = makeElement('revokeTokenDashboardBtn');
  revokeBtn.style.display = 'none';
  const context = vm.createContext({
    console,
    setTimeout: () => 0,
    window: { addEventListener() { } },
    document: { addEventListener() { }, getElementById: () => null },
    sessionStorage: { getItem: () => (dismissed ? 'true' : null), setItem() { } },
    chrome: { runtime: { sendMessage: async (m) => reply(m) } },
    getHostFromUrl: () => 'acme.my.salesforce.com',
    sfHost: 'acme.my.salesforce.com',
    elements: { revokeTokenDashboardBtn: revokeBtn, devConsoleWarning: warningClasses },
    Icons: { svg: () => '' },
    showToast: () => { }
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/dashboard-connection.js'), 'utf8'), context, { filename: 'dashboard-connection.js' });
  return { context, revokeBtn, banner: warningClasses, subtitle };
}

test('F13 Revoke button follows the token even after the banner was dismissed', async () => {
  const valid = () => ({ success: true, data: { hasToken: true, isExpired: false } });
  const none = () => ({ success: true, data: { hasToken: false } });

  let d = loadDashboardConnection({ dismissed: true, reply: valid });
  await d.context.checkOAuthTokenStatus();
  assert.equal(d.revokeBtn.style.display, 'inline-flex');

  d = loadDashboardConnection({ dismissed: true, reply: none });
  d.banner.classList.add('hidden');
  await d.context.checkOAuthTokenStatus();
  assert.equal(d.revokeBtn.style.display, 'none');
  assert.equal(d.banner.classList.contains('hidden'), true, 'dismissed banner stays hidden');

  d = loadDashboardConnection({ dismissed: false, reply: none });
  d.banner.classList.add('hidden');
  await d.context.checkOAuthTokenStatus();
  assert.equal(d.banner.classList.contains('hidden'), false, 'banner shows when not dismissed');
});

test('M1 a failed Generate Token shows the mapped OAuth error in the token banner', async () => {
  const message = 'Salesforce blocked this app for your user. Ask your Salesforce admin to install the app: Setup > Connected Apps OAuth Usage > find the app > Install, then set who can use it.';
  const d = loadDashboardConnection({ dismissed: false, reply: () => ({ success: false, error: message }) });
  await d.context.generateAccessToken();
  assert.equal(d.subtitle.textContent, message);
  assert.equal(d.subtitle.classList.contains('is-error'), true);
});
