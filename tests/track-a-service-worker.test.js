// Track A: background/service-worker.js message contracts and checks
// S3 sender check, D2 org required, L17 LIKE escaping, DELETE_APEX_LOGS / GET_LOG_STORAGE /
// GET_OAUTH_CONFIG contracts, F2 status cache, D2 shortcut, S4 storage access level,
// L16 reconcile on startup, S9 + L11 in session-manager.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const HOST = 'acme.my.salesforce.com';
const BASE = `https://${HOST}`;
const USER = '005xx000001X8UzAAK';
const EXT = 'chrome-extension://extid/';
const NO_ORG = 'No Salesforce org selected. Reopen the dashboard from a Salesforce tab.';

const listeners = {};
const store = {};
const alarms = new Map();
const broadcasts = [];
const accessLevelCalls = [];
const created = [];
let cookieStores = [];
let cookieGet = async () => null;
let activeTabs = [];
let contexts = [];

const event = (name) => ({ addListener(fn) { (listeners[name] ||= []).push(fn); } });
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return structuredClone(store);
        const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
        const out = {};
        for (const key of list) if (key in store) out[key] = structuredClone(store[key]);
        return out;
      },
      async set(values) { Object.assign(store, structuredClone(values)); },
      async remove(keys) { for (const key of [].concat(keys)) delete store[key]; },
      async setAccessLevel(options) { accessLevelCalls.push(options); }
    }
  },
  runtime: {
    id: 'extid',
    lastError: null,
    getURL: (p) => EXT + p,
    sendMessage: async (message) => { broadcasts.push(message); },
    getContexts: async () => contexts,
    onMessage: event('onMessage'),
    onInstalled: event('onInstalled'),
    onStartup: event('onStartup')
  },
  alarms: {
    async create(name, info) { alarms.set(name, info); },
    async clear(name) { return alarms.delete(name); },
    onAlarm: event('onAlarm')
  },
  commands: { onCommand: event('onCommand') },
  identity: { getRedirectURL: (p) => `https://extid.chromiumapp.org/${p}` },
  tabs: {
    query: async () => activeTabs,
    update: async () => { },
    create: async (props) => { created.push(props); }
  },
  windows: { update: async () => { } },
  cookies: {
    get: (details) => cookieGet(details),
    getAll: async () => [],
    getAllCookieStores: async () => cookieStores
  }
};

const requests = [];
let respond = () => { throw new Error('no fake Salesforce response set'); };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const request = { method: init.method || 'GET', path: u.pathname, query: u.searchParams.get('q'), ids: u.searchParams.get('ids') };
  requests.push(request);
  const result = respond(request);
  const status = result && result.status ? result.status : 200;
  const body = result && 'body' in result ? result.body : result;
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
};

const dashboardSender = { id: 'extid', url: `${EXT}dashboard.html?host=${HOST}` };
function send(request, sender = dashboardSender) {
  return new Promise(resolve => listeners.onMessage[0](request, sender, resolve));
}

function resetOrg() {
  for (const key of Object.keys(store)) delete store[key];
  store[`sfOAuthToken_${HOST}`] = {
    accessToken: 'AT1', instanceUrl: BASE, refreshToken: 'RT1', issuedAt: Date.now(),
    id: `https://login.salesforce.com/id/00Dxx0000001gEREAY/${USER}`
  };
  requests.length = 0;
  broadcasts.length = 0;
  alarms.clear();
}

let sessionManager;
test.before(async () => {
  await import(pathToFileURL(path.join(__dirname, '..', 'background', 'service-worker.js')).href);
  sessionManager = (await import(pathToFileURL(path.join(__dirname, '..', 'background', 'session-manager.js')).href)).default;
});

test('S4 the worker limits storage.local to trusted contexts at startup', () => {
  assert.deepEqual(accessLevelCalls, [{ accessLevel: 'TRUSTED_CONTEXTS' }]);
});

test('S3 content scripts and other senders are rejected', async () => {
  resetOrg();
  const contentScript = { id: 'extid', url: `${BASE}/lightning/page/home`, tab: { id: 3, url: `${BASE}/lightning/page/home` } };
  assert.deepEqual(await send({ type: 'GET_SESSION', sfHost: HOST }, contentScript), { success: false, error: 'Unauthorized sender' });
  assert.deepEqual(await send({ type: 'EXECUTE_ANONYMOUS', code: 'x', sfHost: HOST }, contentScript), { success: false, error: 'Unauthorized sender' });
  assert.deepEqual(await send({ type: 'GET_OAUTH_CONFIG' }, { id: 'other-extension', url: 'chrome-extension://other/x.html' }), { success: false, error: 'Unauthorized sender' });
  assert.deepEqual(await send({ type: 'GET_OAUTH_CONFIG' }, { id: 'extid' }), { success: false, error: 'Unauthorized sender' });
  const popup = await send({ type: 'GET_OAUTH_CONFIG' }, { id: 'extid', url: `${EXT}popup/popup.html` });
  assert.equal(popup.success, true);
  assert.equal(requests.length, 0);
});

test('D2 every write message needs an org; none falls back to the last used org', async () => {
  resetOrg();
  for (const type of ['TOOLING_CREATE', 'TOOLING_UPDATE', 'TOOLING_DELETE', 'EXECUTE_ANONYMOUS', 'ENSURE_TRACE_FLAG', 'DELETE_APEX_LOGS', 'DELETE_LOGS_BY_IDS']) {
    assert.deepEqual(await send({ type, sobjectType: 'TraceFlag', recordId: '7tfxx0000000001AAA', data: {}, logIds: ['07Lxx0000000001AAA'], code: 'x' }), { success: false, error: NO_ORG }, type);
  }
  // Reads without an org find no token instead of guessing one
  const status = await send({ type: 'CHECK_TOKEN_STATUS', sfHost: null });
  assert.equal(status.data.hasToken, false);
  assert.equal(requests.length, 0);
  assert.deepEqual(broadcasts, []);
});

test('L17 SEARCH_USERS escapes quotes, backslashes and the LIKE wildcards % and _', async () => {
  resetOrg();
  respond = () => ({ records: [] });
  await send({ type: 'SEARCH_USERS', searchTerm: "50%_off\\'", sfHost: HOST });
  assert.ok(requests[0].query.includes("Name LIKE '%50\\%\\_off\\\\\\'%'"), requests[0].query);
});

test('DELETE_APEX_LOGS contract: ids, user, never everything; broadcasts LOGS_DELETED', async () => {
  resetOrg();
  respond = (r) => {
    if (r.query) return { records: [{ Id: '07Lxx0000000003AAA' }] };
    return r.ids.split(',').map((id, i) => i === 1 ? { success: false, errors: [{ message: 'no access' }] } : { id, success: true, errors: [] });
  };
  const byIds = await send({ type: 'DELETE_APEX_LOGS', sfHost: HOST, logIds: ['07Lxx0000000001AAA', '07Lxx0000000002AAA'] });
  assert.deepEqual(byIds, { success: true, data: { deleted: 1, failed: 1, errors: ['no access'], deletedIds: ['07Lxx0000000001AAA'] } });
  assert.deepEqual(broadcasts, [{ type: 'LOGS_DELETED', logIds: ['07Lxx0000000001AAA'], orgDomain: HOST }]);

  const byUser = await send({ type: 'DELETE_APEX_LOGS', sfHost: HOST, userId: USER });
  assert.equal(byUser.data.deleted, 1);
  assert.match(requests.find(r => r.query).query, new RegExp(`WHERE LogUserId = '${USER}'`));

  assert.equal((await send({ type: 'DELETE_APEX_LOGS', sfHost: HOST })).success, false);
  assert.equal((await send({ type: 'DELETE_APEX_LOGS', sfHost: HOST, logIds: [] })).success, false);
  assert.deepEqual(await send({ type: 'DELETE_APEX_LOGS', sfHost: HOST, userId: "x' OR Id != '" }), { success: false, error: 'Invalid user ID' });
});

test('DELETE_LOGS_BY_IDS only broadcasts; GET_LOG_STORAGE and GET_OAUTH_CONFIG shapes', async () => {
  resetOrg();
  respond = () => ({ records: [{ totalBytes: 2048, logCount: 3 }] });
  const cacheOnly = await send({ type: 'DELETE_LOGS_BY_IDS', sfHost: HOST, logIds: ['07Lxx0000000001AAA'] });
  assert.equal(cacheOnly.success, true);
  assert.equal(requests.length, 0, 'no delete call to Salesforce');
  assert.deepEqual(broadcasts, [{ type: 'LOGS_DELETED', logIds: ['07Lxx0000000001AAA'], orgDomain: HOST }]);

  assert.deepEqual(await send({ type: 'GET_LOG_STORAGE', sfHost: HOST }), { success: true, data: { totalBytes: 2048, logCount: 3, limitBytes: 1048576000 } });

  const config = await send({ type: 'GET_OAUTH_CONFIG' });
  assert.equal(config.data.redirectUri, 'https://extid.chromiumapp.org/salesforce');
  assert.equal(config.data.usingCustomClientId, false);
  const saved = await send({ type: 'SET_OAUTH_CLIENT_ID', clientId: '3MVG9CustomKey_1234567890' });
  assert.deepEqual(saved.data, { redirectUri: 'https://extid.chromiumapp.org/salesforce', clientId: '3MVG9CustomKey_1234567890', usingCustomClientId: true });
  assert.equal((await send({ type: 'SET_OAUTH_CLIENT_ID', clientId: 'bad key' })).success, false);
});

test('D1 TOOLING_DELETE / TOOLING_UPDATE of a trace flag never delete logs', async () => {
  resetOrg();
  store.autoCleanupLogs = true;
  store.autoTraceFlags = [{ traceFlagId: '7tfxx0000000001AAA', userId: USER, orgDomain: HOST, startTime: new Date(Date.now() - 3600e3).toISOString(), expirationDate: new Date(Date.now() + 3600e3).toISOString() }];
  alarms.set('cleanup_traceflag_7tfxx0000000001AAA', {});
  respond = () => ({ status: 204, body: undefined });

  await send({ type: 'TOOLING_UPDATE', sobjectType: 'TraceFlag', recordId: '7tfxx0000000001AAA', data: { ExpirationDate: new Date().toISOString() }, sfHost: HOST });
  await send({ type: 'TOOLING_DELETE', sobjectType: 'TraceFlag', recordId: '7tfxx0000000001AAA', sfHost: HOST });
  assert.deepEqual(requests.map(r => r.method), ['PATCH', 'DELETE']);
  assert.ok(!requests.some(r => r.query || (r.path || '').includes('ApexLog')), 'no ApexLog query or delete');
  assert.deepEqual(store.autoTraceFlags, []);
  assert.equal(alarms.size, 0);
});

test('F2 GET_TRACE_FLAG_STATUS: real flags, 30 s cache, cleared by ENSURE_TRACE_FLAG, local fallback on error', async () => {
  resetOrg();
  const otherHost = 'f2.my.salesforce.com';
  store[`sfOAuthToken_${otherHost}`] = { ...store[`sfOAuthToken_${HOST}`], instanceUrl: `https://${otherHost}` };
  const start = new Date(Date.now() - 60e3).toISOString();
  const end = new Date(Date.now() + 600e3).toISOString();
  respond = (r) => {
    if (r.query && r.query.includes('ExpirationDate >')) return { records: [{ Id: '7tfxx0000000001AAA', LogType: 'DEVELOPER_LOG', StartDate: start, ExpirationDate: end, DebugLevel: { DeveloperName: 'SFDC_DevConsole' } }] };
    if (r.query && r.query.includes("LogType = 'USER_DEBUG'")) return { records: [{ Id: '7tfxx0000000002AAA', StartDate: start, ExpirationDate: end, DebugLevelId: '7dlxx0000000001AAA' }] };
    throw new Error('unexpected');
  };
  const first = await send({ type: 'GET_TRACE_FLAG_STATUS', sfHost: otherHost });
  assert.deepEqual(first, { success: true, data: { active: true, scheduled: false, startTime: start, expirationDate: end, logType: 'DEVELOPER_LOG', debugLevel: 'SFDC_DevConsole' } });
  await send({ type: 'GET_TRACE_FLAG_STATUS', sfHost: otherHost });
  assert.equal(requests.length, 1, 'second call served from the cache');

  await send({ type: 'ENSURE_TRACE_FLAG', sfHost: otherHost });
  requests.length = 0;
  await send({ type: 'GET_TRACE_FLAG_STATUS', sfHost: otherHost });
  assert.equal(requests.length, 1, 'ENSURE_TRACE_FLAG cleared the cache');

  // Salesforce unreachable: fall back to the flags this extension stored for this org
  resetOrg();
  respond = () => ({ status: 503, body: [{ message: 'down' }] });
  store.autoTraceFlags = [{ traceFlagId: '7tfxx0000000009AAA', userId: USER, orgDomain: HOST, startTime: start, expirationDate: end }];
  const fallback = await send({ type: 'GET_TRACE_FLAG_STATUS', sfHost: HOST });
  assert.equal(fallback.data.active, true);
  assert.equal(fallback.data.expirationDate, end);
});

test('D2 keyboard shortcut on a non-Salesforce tab opens the dashboard without touching any org', async () => {
  resetOrg();
  respond = () => { throw new Error('must not call Salesforce'); };
  activeTabs = [{ id: 1, url: 'https://example.com/' }];
  contexts = [];
  created.length = 0;
  await listeners.onCommand[0]('open-debug-dashboard');
  assert.equal(requests.length, 0);
  assert.deepEqual(created, [{ url: `${EXT}dashboard.html`, active: true }]);

  // On a Salesforce tab it uses the shared ensureTraceFlag (lookup without DebugLevelId)
  respond = (r) => {
    if (r.query) return { records: [{ Id: '7tfxx0000000001AAA', StartDate: new Date(Date.now() - 60e3).toISOString(), ExpirationDate: new Date(Date.now() + 600e3).toISOString(), DebugLevelId: '7dlxx0000000001AAA' }] };
    throw new Error('unexpected');
  };
  activeTabs = [{ id: 2, url: `${BASE}/lightning/page/home` }];
  contexts = [{ contextType: 'TAB', tabId: 9, windowId: 4, documentUrl: `${EXT}dashboard.html?host=${HOST}` }];
  created.length = 0;
  await listeners.onCommand[0]('open-debug-dashboard');
  assert.equal(requests.length, 1);
  assert.doesNotMatch(requests[0].query, /DebugLevelId =/);
  assert.deepEqual(created, [], 'existing dashboard tab (found via runtime.getContexts) is reused');
});

test('L16 onStartup re-creates cleanup alarms from stored trace flags', async () => {
  resetOrg();
  const when = Date.now() + 3600e3;
  store.autoTraceFlags = [{ traceFlagId: '7tfxx0000000001AAA', userId: USER, orgDomain: HOST, startTime: new Date().toISOString(), expirationDate: new Date(when).toISOString() }];
  listeners.onStartup[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(alarms.get('cleanup_traceflag_7tfxx0000000001AAA').when, when);
});

test('S9 hostnames are matched exactly, not by substring', async () => {
  cookieStores = [];
  cookieGet = async () => null;
  assert.equal(await sessionManager.getSalesforceHost('https://myforce.com/x'), null);
  assert.equal(await sessionManager.getSalesforceHost('https://force.com.evil.example/x'), null);
  assert.equal(await sessionManager.getSalesforceHost('https://salesforce.com.attacker.io/'), null);
  assert.equal(await sessionManager.getSalesforceHost('https://acme.lightning.force.com/one/one.app'), 'acme.lightning.force.com');
  assert.equal(await sessionManager.getSalesforceHost('https://acme.my.salesforce-setup.com/'), 'acme.my.salesforce-setup.com');
});

test('L11 cookies are read from the tab\'s own cookie store (incognito), cached per store', async () => {
  cookieStores = [{ id: '0', tabIds: [1] }, { id: '1', tabIds: [7] }];
  const storesAsked = [];
  cookieGet = async ({ storeId }) => {
    storesAsked.push(storeId);
    return storeId === '1' ? { value: '00Dxx0000001gEREAY!session', domain: 'incog.my.salesforce.com' } : null;
  };
  chrome.cookies.getAll = async ({ storeId }) => storeId === '1' ? [{ value: '00Dxx0000001gEREAY!session', domain: 'incog.my.salesforce.com' }] : [];
  const url = 'https://shared.lightning.force.com/lightning/page/home';
  assert.equal(await sessionManager.getSalesforceHost(url, 7), 'incog.my.salesforce.com');
  assert.equal(await sessionManager.getSalesforceHost(url, 1), 'shared.lightning.force.com');
  assert.deepEqual(storesAsked, ['1', '0']);
  assert.equal(await sessionManager.getSalesforceHost(url, 7), 'incog.my.salesforce.com', 'cached per store');
});
