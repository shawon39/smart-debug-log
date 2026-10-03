// Track A: background/api-client.js
// L4 SOAP executeAnonymous, L12 401 refresh + retry, S3 ID checks, DELETE_APEX_LOGS /
// GET_LOG_STORAGE helpers, R5 log body cache cap, S2 one-time login link.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = (rel) => pathToFileURL(path.join(__dirname, '..', rel)).href;

const HOST = 'acme.my.salesforce.com';
const BASE = `https://${HOST}`;

function useStore(initialStore) {
  const store = structuredClone(initialStore);
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
    }
  };
  return store;
}

const token = (overrides = {}) => ({
  accessToken: 'AT1', instanceUrl: BASE, refreshToken: 'RT1', issuedAt: Date.now(),
  id: 'https://login.salesforce.com/id/00Dxx0000001gEREAY/005xx000001X8UzAAK', ...overrides
});
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const logId = (n) => '07L' + String(n).padStart(15, '0');

let api;
test.before(async () => { api = await import(moduleUrl('background/api-client.js')); });

test('L4 SOAP envelope escapes the code and the parser returns the REST shape', () => {
  const envelope = api.buildExecuteAnonymousEnvelope(`if (a < b && c > 'x') { System.debug("&"); }`, 'SESSION!ID');
  assert.match(envelope, /<apex:sessionId>SESSION!ID<\/apex:sessionId>/);
  assert.match(envelope, /<apex:String>if \(a &lt; b &amp;&amp; c &gt; &apos;x&apos;\) \{ System\.debug\(&quot;&amp;&quot;\); \}<\/apex:String>/);
  assert.match(envelope, /^<\?xml version="1\.0" encoding="UTF-8"\?><soapenv:Envelope /);

  const compileError = '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="http://soap.sforce.com/2006/08/apex" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body><executeAnonymousResponse><result><column>13</column><compileProblem>Unexpected token &apos;(&apos;. &lt;x&gt; &amp;amp;</compileProblem><compiled>false</compiled><exceptionMessage xsi:nil="true"/><exceptionStackTrace xsi:nil="true"/><line>2</line><success>false</success></result></executeAnonymousResponse></soapenv:Body></soapenv:Envelope>';
  assert.deepEqual(api.parseExecuteAnonymousResponse(compileError), {
    compiled: false, success: false, line: 2, column: 13,
    compileProblem: "Unexpected token '('. <x> &amp;", exceptionMessage: null, exceptionStackTrace: null
  });

  const runtimeError = '<soapenv:Envelope><soapenv:Body><executeAnonymousResponse><result><column>1</column><compileProblem xsi:nil="true"/><compiled>true</compiled><exceptionMessage>System.NullPointerException: Attempt to de-reference a null object</exceptionMessage><exceptionStackTrace>AnonymousBlock: line 1, column 1\nAnonymousBlock: line 3, column 1</exceptionStackTrace><line>1</line><success>false</success></result></executeAnonymousResponse></soapenv:Body></soapenv:Envelope>';
  const parsed = api.parseExecuteAnonymousResponse(runtimeError);
  assert.equal(parsed.compiled, true);
  assert.equal(parsed.exceptionMessage, 'System.NullPointerException: Attempt to de-reference a null object');
  assert.equal(parsed.exceptionStackTrace, 'AnonymousBlock: line 1, column 1\nAnonymousBlock: line 3, column 1');
});

test('L4 short code uses REST GET, long code uses the SOAP API (POST)', async () => {
  useStore({ [`sfOAuthToken_${HOST}`]: token() });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'GET') return json(200, { compiled: true, success: true, line: -1, column: -1, compileProblem: null, exceptionMessage: null, exceptionStackTrace: null });
    return new Response('<soapenv:Envelope><soapenv:Body><executeAnonymousResponse><result><column>-1</column><compileProblem xsi:nil="true"/><compiled>true</compiled><exceptionMessage xsi:nil="true"/><exceptionStackTrace xsi:nil="true"/><line>-1</line><success>true</success></result></executeAnonymousResponse></soapenv:Body></soapenv:Envelope>', { status: 200, headers: { 'content-type': 'text/xml' } });
  };

  const small = await api.directExecuteAnonymous("System.debug('hi');", HOST);
  assert.equal(calls[0].init.method, 'GET');
  assert.ok(calls[0].url.startsWith(`${BASE}/services/data/v62.0/tooling/executeAnonymous/?anonymousBody=`));
  assert.equal(small.success, true);

  const longCode = Array.from({ length: 400 }, (_, i) => `    System.debug('line ${i} <&>');`).join('\n');
  const big = await api.directExecuteAnonymous(longCode, HOST);
  const soap = calls[1];
  assert.equal(soap.url, `${BASE}/services/Soap/s/62.0`);
  assert.equal(soap.init.method, 'POST');
  assert.equal(soap.init.headers['Content-Type'], 'text/xml; charset=UTF-8');
  assert.equal(soap.init.headers.SOAPAction, '""');
  assert.match(soap.init.body, /<apex:sessionId>AT1<\/apex:sessionId>/);
  assert.match(soap.init.body, /line 399 &lt;&amp;&gt;/);
  assert.deepEqual(big, { compiled: true, success: true, line: -1, column: -1, compileProblem: null, exceptionMessage: null, exceptionStackTrace: null });
});

test('L12 a 401 refreshes the token once and retries the request once', async () => {
  const store = useStore({ [`sfOAuthToken_${HOST}`]: token() });
  const seen = [];
  globalThis.fetch = async (url, init) => {
    if (url.endsWith('/services/oauth2/token')) return json(200, { access_token: 'AT2', instance_url: BASE });
    seen.push(init.headers.Authorization);
    return init.headers.Authorization === 'Bearer AT2' ? json(200, { records: [{ Id: 'x' }] }) : json(401, [{ errorCode: 'INVALID_SESSION_ID' }]);
  };
  const result = await api.directToolingQuery('SELECT Id FROM ApexLog', HOST);
  assert.deepEqual(seen, ['Bearer AT1', 'Bearer AT2']);
  assert.equal(result.records.length, 1);
  assert.equal(store[`sfOAuthToken_${HOST}`].accessToken, 'AT2');

  // Still 401 after the refresh: no endless retries, the error reaches the caller
  let queries = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/services/oauth2/token')) return json(200, { access_token: 'AT3', instance_url: BASE });
    queries++;
    return json(401, [{ errorCode: 'INVALID_SESSION_ID' }]);
  };
  await assert.rejects(api.directToolingQuery('SELECT Id FROM ApexLog', HOST), /Tooling query failed: 401/);
  assert.equal(queries, 2);
});

test('S3 record IDs and object names are checked before they go into URL paths', async () => {
  useStore({ [`sfOAuthToken_${HOST}`]: token() });
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return json(200, {}); };
  await assert.rejects(api.directToolingDelete('TraceFlag', '../../sobjects/User/005', HOST), /Invalid Salesforce record ID/);
  await assert.rejects(api.directToolingUpdate('TraceFlag/../x', '7tfxx0000000001AAA', {}, HOST), /Invalid object type/);
  await assert.rejects(api.directGetLogBody('07Lxx?x=1', HOST), /Invalid Salesforce record ID/);
  await assert.rejects(api.directToolingCreate('Debug Level', {}, HOST), /Invalid object type/);
  assert.equal(fetched, 0);
  assert.equal(api.isValidSalesforceId('07Lxx0000000001'), true);
  assert.equal(api.isValidSalesforceId('07Lxx0000000001AAA'), true);
  assert.equal(api.isValidSalesforceId('07Lxx0000000001AA'), false);
});

test('DELETE_APEX_LOGS helper: composite delete in chunks of 200, falls back to Tooling DELETE', async () => {
  useStore({ [`sfOAuthToken_${HOST}`]: token() });
  const ids = Array.from({ length: 250 }, (_, i) => logId(i));
  const compositeChunks = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init.method, 'DELETE');
    const u = new URL(url);
    if (u.pathname.endsWith('/composite/sobjects')) {
      const chunk = u.searchParams.get('ids').split(',');
      compositeChunks.push(chunk.length);
      assert.equal(u.searchParams.get('allOrNone'), 'false');
      return json(200, chunk.map((id, i) => i === 0 ? { success: false, errors: [{ statusCode: 'INSUFFICIENT_ACCESS', message: 'no access' }] }
        : i === 1 ? { success: false, errors: [{ statusCode: 'ENTITY_IS_DELETED', message: 'entity is deleted' }] }
          : { id, success: true, errors: [] }));
    }
    throw new Error('unexpected ' + url);
  };
  const summary = await api.directDeleteApexLogs(ids, HOST);
  assert.deepEqual(compositeChunks, [200, 50]);
  assert.equal(summary.deleted, 248);
  assert.equal(summary.failed, 2);
  assert.deepEqual(summary.errors, ['no access']);
  assert.equal(summary.deletedIds.length, 248);
  assert.ok(summary.deletedIds.includes(logId(1)), 'already deleted counts as deleted');

  // Composite endpoint refuses ApexLog: one Tooling DELETE per record, at most 5 at a time
  let inFlight = 0, maxInFlight = 0;
  const toolingDeletes = [];
  globalThis.fetch = async (url) => {
    if (url.includes('/composite/sobjects')) return json(400, [{ errorCode: 'INVALID_TYPE', message: 'nope' }]);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, 2));
    inFlight--;
    toolingDeletes.push(url);
    return url.endsWith(logId(3)) ? json(404, [{ errorCode: 'NOT_FOUND', message: 'gone' }]) : new Response(null, { status: 204 });
  };
  const fallback = await api.directDeleteApexLogs(ids.slice(0, 12), HOST);
  assert.equal(toolingDeletes.length, 12);
  assert.ok(toolingDeletes[0].includes('/tooling/sobjects/ApexLog/'));
  assert.ok(maxInFlight <= 5);
  assert.equal(fallback.deleted, 11);
  assert.equal(fallback.failed, 1);
  assert.equal(fallback.errors.length, 1);
});

test('deleteApexLogsWhere keeps going past 200 and pages by Id so failures do not loop', async () => {
  useStore({ [`sfOAuthToken_${HOST}`]: token() });
  const all = Array.from({ length: 450 }, (_, i) => logId(i));
  const queries = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/tooling/query/')) {
      const q = u.searchParams.get('q');
      queries.push(q);
      const after = /Id > '(\w+)'/.exec(q);
      const rows = all.filter(id => !after || id > after[1]).slice(0, 200);
      return json(200, { records: rows.map(Id => ({ Id })) });
    }
    // every composite call fails for the first id of the chunk
    const chunk = u.searchParams.get('ids').split(',');
    return json(200, chunk.map((id, i) => i === 0 ? { success: false, errors: [{ message: 'locked' }] } : { id, success: true, errors: [] }));
  };
  const summary = await api.deleteApexLogsWhere("LogUserId = '005xx000001X8UzAAK'", HOST);
  assert.equal(queries.length, 3);
  assert.match(queries[0], /^SELECT Id FROM ApexLog WHERE LogUserId = '005xx000001X8UzAAK' ORDER BY Id LIMIT 200$/);
  assert.match(queries[1], new RegExp(`AND Id > '${logId(199)}' ORDER BY Id LIMIT 200$`));
  assert.equal(summary.deleted, 447);
  assert.equal(summary.failed, 3);
  assert.deepEqual(summary.errors, ['locked']);
});

test('GET_LOG_STORAGE helper sums log size (null sum counts as 0)', async () => {
  useStore({ [`sfOAuthToken_${HOST}`]: token() });
  let query;
  globalThis.fetch = async (url) => {
    query = new URL(url).searchParams.get('q');
    return json(200, { records: [{ totalBytes: null, logCount: 0 }] });
  };
  assert.deepEqual(await api.directGetLogStorage(HOST), { totalBytes: 0, logCount: 0, limitBytes: 1000 * 1024 * 1024 });
  assert.equal(query, 'SELECT SUM(LogLength) totalBytes, COUNT(Id) logCount FROM ApexLog');
  globalThis.fetch = async () => json(200, { records: [{ totalBytes: 52428800, logCount: 12 }] });
  assert.deepEqual(await api.directGetLogStorage(HOST), { totalBytes: 52428800, logCount: 12, limitBytes: 1048576000 });
});

test('R5 log body cache is capped by size and forgets deleted logs and revoked orgs', async () => {
  useStore({ [`sfOAuthToken_${HOST}`]: token() });
  const fetches = [];
  const sizes = { 1: 9 * 1024 * 1024, 2: 9 * 1024 * 1024, 3: 9 * 1024 * 1024, 4: 9 * 1024 * 1024, 5: 9 * 1024 * 1024, 6: 9 * 1024 * 1024, 7: 11 * 1024 * 1024 };
  globalThis.fetch = async (url) => {
    const n = Number(/ApexLog\/07L0*(\d+)\/Body/.exec(url)[1]);
    fetches.push(n);
    return new Response('x'.repeat(sizes[n]), { status: 200 });
  };
  for (const n of [1, 2, 3, 4, 5, 6]) await api.directGetLogBody(logId(n), HOST); // 54 MB > 50 MB cap
  fetches.length = 0;
  await api.directGetLogBody(logId(6), HOST);
  assert.deepEqual(fetches, [], 'newest body is cached');
  await api.directGetLogBody(logId(1), HOST);
  assert.deepEqual(fetches, [1], 'oldest body was evicted to stay under the cap');

  await api.directGetLogBody(logId(7), HOST);
  await api.directGetLogBody(logId(7), HOST);
  assert.deepEqual(fetches, [1, 7, 7], 'bodies over 10 MB are not cached');

  api.forgetCachedLogBodies(HOST, [logId(6)]);
  await api.directGetLogBody(logId(6), HOST);
  assert.deepEqual(fetches.slice(-1), [6], 'deleted log is fetched again');

  api.forgetCachedLogBodies(HOST);
  fetches.length = 0;
  await api.directGetLogBody(logId(5), HOST);
  assert.deepEqual(fetches, [5], 'revoke clears the whole org');
});

test('S2 one-time login link needs the web scope; uses /services/oauth2/singleaccess', async () => {
  useStore({ [`sfOAuthToken_${HOST}`]: token({ scope: 'api refresh_token' }) });
  globalThis.fetch = async () => { throw new Error('should not call Salesforce'); };
  assert.equal(await api.directGetSingleAccessUrl(HOST), null);

  useStore({ [`sfOAuthToken_${HOST}`]: token({ scope: 'web api refresh_token' }) });
  let call;
  globalThis.fetch = async (url, init) => { call = { url, init }; return json(200, { frontdoor_uri: `${BASE}/secur/frontdoor.jsp?otp=abc` }); };
  assert.equal(await api.directGetSingleAccessUrl(HOST), `${BASE}/secur/frontdoor.jsp?otp=abc`);
  assert.equal(call.url, `${BASE}/services/oauth2/singleaccess`);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer AT1');
  assert.equal(new URLSearchParams(call.init.body).get('redirect_uri'), '/');
});
