'use strict';
// Trace flag changes in the Manage Debug Logs modal:
// L3 extend respects the 24 hour StartDate rule, D3 replace/reactivate change the flag in place,
// D4 custom times never move an active flag, F2 all log types are listed and conflicts are per LogType.
const test = require('node:test');
const assert = require('node:assert');
const { loadScripts, dashboardBody, flush } = require('./track-c-dom');

const MANAGER_FILES = ['js/icons.js', 'js/basic-utilities.js', 'js/debug-level-creator.js', 'js/debug-log-manager-ui.js',
  'js/debug-log-ui-api.js', 'js/debug-log-ui-traceflags.js', 'js/debug-log-ui-rendering.js'];
const NOW = Date.UTC(2026, 9, 3, 10, 0, 0);
const MIN = 60 * 1000, HOUR = 60 * MIN;
const ME = '005Hn00000AbCdE';
const DEV_LEVEL = { Id: '7dl000000000001', DeveloperName: 'SFDC_DevConsole', MasterLabel: 'SFDC_DevConsole' };
const FINEST_LEVEL = { Id: '7dl000000000002', DeveloperName: 'Apex_Finest', MasterLabel: 'Apex Finest' };
const iso = ms => new Date(ms).toISOString();

function flag(id, props = {}) {
  return {
    Id: id, LogType: 'USER_DEBUG', TracedEntityId: ME, TracedEntity: { Name: 'Me' }, CreatedBy: { Name: 'Me' },
    DebugLevelId: DEV_LEVEL.Id, DebugLevel: { DeveloperName: DEV_LEVEL.DeveloperName },
    StartDate: iso(NOW - 10 * MIN), ExpirationDate: iso(NOW + 35 * MIN), ...props
  };
}

function setup({ flags = [], levels = [DEV_LEVEL, FINEST_LEVEL], respond } = {}) {
  const state = { flags };
  const env = loadScripts(MANAGER_FILES, {
    html: dashboardBody(),
    now: NOW,
    handler: async message => {
      const custom = respond && await respond(message);
      if (custom) return custom;
      if (message.type === 'EXECUTE_TOOLING_QUERY') {
        if (/FROM TraceFlag/.test(message.query)) return { success: true, data: { records: state.flags } };
        if (/FROM DebugLevel/.test(message.query)) return { success: true, data: { records: levels } };
        return { success: true, data: { records: [] } };
      }
      if (message.type === 'TOOLING_CREATE') return { success: true, data: { id: '7tfNEW' } };
      return { success: true, data: {} };
    }
  });
  const ui = env.ctx.debugLogManagerUI;
  ui.sfHost = 'acme.my.salesforce.com';
  ui.userId = ME;
  ui.selectedUserId = ME;
  ui.traceFlags = flags;
  ui.debugLevels = levels;
  ui.renderDebugLevels();
  return { env, ui, state };
}

const sentOfType = (env, type) => env.sent.filter(m => m.type === type);
const notification = env => env.document.querySelector('.debug-notification')?.textContent;

test('L3: extend stays inside the 24 hour limit', () => {
  const { ui } = setup();
  const now = new Date(NOW);

  // Normal case: only the expiration moves
  let ext = ui.computeExtension(flag('7tf1'), 45, now);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ext.data)), { ExpirationDate: iso(NOW + 80 * MIN) });

  // Would end more than 24 hours after StartDate: restart now (tracing goes on)
  ext = ui.computeExtension(flag('7tf1', { StartDate: iso(NOW - 23.5 * HOUR), ExpirationDate: iso(NOW + 20 * MIN) }), 45, now);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ext.data)), { StartDate: iso(NOW), ExpirationDate: iso(NOW + 65 * MIN) });
  assert.strictEqual(ext.capped, false);

  // Would end more than 24 hours from now: cap at now + 24 hours
  ext = ui.computeExtension(flag('7tf1', { StartDate: iso(NOW - HOUR), ExpirationDate: iso(NOW + 23 * HOUR) }), 240, now);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ext.data)), { StartDate: iso(NOW), ExpirationDate: iso(NOW + 24 * HOUR) });
  assert.strictEqual(ext.capped, true);
});

test('L3: Extend uses the selected duration and sends a valid update', async () => {
  const { env, ui } = setup({ flags: [flag('7tf1', { StartDate: iso(NOW - 20 * HOUR), ExpirationDate: iso(NOW + 3 * HOUR) })] });
  env.document.getElementById('debugDurationSelect').value = '240';
  ui.renderTraceFlags();
  const extend = [...env.document.querySelectorAll('#traceFlagsList button')].find(b => b.textContent.startsWith('Extend'));
  assert.strictEqual(extend.textContent, 'Extend +4hr');
  extend.click();
  await flush();

  const [update] = sentOfType(env, 'TOOLING_UPDATE');
  assert.deepStrictEqual(update.data, { StartDate: iso(NOW), ExpirationDate: iso(NOW + 7 * HOUR) });
  assert.strictEqual(new Date(update.data.ExpirationDate) - new Date(update.data.StartDate) <= 24 * HOUR, true);
});

test('L3: Reduce asks before it ends the flag and never sends a time in the past', async () => {
  let answer = false;
  const { env, ui } = setup({ flags: [flag('7tf1', { ExpirationDate: iso(NOW + 30 * MIN) })] });
  env.ctx.confirm = () => answer;
  await ui.handleReduceTraceFlag('7tf1'); // 45 min > 30 min left: needs a yes
  assert.strictEqual(sentOfType(env, 'TOOLING_UPDATE').length, 0);

  answer = true;
  await ui.handleReduceTraceFlag('7tf1');
  const [update] = sentOfType(env, 'TOOLING_UPDATE');
  assert.deepStrictEqual(update.data, { ExpirationDate: iso(NOW) });
  assert.strictEqual(notification(env), 'Trace flag stopped. Logging has ended.');
});

test('D3: Replace changes the existing flag in place (no delete + create)', async () => {
  const active = flag('7tfOLD');
  const { env, ui } = setup({ flags: [active] });
  env.document.getElementById('debugLevelSelect').value = FINEST_LEVEL.Id;

  const done = ui.handleEnableDebug();
  await flush();
  assert.ok(!env.document.getElementById('replaceConfirmationDialog').classList.contains('hidden'));
  env.document.getElementById('confirmReplaceBtn').click();
  await done;
  await flush();

  assert.strictEqual(sentOfType(env, 'TOOLING_DELETE').length, 0);
  assert.strictEqual(sentOfType(env, 'TOOLING_CREATE').length, 0);
  const updates = sentOfType(env, 'TOOLING_UPDATE');
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].recordId, '7tfOLD');
  assert.deepStrictEqual(updates[0].data, { DebugLevelId: FINEST_LEVEL.Id, StartDate: iso(NOW), ExpirationDate: iso(NOW + 45 * MIN) });
  assert.strictEqual(notification(env), 'Debug log replaced successfully');
});

test('D3: a refused Replace keeps the old flag and shows the real reason', async () => {
  const error = 'Tooling update failed: 400 - [{"message":"Expiration date must be within 24 hours of the start date","errorCode":"FIELD_INTEGRITY_EXCEPTION"}]';
  const { env, ui } = setup({ flags: [flag('7tfOLD')], respond: m => m.type === 'TOOLING_UPDATE' ? { success: false, error } : null });
  env.document.getElementById('debugLevelSelect').value = FINEST_LEVEL.Id;

  const done = ui.handleEnableDebug();
  await flush();
  env.document.getElementById('confirmReplaceBtn').click();
  await done;
  await flush();

  assert.strictEqual(sentOfType(env, 'TOOLING_DELETE').length, 0, 'the old flag is never deleted');
  assert.strictEqual(sentOfType(env, 'TOOLING_UPDATE').length, 1, 'no retries');
  assert.strictEqual(notification(env), 'Could not replace the trace flag: Expiration date must be within 24 hours of the start date');
});

test('D3: Reactivate changes the expired flag in place and checks scheduled flags too', async () => {
  const expired = flag('7tfEXP', { StartDate: iso(NOW - 3 * HOUR), ExpirationDate: iso(NOW - 2 * HOUR) });
  const scheduled = flag('7tfLATER', { StartDate: iso(NOW + 30 * MIN), ExpirationDate: iso(NOW + 2 * HOUR) });

  let { env, ui } = setup({ flags: [expired, scheduled] });
  await ui.handleReactivateTraceFlag('7tfEXP');
  assert.strictEqual(sentOfType(env, 'TOOLING_UPDATE').length, 0);
  assert.match(notification(env), /already has an active or scheduled trace flag/);

  ({ env, ui } = setup({ flags: [expired] }));
  await ui.handleReactivateTraceFlag('7tfEXP');
  assert.strictEqual(sentOfType(env, 'TOOLING_DELETE').length + sentOfType(env, 'TOOLING_CREATE').length, 0);
  const [update] = sentOfType(env, 'TOOLING_UPDATE');
  assert.strictEqual(update.recordId, '7tfEXP');
  assert.deepStrictEqual(update.data, { DebugLevelId: DEV_LEVEL.Id, StartDate: iso(NOW), ExpirationDate: iso(NOW + 45 * MIN) });
});

test('D4: a custom time with SFDC_DevConsole never moves an active flag that does not overlap', async () => {
  const active = flag('7tfACTIVE', { ExpirationDate: iso(NOW + HOUR) });
  const { env, ui } = setup({ flags: [active] });

  const result = await ui.createOrExtendTraceFlagWithExpiration(DEV_LEVEL.Id, 60, new Date(NOW + 4 * HOUR), new Date(NOW + 3 * HOUR));

  assert.strictEqual(sentOfType(env, 'TOOLING_UPDATE').length, 0, 'the active flag is not touched');
  const [create] = sentOfType(env, 'TOOLING_CREATE');
  assert.deepStrictEqual(create.data, {
    TracedEntityId: ME, LogType: 'USER_DEBUG', StartDate: iso(NOW + 3 * HOUR), ExpirationDate: iso(NOW + 4 * HOUR), DebugLevelId: DEV_LEVEL.Id
  });
  assert.ok(!result.replaced);
});

test('D4: an expired SFDC_DevConsole flag is reused, and the message says what happened', async () => {
  const expired = flag('7tfEXP', { StartDate: iso(NOW - 3 * HOUR), ExpirationDate: iso(NOW - 2 * HOUR) });
  const { env, ui } = setup({ flags: [expired] });
  const doc = env.document;
  doc.getElementById('debugLevelSelect').value = DEV_LEVEL.Id;
  doc.getElementById('modeDuration').checked = false;
  doc.getElementById('modeCustom').checked = true;
  const pad = n => String(n).padStart(2, '0');
  const localDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const localTime = ms => new Date(ms).toTimeString().slice(0, 5);
  doc.getElementById('customStartDate').value = localDate(NOW + 3 * HOUR);
  doc.getElementById('customEndDate').value = localDate(NOW + 4 * HOUR);
  doc.getElementById('customStartTime').value = localTime(NOW + 3 * HOUR);
  doc.getElementById('customEndTime').value = localTime(NOW + 4 * HOUR);

  await ui.handleEnableDebug();

  const [update] = sentOfType(env, 'TOOLING_UPDATE');
  assert.strictEqual(update.recordId, '7tfEXP');
  assert.strictEqual(sentOfType(env, 'TOOLING_CREATE').length, 0);
  assert.match(notification(env), /^Debug logging scheduled for you from /);
});

test('F2: all log types are listed with their creator; conflicts and the header use USER_DEBUG only', async () => {
  const devConsole = flag('7tfDEV', { LogType: 'DEVELOPER_LOG', CreatedBy: { Name: 'Sam Gillingham' }, ExpirationDate: iso(NOW + HOUR) });
  const classFlag = flag('7tfCLS', { LogType: 'CLASS_TRACING', TracedEntityId: '01p000000000001', TracedEntity: { Name: 'AccountService' } });
  const { env, ui } = setup({ flags: [devConsole, classFlag] });

  await ui.listTraceFlags();
  const query = sentOfType(env, 'EXECUTE_TOOLING_QUERY').find(m => /FROM TraceFlag/.test(m.query)).query;
  assert.match(query, /LogType IN \('USER_DEBUG', 'DEVELOPER_LOG', 'CLASS_TRACING'\)/);
  assert.match(query, /CreatedBy\.Name/);

  // A Developer Console flag does not block a USER_DEBUG flag for the same user
  assert.strictEqual(ui.checkTimeConflict(new Date(NOW), new Date(NOW + HOUR), ME), undefined);
  assert.strictEqual(env.document.getElementById('traceStatusIndicator').style.display, 'none');

  ui.renderTraceFlags();
  const rows = env.document.querySelectorAll('#traceFlagsList .trace-flag-item');
  const row = id => rows.find(r => r.dataset.id === id);
  const buttons = r => r.querySelectorAll('button').map(b => b.textContent);
  assert.strictEqual(row('7tfDEV').querySelector('.trace-flag-type').textContent, 'Dev Console');
  assert.strictEqual(row('7tfDEV').querySelector('.trace-flag-creator').textContent, 'by Sam Gillingham');
  assert.deepStrictEqual(buttons(row('7tfDEV')), ['Delete']);
  assert.strictEqual(row('7tfCLS').querySelector('.trace-flag-type').textContent, 'Class/Trigger');
  assert.deepStrictEqual(buttons(row('7tfCLS')), ['Extend +45min', 'Reduce -45min', 'Delete']);
});

test('M6: a trace flag refused for the log storage limit is explained in plain words', async () => {
  const error = 'Tooling create failed: 400 - [{"message":"Your org has exceeded its debug log storage limit","errorCode":"LIMIT_EXCEEDED"}]';
  const { env, ui } = setup({ respond: m => m.type === 'TOOLING_CREATE' ? { success: false, error } : null });
  env.document.getElementById('debugLevelSelect').value = FINEST_LEVEL.Id;
  await ui.handleEnableDebug();
  assert.match(notification(env), /more than 1,000 MB/);
});
