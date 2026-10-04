'use strict';
// Manage Debug Logs modal behaviour: L6 countdown and replace dialog, L17 user search, Other User
// and Escape, F1 Delete All, M6 log storage meter and auto-delete toggle, D2 org host, S8 text only.
const test = require('node:test');
const assert = require('node:assert');
const { loadScripts, dashboardBody, flush } = require('./track-c-dom');

const MANAGER_FILES = ['js/core/icons.js', 'js/core/basic-utilities.js', 'js/debug-manager/debug-level-creator.js', 'js/debug-manager/debug-log-manager-ui.js',
  'js/debug-manager/debug-log-ui-api.js', 'js/debug-manager/debug-log-ui-traceflags.js', 'js/debug-manager/debug-log-ui-rendering.js'];
const NOW = Date.UTC(2026, 9, 3, 10, 0, 0);
const MIN = 60 * 1000, HOUR = 60 * MIN, MB = 1024 * 1024;
const ME = '005Hn00000AbCdE';
const HOST = 'acme.my.salesforce.com';
const iso = ms => new Date(ms).toISOString();

function flag(id, props = {}) {
  return {
    Id: id, LogType: 'USER_DEBUG', TracedEntityId: ME, TracedEntity: { Name: 'Me' }, CreatedBy: { Name: 'Me' },
    DebugLevelId: '7dl000000000001', DebugLevel: { DeveloperName: 'SFDC_DevConsole' },
    StartDate: iso(NOW - 15 * MIN), ExpirationDate: iso(NOW + 45 * MIN), ...props
  };
}

function setup({ flags = [], respond, search, storage, signedIn = true } = {}) {
  const env = loadScripts(MANAGER_FILES, {
    html: dashboardBody(),
    now: NOW,
    search,
    storage,
    handler: async message => {
      const custom = respond && await respond(message);
      if (custom) return custom;
      if (message.type === 'EXECUTE_TOOLING_QUERY') return { success: true, data: { records: /FROM TraceFlag/.test(message.query) ? flags : [] } };
      if (message.type === 'GET_USER_INFO') return { success: true, data: { userId: ME, orgId: '00D5g000004XyZaEAQ' } };
      if (message.type === 'GET_LOG_STORAGE') return { success: true, data: { totalBytes: 312 * MB, logCount: 40, limitBytes: 1000 * MB } };
      return { success: true, data: {} };
    }
  });
  const ui = env.ctx.debugLogManagerUI;
  if (signedIn) {
    ui.sfHost = HOST;
    ui.userId = ME;
    ui.selectedUserId = ME;
  }
  ui.traceFlags = flags;
  ui.setupModalEventListeners();
  return { env, ui };
}

const notification = env => env.document.querySelector('.debug-notification')?.textContent;
const sentOfType = (env, type) => env.sent.filter(m => m.type === type);

test('L6: the list countdown updates and an expired row gets its new buttons', () => {
  const { env, ui } = setup({ flags: [flag('7tf1')] });
  const doc = env.document;
  ui.renderTraceFlags();

  let row = doc.querySelector('#traceFlagsList .trace-flag-item');
  assert.strictEqual(row.dataset.id, '7tf1', 'the row carries the id');
  assert.strictEqual(row.querySelectorAll('[data-id]').length, 0, 'buttons do not');
  assert.strictEqual(row.querySelector('.trace-flag-countdown').textContent, '45min left');

  env.clock.now += 30 * MIN;
  ui.updateTraceFlagTimers();
  assert.strictEqual(doc.querySelector('.trace-flag-countdown').textContent, '15min left');
  assert.ok(doc.querySelector('.trace-flag-expires').classList.contains('trace-flag-expires'));

  env.clock.now += 16 * MIN;
  ui.updateTraceFlagTimers();
  row = doc.querySelector('#traceFlagsList .trace-flag-item');
  assert.strictEqual(row.dataset.state, 'expired');
  assert.deepStrictEqual(row.querySelectorAll('button').map(b => b.title), ['Reactivate for 45min', 'Delete']);
});

test('L6: closing the modal closes the replace dialog; a later confirm runs only once', async () => {
  const active = flag('7tfOLD');
  const { env, ui } = setup({ flags: [active] });
  const doc = env.document;
  const dialog = doc.getElementById('replaceConfirmationDialog');
  doc.getElementById('debugLogManagerModal').style.display = 'flex';

  const first = ui.showReplaceConfirmation(active, '7dl000000000002', 45);
  ui.closeModal();
  assert.ok(dialog.classList.contains('hidden'));
  assert.strictEqual(await first, false);

  // Reopen, Escape closes only the dialog
  doc.getElementById('debugLogManagerModal').style.display = 'flex';
  const second = ui.showReplaceConfirmation(active, '7dl000000000002', 45);
  env.key(doc, 'Escape');
  assert.strictEqual(await second, false);
  assert.strictEqual(doc.getElementById('debugLogManagerModal').style.display, 'flex');

  const third = ui.showReplaceConfirmation(active, '7dl000000000002', 45);
  doc.getElementById('confirmReplaceBtn').click();
  assert.strictEqual(await third, true);
  await flush();
  assert.strictEqual(sentOfType(env, 'TOOLING_UPDATE').length, 1);
  assert.strictEqual(sentOfType(env, 'TOOLING_DELETE').length + sentOfType(env, 'TOOLING_CREATE').length, 0);
});

test('L17: the replace dialog is worded by the real state of the flag', () => {
  const scheduled = flag('7tfLATER', { StartDate: iso(NOW + 2 * HOUR), ExpirationDate: iso(NOW + 3 * HOUR) });
  const { env, ui } = setup({ flags: [scheduled] });
  const text = id => env.document.getElementById(id).textContent;

  ui.showReplaceConfirmation(scheduled, '7dl000000000002', 45);
  assert.strictEqual(text('confirmTitle'), 'Replace Scheduled Debug Log?');
  assert.strictEqual(text('confirmTimeLabel'), 'Starts In:');
  assert.strictEqual(text('confirmTimeRemaining'), '2hr');

  ui.showReplaceConfirmation(flag('7tfNOW'), '7dl000000000002', 45);
  assert.strictEqual(text('confirmTitle'), 'Replace Active Debug Log?');
  assert.strictEqual(text('confirmTimeLabel'), 'Time Remaining:');
  assert.strictEqual(text('confirmTimeRemaining'), '45min');
});

test('L17: Escape only acts when the Manage Debug Logs modal is open', () => {
  const { env, ui } = setup();
  let closed = 0;
  ui.closeModal = () => { closed++; };
  env.document.getElementById('debugLogManagerModal').style.display = 'none';
  env.key(env.document, 'Escape'); // e.g. the Apex modal is the one open
  assert.strictEqual(closed, 0);
  env.document.getElementById('debugLogManagerModal').style.display = 'flex';
  env.key(env.document, 'Escape');
  assert.strictEqual(closed, 1);
});

test('L17: a slow, older user search cannot replace newer results', async () => {
  const pending = [];
  const { env, ui } = setup({ respond: m => m.type === 'SEARCH_USERS' ? new Promise(resolve => pending.push({ term: m.searchTerm, resolve })) : null });
  const input = env.document.getElementById('userSearchInput');

  input.value = 'an'; const older = ui.handleUserSearch();
  input.value = 'ann'; const newer = ui.handleUserSearch();
  await flush();
  pending.find(p => p.term === 'ann').resolve({ success: true, data: [{ Id: '005B', Name: 'Ann Lee', Username: 'ann@acme.com' }] });
  await newer;
  pending.find(p => p.term === 'an').resolve({ success: true, data: [{ Id: '005C', Name: 'Andrew', Username: 'andrew@acme.com' }] });
  await older;

  const names = env.document.querySelectorAll('.user-result-name').map(n => n.textContent);
  assert.deepStrictEqual(names, ['Ann Lee']);
});

test('L17 / S8: a failed search shows its message as text', async () => {
  const { env, ui } = setup({ respond: m => m.type === 'SEARCH_USERS' ? { success: false, error: '<img src=x onerror=alert(1)>' } : null });
  env.document.getElementById('userSearchInput').value = 'ann';
  await ui.handleUserSearch();
  const results = env.document.getElementById('userSearchResults');
  assert.strictEqual(results.querySelectorAll('img').length, 0);
  assert.strictEqual(results.textContent, 'Search failed: <img src=x onerror=alert(1)>');
});

test('L17: "Other User" with nobody picked never falls back to the current user', async () => {
  const { env, ui } = setup();
  const doc = env.document;
  doc.getElementById('debugLevelSelect').innerHTML = '<option value="7dl1">Level</option>';
  const other = doc.getElementById('otherUserRadio');
  other.checked = true;
  env.change(other);

  await ui.handleEnableDebug();
  assert.strictEqual(notification(env), 'Search for a user and select them first');
  await ui.handleDeleteAllLogs();
  assert.strictEqual(notification(env), 'Search for a user and select them first');
  assert.strictEqual(sentOfType(env, 'TOOLING_CREATE').length + sentOfType(env, 'DELETE_APEX_LOGS').length, 0);

  ui.selectUser('005OTHER', 'Ann Lee');
  await flush();
  await ui.handleDeleteAllLogs();
  assert.strictEqual(sentOfType(env, 'DELETE_APEX_LOGS')[0].userId, '005OTHER');
  assert.match(env.confirms.at(-1), /Ann Lee/);
});

test('F1: Delete All sends one DELETE_APEX_LOGS and reports what happened', async () => {
  const outcomes = [
    [{ deleted: 0, failed: 0, errors: [], deletedIds: [] }, 'No logs to delete'],
    [{ deleted: 3, failed: 0, errors: [], deletedIds: ['07L1', '07L2', '07L3'] }, 'Deleted 3 logs'],
    [{ deleted: 2, failed: 1, errors: ['Tooling delete failed: 403 - [{"message":"insufficient access rights on object id","errorCode":"INSUFFICIENT_ACCESS"}]'], deletedIds: ['07L1', '07L2'] },
      'Deleted 2, failed 1: insufficient access rights on object id']
  ];
  for (const [data, expected] of outcomes) {
    const { env, ui } = setup({ respond: m => m.type === 'DELETE_APEX_LOGS' ? { success: true, data } : null });
    await ui.handleDeleteAllLogs();
    const deletes = sentOfType(env, 'DELETE_APEX_LOGS');
    assert.deepStrictEqual(deletes, [{ type: 'DELETE_APEX_LOGS', userId: ME, sfHost: HOST }]);
    assert.strictEqual(sentOfType(env, 'TOOLING_DELETE').length, 0);
    assert.strictEqual(notification(env), expected);
    assert.match(env.confirms[0], new RegExp(HOST.replace(/\./g, '\\.')));
    assert.match(env.confirms[0], /your user/);
  }
});

test('M6: the log storage meter shows usage and warns from 80%', async () => {
  let totalBytes = 312 * MB;
  const { env, ui } = setup({ respond: m => m.type === 'GET_LOG_STORAGE' ? { success: true, data: { totalBytes, logCount: 9, limitBytes: 1000 * MB } } : null });
  const doc = env.document;

  await ui.refreshLogStorage();
  assert.strictEqual(doc.getElementById('logStorageText').textContent, 'Org log storage: 312 MB of 1,000 MB');
  assert.ok(!doc.getElementById('logStorageMeter').classList.contains('hidden'));
  assert.ok(doc.getElementById('logStorageWarning').classList.contains('hidden'));

  totalBytes = 850 * MB;
  await ui.refreshLogStorage();
  assert.ok(doc.getElementById('logStorageMeter').classList.contains('warn'));
  assert.ok(!doc.getElementById('logStorageWarning').classList.contains('hidden'));
  assert.strictEqual(doc.getElementById('logStorageFill').style.width, '85%');
  assert.deepStrictEqual(sentOfType(env, 'GET_LOG_STORAGE')[0], { type: 'GET_LOG_STORAGE', sfHost: HOST });
});

test('M6: the auto-delete toggle reads and saves autoCleanupLogs (off by default)', async () => {
  let { env, ui } = setup();
  const toggle = () => env.document.getElementById('autoCleanupToggle');
  await ui.loadAutoCleanupSetting();
  assert.strictEqual(toggle().checked, false);
  toggle().checked = true;
  env.change(toggle());
  await flush();
  assert.strictEqual(env.storageData.autoCleanupLogs, true);

  ({ env, ui } = setup({ storage: { autoCleanupLogs: true } }));
  await ui.loadAutoCleanupSetting();
  assert.strictEqual(toggle().checked, true);
});

test('D2: the modal uses the host from the URL even without a browser session', async () => {
  const { env, ui } = setup({ signedIn: false });
  assert.strictEqual(ui.sfHost, null, 'initialize() was never called');
  await ui.openModal();
  await flush();
  const messages = env.sent.filter(m => ['GET_USER_INFO', 'EXECUTE_TOOLING_QUERY', 'GET_LOG_STORAGE'].includes(m.type));
  assert.ok(messages.length >= 3);
  assert.ok(messages.every(m => m.sfHost === HOST), 'every message names the org');
  ui.closeModal();
});

test('D2: without a host in the URL nothing is sent to whichever org logged in last', async () => {
  const { env, ui } = setup({ signedIn: false, search: '' });
  await ui.openModal();
  await flush();
  assert.strictEqual(env.sent.length, 0);
  assert.strictEqual(notification(env), 'No Salesforce org selected. Reopen the dashboard from a Salesforce tab.');
});

test('S8: the header status text is set as text', () => {
  const scheduled = flag('7tfLATER', { StartDate: iso(NOW + 2 * HOUR), ExpirationDate: iso(NOW + 3 * HOUR), DebugLevel: { DeveloperName: '<b>Level</b>' } });
  const { env, ui } = setup({ flags: [scheduled] });
  ui.updateStatusIndicator();
  const text = env.document.getElementById('traceStatusText');
  assert.strictEqual(text.querySelectorAll('b').length, 0);
  assert.strictEqual(text.textContent, 'Scheduled: starts in 2hr • <b>Level</b>');
});
