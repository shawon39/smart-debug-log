// Track A: content scripts (S6 no cross-session fallback, C3 only PING + TOOLING_QUERY,
// S9 exact hostname match). Loaded into a vm sandbox like the browser would inject them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function inject(hostname, fetchImpl) {
  const listeners = [];
  const window = { location: { hostname, pathname: '/' } };
  const context = vm.createContext({
    window,
    console,
    fetch: fetchImpl,
    // document.cookie holds a different session (another org); it must never be used
    document: { cookie: 'sid=00DOTHER0000000!other-org-session' },
    chrome: { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) } } }
  });
  for (const file of ['content/api-handler.js', 'content/api-operations.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  // JSON round trip: objects made inside the sandbox have other prototypes
  const send = (message) => new Promise((resolve) => {
    const handled = listeners[0](message, {}, (response) => resolve(JSON.parse(JSON.stringify(response))));
    if (handled !== true) resolve('not handled');
  });
  return { listeners, send };
}

test('S6 a failed query returns the original error; the page session is never tried', async () => {
  const calls = [];
  const { send } = inject('acme.lightning.force.com', async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    return new Response('[{"message":"Session expired or invalid","errorCode":"INVALID_SESSION_ID"}]', { status: 401, statusText: 'Unauthorized' });
  });
  const response = await send({ action: 'TOOLING_QUERY', query: 'SELECT Id FROM ApexLog', session: { sessionId: '00DORGA0000000!org-a', instanceUrl: 'https://orga.my.salesforce.com' } });
  assert.equal(response.success, false);
  assert.match(response.error, /Tooling API query failed: 401 Unauthorized - .*INVALID_SESSION_ID/);
  assert.doesNotMatch(response.error, /Session extraction failed/);
  assert.deepEqual(calls, [{ url: 'https://orga.my.salesforce.com/services/data/v62.0/tooling/query/?q=SELECT%20Id%20FROM%20ApexLog', auth: 'Bearer 00DORGA0000000!org-a' }]);
});

test('C3 only PING and TOOLING_QUERY are handled', async () => {
  const { send } = inject('acme.my.salesforce.com', async () => new Response('{"records":[{"Id":"07Lxx0000000001AAA"}]}', { status: 200 }));
  assert.deepEqual(await send({ action: 'PING' }), { success: true, message: 'Content script is active' });
  const ok = await send({ action: 'TOOLING_QUERY', query: 'SELECT Id FROM ApexLog', session: { sessionId: 's', instanceUrl: 'https://acme.my.salesforce.com' } });
  assert.deepEqual(ok, { success: true, data: { records: [{ Id: '07Lxx0000000001AAA' }] } });
  for (const action of ['TOOLING_CREATE', 'GET_LOG_BODY', 'EXECUTE_ANONYMOUS']) {
    assert.equal(await send({ action }), 'not handled', action);
  }
});

test('S9 the handler starts only on real Salesforce hosts', () => {
  assert.equal(inject('acme.my.salesforce.com', fetch).listeners.length, 1);
  assert.equal(inject('acme--c.vf.force.com', fetch).listeners.length, 1);
  assert.equal(inject('myforce.com', fetch).listeners.length, 0);
  assert.equal(inject('salesforce.com.evil.example', fetch).listeners.length, 0);
});
