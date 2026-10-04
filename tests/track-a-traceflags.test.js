// Track A: background/traceflag-manager.js
// L2 ensureTraceFlag, D1 opt-in log cleanup, L16 alarm reconcile, F2 real trace flag status.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = (rel) => pathToFileURL(path.join(__dirname, '..', rel)).href;

const HOST = 'acme.my.salesforce.com';
const BASE = `https://${HOST}`;
const USER = '005xx000001X8UzAAK';
const HOUR = 3600 * 1000;

function setup(extraStore = {}) {
  const store = {
    [`sfOAuthToken_${HOST}`]: {
      accessToken: 'AT1', instanceUrl: BASE, refreshToken: 'RT1', issuedAt: Date.now(),
      id: `https://login.salesforce.com/id/00Dxx0000001gEREAY/${USER}`
    },
    ...structuredClone(extraStore)
  };
  const alarms = new Map();
  const sent = [];
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) if (key in store) out[key] = structuredClone(store[key]);
          return out;
        },
        async set(values) { Object.assign(store, structuredClone(values)); },
        async remove(keys) { for (const key of [].concat(keys)) delete store[key]; }
      }
    },
    alarms: {
      async create(name, info) { alarms.set(name, info); },
      async clear(name) { return alarms.delete(name); }
    },
    runtime: { sendMessage: async (message) => { sent.push(message); } }
  };
  return { store, alarms, sent };
}

// Small fake Salesforce: records every request and answers from handlers
function fakeSalesforce(handlers) {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const request = { method: init.method || 'GET', path: u.pathname, query: u.searchParams.get('q'), ids: u.searchParams.get('ids'), body: init.body ? JSON.parse(init.body) : null };
    requests.push(request);
    const result = handlers(request);
    const status = result && result.status ? result.status : 200;
    const body = result && 'body' in result ? result.body : result;
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return requests;
}

let tf;
test.before(async () => { tf = await import(moduleUrl('background/traceflag-manager.js')); });

test('L2 an active USER_DEBUG flag at any debug level is kept (no DebugLevelId filter, no create)', async () => {
  setup();
  const now = Date.now();
  const requests = fakeSalesforce((r) => {
    if (r.query && r.query.includes('FROM TraceFlag')) {
      return { records: [{ Id: '7tfxx0000000001AAA', StartDate: new Date(now - HOUR).toISOString(), ExpirationDate: new Date(now + HOUR).toISOString(), DebugLevelId: '7dlxx0000000009AAA' }] };
    }
    throw new Error('unexpected request ' + r.method + ' ' + r.path);
  });
  const result = await tf.ensureTraceFlag(HOST);
  assert.deepEqual(result, { success: true, data: { existing: true, traceFlagId: '7tfxx0000000001AAA' } });
  assert.equal(requests.length, 1);
  assert.match(requests[0].query, new RegExp(`WHERE TracedEntityId = '${USER}' AND LogType = 'USER_DEBUG' ORDER BY`));
  assert.doesNotMatch(requests[0].query, /DebugLevelId =/);
});

test('L2 force on an active flag PATCHes it in place and keeps its debug level', async () => {
  const { store, alarms } = setup();
  const now = Date.now();
  const requests = fakeSalesforce((r) => {
    if (r.query && r.query.includes('FROM TraceFlag')) {
      return { records: [{ Id: '7tfxx0000000001AAA', StartDate: new Date(now - HOUR).toISOString(), ExpirationDate: new Date(now + HOUR).toISOString(), DebugLevelId: '7dlxx0000000009AAA' }] };
    }
    if (r.method === 'PATCH') return { status: 204, body: undefined };
    throw new Error('unexpected request ' + r.method + ' ' + r.path);
  });
  const result = await tf.ensureTraceFlag(HOST, { force: true, durationMinutes: 30 });
  assert.equal(result.success, true);
  const patch = requests.find(r => r.method === 'PATCH');
  assert.equal(patch.path, '/services/data/v62.0/tooling/sobjects/TraceFlag/7tfxx0000000001AAA');
  assert.deepEqual(Object.keys(patch.body), ['ExpirationDate'], 'start and debug level stay as they are');
  assert.ok(Math.abs(new Date(patch.body.ExpirationDate) - (now + 30 * 60000)) < 5000);
  assert.ok(alarms.has('cleanup_traceflag_7tfxx0000000001AAA'));
  assert.equal(store.autoTraceFlags[0].orgDomain, HOST);
});

test('L2 24-hour rule: an old start moves to now; a scheduled flag is never moved', async () => {
  setup();
  const now = Date.now();
  let flag = { Id: '7tfxx0000000001AAA', StartDate: new Date(now - 23.9 * HOUR).toISOString(), ExpirationDate: new Date(now - HOUR).toISOString(), DebugLevelId: '7dlxx0000000009AAA' };
  const requests = fakeSalesforce((r) => {
    if (r.query && r.query.includes('FROM TraceFlag')) return { records: [flag] };
    if (r.query && r.query.includes('FROM DebugLevel')) return { records: [{ Id: '7dlxx0000000DEVAAA', DeveloperName: 'SFDC_DevConsole' }] };
    if (r.method === 'PATCH') return { status: 204, body: undefined };
    if (r.method === 'POST' && r.path.endsWith('/TraceFlag/')) return { status: 201, body: { id: '7tfxx0000000NEWAAA', success: true } };
    throw new Error('unexpected request');
  });
  await tf.ensureTraceFlag(HOST, { durationMinutes: 45 });
  let patch = requests.filter(r => r.method === 'PATCH').pop();
  assert.ok(patch.body.StartDate, 'expired flag that started 23.9 h ago: 45 more minutes would pass 24 h');
  assert.ok(Math.abs(new Date(patch.body.StartDate) - now) < 5000);

  // A flag the user scheduled for later keeps its schedule: a new flag is created for now
  requests.length = 0;
  flag = { ...flag, StartDate: new Date(now + 5 * HOUR).toISOString(), ExpirationDate: new Date(now + 6 * HOUR).toISOString() };
  await tf.ensureTraceFlag(HOST, { durationMinutes: 45 });
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 0, 'scheduled flag must not be moved');
  const create = requests.find(r => r.method === 'POST' && r.path.endsWith('/TraceFlag/'));
  assert.ok(create, 'a new flag is created for now');
  assert.ok(Math.abs(new Date(create.body.StartDate) - now) < 5000);

  flag = { ...flag, StartDate: new Date(now - 2 * HOUR).toISOString(), ExpirationDate: new Date(now - HOUR).toISOString() };
  await tf.ensureTraceFlag(HOST, { durationMinutes: 45 });
  patch = requests.filter(r => r.method === 'PATCH').pop();
  assert.equal(patch.body.StartDate, undefined, 'recent start within 24 h is kept');
});

test('L2 no flag: create one with SFDC_DevConsole, or create the SmartDebugLog level once', async () => {
  setup();
  let levels = [];
  const requests = fakeSalesforce((r) => {
    if (r.query && r.query.includes('FROM TraceFlag')) return { records: [] };
    if (r.query && r.query.includes('FROM DebugLevel')) return { records: levels };
    if (r.method === 'POST' && r.path.endsWith('/DebugLevel/')) return { status: 201, body: { id: '7dlxx0000000NEWAAA', success: true } };
    if (r.method === 'POST' && r.path.endsWith('/TraceFlag/')) return { status: 201, body: { id: '7tfxx0000000NEWAAA', success: true } };
    throw new Error('unexpected request ' + r.method + ' ' + r.path);
  });

  levels = [{ Id: '7dlxx0000000DEVAAA', DeveloperName: 'SFDC_DevConsole' }, { Id: '7dlxx0000000SDLAAA', DeveloperName: 'SmartDebugLog' }];
  await tf.ensureTraceFlag(HOST);
  let create = requests.find(r => r.method === 'POST' && r.path.endsWith('/TraceFlag/'));
  assert.equal(create.body.DebugLevelId, '7dlxx0000000DEVAAA');
  assert.equal(create.body.LogType, 'USER_DEBUG');
  assert.equal(create.body.TracedEntityId, USER);

  requests.length = 0;
  levels = [];
  await tf.ensureTraceFlag(HOST);
  const levelCreate = requests.find(r => r.method === 'POST' && r.path.endsWith('/DebugLevel/'));
  assert.deepEqual(levelCreate.body, {
    DeveloperName: 'SmartDebugLog', MasterLabel: 'Smart Debug Log', ApexCode: 'FINEST', ApexProfiling: 'INFO',
    Callout: 'INFO', Database: 'INFO', System: 'DEBUG', Validation: 'INFO', Visualforce: 'INFO', Wave: 'INFO', Nba: 'INFO', Workflow: 'INFO'
  });
  create = requests.find(r => r.method === 'POST' && r.path.endsWith('/TraceFlag/'));
  assert.equal(create.body.DebugLevelId, '7dlxx0000000NEWAAA');
  assert.ok(!requests.some(r => r.query && /FROM DebugLevel LIMIT 1/.test(r.query)), 'never picks an arbitrary level');

  requests.length = 0;
  levels = [{ Id: '7dlxx0000000SDLAAA', DeveloperName: 'SmartDebugLog' }];
  await tf.ensureTraceFlag(HOST);
  assert.ok(!requests.some(r => r.path.endsWith('/DebugLevel/')), 'SmartDebugLog is reused, not created again');
});

const expiredMetadata = (extra = {}) => ({
  traceFlagId: '7tfxx0000000001AAA', userId: USER, orgDomain: HOST,
  startTime: '2026-10-03T08:00:00.000Z', expirationDate: '2026-10-03T08:45:00.000Z', ...extra
});

test('D1 cleanup is off by default: the alarm only forgets the flag, no logs are queried or deleted', async () => {
  const { store, alarms } = setup({ autoTraceFlags: [expiredMetadata()] });
  alarms.set('cleanup_traceflag_7tfxx0000000001AAA', {});
  const requests = fakeSalesforce(() => { throw new Error('must not call Salesforce'); });
  await tf.cleanupExpiredTraceFlagLogs('7tfxx0000000001AAA');
  assert.equal(requests.length, 0);
  assert.deepEqual(store.autoTraceFlags, []);
  assert.equal(alarms.size, 0);
});

test('D1 opted in: deletes only Monitoring logs of that user in the window, past 200, then broadcasts', async () => {
  const { store, sent } = setup({ autoTraceFlags: [expiredMetadata()], autoCleanupLogs: true });
  const ids = Array.from({ length: 230 }, (_, i) => '07L' + String(i).padStart(15, '0'));
  const queries = [];
  fakeSalesforce((r) => {
    if (r.query) {
      queries.push(r.query);
      const after = /Id > '(\w+)'/.exec(r.query);
      return { records: ids.filter(id => !after || id > after[1]).slice(0, 200).map(Id => ({ Id })) };
    }
    return r.ids.split(',').map(id => ({ id, success: true, errors: [] }));
  });
  await tf.cleanupExpiredTraceFlagLogs('7tfxx0000000001AAA');
  assert.match(queries[0], new RegExp(`WHERE LogUserId = '${USER}' AND Location = 'Monitoring' AND StartTime >= 2026-10-03T08:00:00.000Z AND StartTime <= 2026-10-03T08:45:00.000Z`));
  assert.equal(queries.length, 2);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'LOGS_DELETED');
  assert.equal(sent[0].logIds.length, 230);
  assert.deepEqual(store.autoTraceFlags, []);
});

test('D1 a failed query keeps the metadata for a retry, at most 3 tries', async () => {
  const { store, alarms } = setup({ autoTraceFlags: [expiredMetadata()], autoCleanupLogs: true });
  fakeSalesforce(() => ({ status: 503, body: [{ message: 'Service unavailable' }] }));
  await tf.cleanupExpiredTraceFlagLogs('7tfxx0000000001AAA');
  assert.equal(store.autoTraceFlags[0].cleanupAttempts, 1);
  assert.ok(alarms.get('cleanup_traceflag_7tfxx0000000001AAA').when > Date.now());
  await tf.cleanupExpiredTraceFlagLogs('7tfxx0000000001AAA');
  assert.equal(store.autoTraceFlags[0].cleanupAttempts, 2);
  await tf.cleanupExpiredTraceFlagLogs('7tfxx0000000001AAA');
  assert.deepEqual(store.autoTraceFlags, [], 'gives up after the third failure');
  assert.equal(alarms.size, 0);
});

test('D1 changing or deleting a flag never deletes logs; it only updates or drops metadata + alarm', async () => {
  const future = new Date(Date.now() + 2 * HOUR).toISOString();
  const { store, alarms } = setup({ autoTraceFlags: [expiredMetadata({ expirationDate: future })], autoCleanupLogs: true });
  const requests = fakeSalesforce(() => { throw new Error('must not call Salesforce'); });

  const later = new Date(Date.now() + 3 * HOUR).toISOString();
  await tf.updateAutoTraceFlagWindow('7tfxx0000000001AAA', later);
  assert.equal(store.autoTraceFlags[0].expirationDate, later);
  assert.equal(alarms.get('cleanup_traceflag_7tfxx0000000001AAA').when, new Date(later).getTime());

  await tf.updateAutoTraceFlagWindow('7tfxx0000000001AAA', new Date().toISOString()); // Reduce to now
  assert.deepEqual(store.autoTraceFlags, []);
  assert.equal(alarms.size, 0);

  store.autoTraceFlags = [expiredMetadata({ expirationDate: future })];
  alarms.set('cleanup_traceflag_7tfxx0000000001AAA', {});
  await tf.forgetAutoTraceFlag('7tfxx0000000001AAA'); // Delete / Replace
  assert.deepEqual(store.autoTraceFlags, []);
  assert.equal(alarms.size, 0);
  assert.equal(requests.length, 0);
});

test('L16 reconcile: re-creates alarms, cleans up expired flags, drops entries older than 7 days', async () => {
  const now = Date.now();
  const { store, alarms } = setup({
    autoTraceFlags: [
      expiredMetadata({ traceFlagId: '7tfxx000000000FUT', expirationDate: new Date(now + HOUR).toISOString() }),
      expiredMetadata({ traceFlagId: '7tfxx000000000EXP', expirationDate: new Date(now - HOUR).toISOString() }),
      expiredMetadata({ traceFlagId: '7tfxx000000000OLD', expirationDate: new Date(now - 8 * 24 * HOUR).toISOString() })
    ]
  });
  fakeSalesforce(() => { throw new Error('cleanup is off, no calls expected'); });
  await tf.reconcileAutoTraceFlags(now);
  assert.deepEqual([...alarms.keys()], ['cleanup_traceflag_7tfxx000000000FUT']);
  assert.equal(alarms.get('cleanup_traceflag_7tfxx000000000FUT').when, now + HOUR);
  assert.deepEqual(store.autoTraceFlags.map(t => t.traceFlagId), ['7tfxx000000000FUT']);
});

test('F2 status reads real trace flags of any LogType, active or scheduled', async () => {
  setup();
  const now = new Date('2026-10-03T10:00:00.000Z');
  let records = [];
  const requests = fakeSalesforce(() => ({ records }));

  records = [{ Id: 'a', LogType: 'DEVELOPER_LOG', StartDate: '2026-10-03T09:30:00.000+0000', ExpirationDate: '2026-10-03T10:30:00.000+0000', DebugLevel: { DeveloperName: 'SFDC_DevConsole' } }];
  assert.deepEqual(await tf.getTraceFlagStatus(HOST, now), {
    active: true, scheduled: false, startTime: '2026-10-03T09:30:00.000+0000', expirationDate: '2026-10-03T10:30:00.000+0000', logType: 'DEVELOPER_LOG', debugLevel: 'SFDC_DevConsole'
  });
  assert.match(requests[0].query, new RegExp(`WHERE TracedEntityId = '${USER}' AND ExpirationDate > 2026-10-03T10:00:00.000Z`));
  assert.doesNotMatch(requests[0].query, /LogType =/);

  records = [{ Id: 'b', LogType: 'USER_DEBUG', StartDate: '2026-10-03T12:00:00.000+0000', ExpirationDate: '2026-10-03T13:00:00.000+0000', DebugLevel: { DeveloperName: 'Mine' } }];
  const scheduled = await tf.getTraceFlagStatus(HOST, now);
  assert.equal(scheduled.active, false);
  assert.equal(scheduled.scheduled, true);

  records = [];
  assert.deepEqual(await tf.getTraceFlagStatus(HOST, now), { active: false });
});

test('F2 local fallback only matches flags of this org (no null-org match)', async () => {
  const future = new Date(Date.now() + HOUR).toISOString();
  setup({ autoTraceFlags: [expiredMetadata({ orgDomain: null, expirationDate: future }), expiredMetadata({ orgDomain: 'other.my.salesforce.com', expirationDate: future })] });
  assert.deepEqual(await tf.getLocalTraceFlagStatus(HOST), { active: false });
  setup({ autoTraceFlags: [expiredMetadata({ expirationDate: future })] });
  assert.equal((await tf.getLocalTraceFlagStatus(HOST)).active, true);
});
