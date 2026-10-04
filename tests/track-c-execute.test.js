'use strict';
// F5 / L9: Execute Apex works with the OAuth token only, turns on debug logging first, and selects
// the run's log afterwards; snippets use the org of the OAuth token (else the browser session).
const test = require('node:test');
const assert = require('node:assert');
const { loadScripts, dashboardBody, flush } = require('./track-c-dom');

const NOW = Date.UTC(2026, 9, 3, 10, 0, 0);
const ME = '005Hn00000AbCdE';
const FILES = ['js/core/icons.js', 'js/core/basic-utilities.js', 'js/apex/apex-storage-service.js', 'js/apex/apex-code-manager.js', 'js/apex/apex-code-ui.js',
  'js/apex/apex-executor.js', 'js/debug-manager/debug-level-creator.js', 'js/debug-manager/debug-log-manager-ui.js', 'js/debug-manager/debug-log-ui-api.js',
  'js/debug-manager/debug-log-ui-traceflags.js', 'js/debug-manager/debug-log-ui-rendering.js', 'tests/track-c-log-list-stub.js', 'js/dashboard/dashboard-init.js'];
const iso = ms => new Date(ms).toISOString().replace('Z', '+0000');

function setup({ ensure = { success: true, data: { existing: true } }, run = { compiled: true, success: true, line: -1, column: -1 }, runLogDelayLoads = 0, filter = 'Monitoring', userInfo } = {}) {
  let env;
  env = loadScripts(FILES, {
    html: dashboardBody(),
    now: NOW,
    handler: async message => {
      const logs = env.get('__logState');
      if (message.type === 'ENSURE_TRACE_FLAG') return ensure;
      if (message.type === 'GET_USER_INFO') return userInfo || { success: true, data: { userId: ME, orgId: '00D5g000004XyZaEAQ' } };
      if (message.type === 'EXECUTE_ANONYMOUS') {
        if (run.success) {
          // The run's log shows up on a later reload
          logs.pending.push({ afterLoads: logs.loads + runLogDelayLoads, log: { Id: '07LRUN', LogUserId: ME, Operation: '/services/data/v62.0/tooling/executeAnonymous/', Location: 'Monitoring', StartTime: iso(env.clock.now + 1000) } });
        }
        return { success: true, data: run };
      }
      return { success: true, data: {} };
    }
  });
  env.document.getElementById('logTypeFilter').value = filter;
  env.ctx.debugLogManagerUI.userId = ME;
  const logs = env.get('__logState');
  // An older executeAnonymous log and another user's run must never be picked
  logs.serverLogs.push({ Id: '07LOLD', LogUserId: ME, Operation: '/services/data/v62.0/tooling/executeAnonymous/', Location: 'Monitoring', StartTime: iso(NOW - 60000) });
  logs.serverLogs.push({ Id: '07LOTHER', LogUserId: '005OTHER', Operation: '/services/data/v62.0/tooling/executeAnonymous/', Location: 'Monitoring', StartTime: iso(NOW + 5000) });
  return { env, logs };
}

// Runs handleRunApex to the end, firing the fake timers it waits on
async function runApex(env, code = 'System.debug(1);') {
  env.document.getElementById('apexCodeEditor').value = code;
  env.document.getElementById('apexManagerModal').style.display = 'flex';
  let done = false;
  const promise = env.get('handleRunApex')().then(() => { done = true; });
  for (let i = 0; i < 50 && !done; i++) {
    await flush(5);
    env.clock.now += 2000;
    env.runTimeouts();
  }
  await promise;
}

const toast = env => env.document.querySelector('.toast-notification')?.textContent;

test('F5: debug logging is turned on first, then the run log is selected and the modal closes', async () => {
  const { env, logs } = setup({ runLogDelayLoads: 1 });
  await runApex(env);

  const types = env.sent.map(m => m.type);
  assert.ok(types.indexOf('ENSURE_TRACE_FLAG') < types.indexOf('EXECUTE_ANONYMOUS'));
  assert.deepStrictEqual(env.sent.find(m => m.type === 'ENSURE_TRACE_FLAG'), { type: 'ENSURE_TRACE_FLAG', sfHost: 'acme.my.salesforce.com' });
  assert.strictEqual(env.document.getElementById('apexManagerModal').style.display, 'none');
  assert.strictEqual(logs.selected, '07LRUN');
  assert.ok(logs.loads >= 2, 'the list was reloaded until the log appeared');
});

test('F5: a log type filter that hides the run is switched to Monitoring', async () => {
  const { env, logs } = setup({ filter: 'SystemLog' });
  await runApex(env);
  assert.strictEqual(env.document.getElementById('logTypeFilter').value, 'Monitoring');
  assert.strictEqual(logs.selected, '07LRUN');
  assert.ok(logs.cleared >= 1);
});

test('F5: when no log appears, the user is told it can take a few seconds', async () => {
  const { env, logs } = setup({ runLogDelayLoads: 100 });
  await runApex(env);
  assert.strictEqual(logs.selected, null);
  assert.strictEqual(toast(env), 'Run finished. The log can take a few seconds to appear.');
});

test('F5: if debug logging cannot be turned on, the code still runs and a note is shown', async () => {
  const { env } = setup({ ensure: { success: false, error: 'Something went wrong' } });
  env.document.getElementById('apexCodeEditor').value = 'System.debug(1);';
  const promise = env.get('handleRunApex')();
  await flush();
  assert.match(toast(env), /Debug logging could not be turned on \(Something went wrong\)\. The code will still run/);
  for (let i = 0; i < 20; i++) { await flush(5); env.clock.now += 2000; env.runTimeouts(); }
  await promise;
  assert.ok(env.sent.some(m => m.type === 'EXECUTE_ANONYMOUS'));
});

test('F5: a failed run keeps the modal open and does not wait for a log', async () => {
  const { env, logs } = setup({ run: { compiled: false, success: false, line: 1, column: 5, compileProblem: 'Bad' } });
  await runApex(env);
  assert.strictEqual(env.document.getElementById('apexManagerModal').style.display, 'flex');
  assert.strictEqual(logs.selected, null);
});

test('L9: snippets use the org of the OAuth token, with the browser session as fallback', async () => {
  let { env } = setup();
  assert.strictEqual(await env.get('resolveApexOrgId')(), '00D5g000004XyZaEAQ');

  ({ env } = setup({ userInfo: { success: false, error: 'No OAuth token available' } }));
  env.get('currentSession = { orgId: "00D5g000004XyZa" }');
  assert.strictEqual(await env.get('resolveApexOrgId')(), '00D5g000004XyZa');

  ({ env } = setup({ userInfo: { success: false, error: 'No OAuth token available' } }));
  assert.strictEqual(await env.get('resolveApexOrgId')(), null, 'never "unknown"');
});
