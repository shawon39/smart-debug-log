// Track A: background/oauth-manager.js
// L10 login host, M1 OAuth errors + own consumer key, D2 no org guessing,
// D6 one refresh at a time, S5 revoke at Salesforce.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = (rel, tag) => pathToFileURL(path.join(__dirname, '..', rel)).href + (tag ? `?${tag}` : '');

function createChrome(initialStore = {}) {
  const store = structuredClone(initialStore);
  const local = {
    async get(keys) {
      if (keys == null) return structuredClone(store);
      const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      const out = {};
      for (const key of list) if (key in store) out[key] = structuredClone(store[key]);
      return out;
    },
    async set(values) { Object.assign(store, structuredClone(values)); },
    async remove(keys) { for (const key of [].concat(keys)) delete store[key]; }
  };
  return {
    store,
    chrome: {
      storage: { local },
      identity: {
        getRedirectURL: (p) => `https://extid.chromiumapp.org/${p}`,
        launchWebAuthFlow: async () => { throw new Error('launchWebAuthFlow not stubbed'); }
      }
    }
  };
}

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const HOST = 'acme.my.salesforce.com';
const freshToken = (overrides = {}) => ({
  accessToken: 'AT1', instanceUrl: `https://${HOST}`, refreshToken: 'RT1',
  issuedAt: Date.now(), tokenType: 'Bearer', id: 'https://login.salesforce.com/id/00Dxx0000001gEREAY/005xx000001X8UzAAK',
  ...overrides
});

test('L10 detectLoginBase maps every host shape to a real login host', async () => {
  globalThis.chrome = createChrome().chrome;
  const { detectLoginBase } = await import(moduleUrl('background/oauth-manager.js'));
  const cases = {
    'acme--dev.sandbox.lightning.force.com': 'https://acme--dev.sandbox.my.salesforce.com',
    'acme.develop.lightning.force.com': 'https://acme.develop.my.salesforce.com',
    'foo-1234.scratch.lightning.force.com': 'https://foo-1234.scratch.my.salesforce.com',
    'acme.lightning.force.com': 'https://acme.my.salesforce.com',
    'acme.my.salesforce.com': 'https://acme.my.salesforce.com',
    'acme--dev.sandbox.my.salesforce.com': 'https://acme--dev.sandbox.my.salesforce.com',
    'ACME.MY.SALESFORCE.COM': 'https://acme.my.salesforce.com',
    'https://acme.lightning.force.com/lightning/page/home': 'https://acme.my.salesforce.com',
    'acme.my.salesforce-setup.com': 'https://acme.my.salesforce.com',
    'acme--dev.sandbox.my.salesforce-setup.com': 'https://acme--dev.sandbox.my.salesforce.com',
    'acme.my.salesforce.mil': 'https://acme.my.salesforce.mil',
    'acme.my.sfcrmproducts.cn': 'https://acme.my.sfcrmproducts.cn',
    'acme.my.salesforce.com.mcas.ms': 'https://acme.my.salesforce.com',
    'test.salesforce.com': 'https://test.salesforce.com',
    'cs42.salesforce.com': 'https://test.salesforce.com',
    'na123.salesforce.com': 'https://login.salesforce.com',
    'acme--c.vf.force.com': 'https://login.salesforce.com',
    '': 'https://login.salesforce.com'
  };
  for (const [host, expected] of Object.entries(cases)) {
    assert.equal(detectLoginBase(host), expected, host);
  }
  assert.equal(detectLoginBase(null), 'https://login.salesforce.com');
});

test('M1 a Salesforce error in the redirect is shown (mapped) before the state check', async () => {
  const { chrome } = createChrome();
  let authUrl;
  chrome.identity.launchWebAuthFlow = async ({ url }) => {
    authUrl = new URL(url);
    // Error redirect without our state: must still report the real problem
    return 'https://extid.chromiumapp.org/salesforce?error=access_denied&error_description=OAUTH_APPROVAL_ERROR_GENERIC';
  };
  globalThis.chrome = chrome;
  const { performOAuthLogin } = await import(moduleUrl('background/oauth-manager.js'));
  await assert.rejects(performOAuthLogin(HOST), (error) => {
    assert.match(error.message, /Ask your Salesforce admin to install the app: Setup > Connected Apps OAuth Usage > find the app > Install, then set who can use it\./);
    assert.doesNotMatch(error.message, /State mismatch/);
    return true;
  });
  assert.equal(authUrl.searchParams.get('scope'), 'api refresh_token', 'requested scope is unchanged');
});

test('M1 token exchange errors and a closed login window get clear messages', async () => {
  const { chrome } = createChrome();
  globalThis.chrome = chrome;
  const { performOAuthLogin } = await import(moduleUrl('background/oauth-manager.js'));

  chrome.identity.launchWebAuthFlow = async () => { throw new Error('The user did not approve access.'); };
  await assert.rejects(performOAuthLogin(HOST), /The login window was closed before login finished\./);

  // Salesforce shows an error page (no redirect) for a callback URL it does not know
  chrome.identity.launchWebAuthFlow = async () => { throw new Error('Authorization page could not be loaded.'); };
  await assert.rejects(performOAuthLogin(HOST), /\(Authorization page could not be loaded\.\).*https:\/\/extid\.chromiumapp\.org\/salesforce/);

  // Same Chrome error while offline: say so instead of pointing at the callback URL
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try {
    await assert.rejects(performOAuthLogin(HOST), /^Error: You are offline\./);
  } finally {
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
    else delete globalThis.navigator;
  }

  chrome.identity.launchWebAuthFlow = async ({ url }) => {
    const state = new URL(url).searchParams.get('state');
    return `https://extid.chromiumapp.org/salesforce?code=abc&state=${state}`;
  };
  globalThis.fetch = async () => jsonResponse(400, { error: 'invalid_client', error_description: 'app must be installed into org' });
  await assert.rejects(performOAuthLogin(HOST), /Connected Apps OAuth Usage/);
});

test('M1 own consumer key is used for login and stored with the token; refresh uses the same key', async () => {
  const { chrome, store } = createChrome({ oauthClientId: '3MVG9CustomKey_1234567890.abc' });
  globalThis.chrome = chrome;
  const { performOAuthLogin, getStoredOAuthToken, getOAuthConfig } = await import(moduleUrl('background/oauth-manager.js'));

  const config = await getOAuthConfig();
  assert.deepEqual(config, { redirectUri: 'https://extid.chromiumapp.org/salesforce', clientId: '3MVG9CustomKey_1234567890.abc', usingCustomClientId: true });

  let authorizeClientId;
  chrome.identity.launchWebAuthFlow = async ({ url }) => {
    const u = new URL(url);
    authorizeClientId = u.searchParams.get('client_id');
    return `https://extid.chromiumapp.org/salesforce?code=abc&state=${u.searchParams.get('state')}`;
  };
  const tokenBodies = [];
  globalThis.fetch = async (url, init) => {
    tokenBodies.push(new URLSearchParams(init.body));
    return jsonResponse(200, { access_token: 'AT', instance_url: `https://${HOST}`, refresh_token: 'RT', issued_at: String(Date.now() - 3 * 3600 * 1000), token_type: 'Bearer', id: freshToken().id, scope: 'web api refresh_token' });
  };
  await performOAuthLogin(HOST);
  assert.equal(authorizeClientId, '3MVG9CustomKey_1234567890.abc');
  assert.equal(tokenBodies[0].get('client_id'), '3MVG9CustomKey_1234567890.abc');

  const saved = store[`sfOAuthToken_${HOST}`];
  assert.equal(saved.clientId, '3MVG9CustomKey_1234567890.abc');
  assert.equal(saved.scope, 'web api refresh_token');
  assert.equal(store.sfOAuthToken, undefined, 'no shared global copy is written any more');

  // The user switches back to the default app: the old token still refreshes with its own key
  delete store.oauthClientId;
  await getStoredOAuthToken(HOST); // issued 3 h ago, so it refreshes
  assert.equal(tokenBodies[1].get('grant_type'), 'refresh_token');
  assert.equal(tokenBodies[1].get('client_id'), '3MVG9CustomKey_1234567890.abc');
});

test('M1 SET_OAUTH_CLIENT_ID validation: rejects junk, empty value clears', async () => {
  const { chrome, store } = createChrome();
  globalThis.chrome = chrome;
  const { setOAuthClientId } = await import(moduleUrl('background/oauth-manager.js'));
  await assert.rejects(setOAuthClientId('not a key!'), /consumer key/);
  const saved = await setOAuthClientId('  3MVG9CustomKey_1234567890  ');
  assert.equal(store.oauthClientId, '3MVG9CustomKey_1234567890');
  assert.equal(saved.usingCustomClientId, true);
  const cleared = await setOAuthClientId('');
  assert.equal('oauthClientId' in store, false);
  assert.equal(cleared.usingCustomClientId, false);
});

test('D2 no org means no token (no "last used org" fallback); a legacy shared copy moves to its org key once', async () => {
  const legacy = freshToken();
  const { chrome, store } = createChrome({ sfOAuthToken: legacy });
  globalThis.chrome = chrome;
  // Fresh module instance so the one-time migration runs against this store
  const { getStoredOAuthToken } = await import(moduleUrl('background/oauth-manager.js', 'migration'));
  assert.equal(await getStoredOAuthToken(null), null);
  assert.equal(await getStoredOAuthToken(undefined), null);
  const token = await getStoredOAuthToken(HOST);
  assert.equal(token.accessToken, 'AT1');
  assert.deepEqual(store[`sfOAuthToken_${HOST}`], legacy);
  assert.equal(store.sfOAuthToken, undefined);
  assert.equal(await getStoredOAuthToken('other.my.salesforce.com'), null);
});

test('D6 parallel callers share one refresh, and only invalid_grant deletes the token', async () => {
  const { chrome, store } = createChrome({ [`sfOAuthToken_${HOST}`]: freshToken({ issuedAt: Date.now() - 3 * 3600 * 1000 }) });
  globalThis.chrome = chrome;
  const { getStoredOAuthToken } = await import(moduleUrl('background/oauth-manager.js', 'refresh'));

  let refreshCalls = 0;
  globalThis.fetch = async () => {
    refreshCalls++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return jsonResponse(200, { access_token: 'AT2', instance_url: `https://${HOST}` });
  };
  const tokens = await Promise.all([1, 2, 3, 4, 5].map(() => getStoredOAuthToken(HOST)));
  assert.equal(refreshCalls, 1, 'one refresh for five parallel calls');
  assert.ok(tokens.every(t => t.accessToken === 'AT2'));

  // 503 while refreshing: keep the stored token (expiry is only a guess)
  store[`sfOAuthToken_${HOST}`] = freshToken({ issuedAt: Date.now() - 3 * 3600 * 1000 });
  globalThis.fetch = async () => jsonResponse(503, { error: 'unavailable' });
  const kept = await getStoredOAuthToken(HOST);
  assert.equal(kept.accessToken, 'AT1');
  assert.ok(store[`sfOAuthToken_${HOST}`], 'token kept after a 503');

  // 400 invalid_grant: the refresh token is dead, remove it
  globalThis.fetch = async () => jsonResponse(400, { error: 'invalid_grant', error_description: 'expired access/refresh token' });
  assert.equal(await getStoredOAuthToken(HOST), null);
  assert.equal(store[`sfOAuthToken_${HOST}`], undefined);
});

test('S5 revoke posts the refresh token to Salesforce, then removes only this org', async () => {
  const other = freshToken({ instanceUrl: 'https://other.my.salesforce.com', refreshToken: 'RT-other' });
  const { chrome, store } = createChrome({ [`sfOAuthToken_${HOST}`]: freshToken(), 'sfOAuthToken_other.my.salesforce.com': other });
  globalThis.chrome = chrome;
  const { revokeOAuthToken } = await import(moduleUrl('background/oauth-manager.js', 'revoke'));

  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, body: String(init.body) }); return new Response('', { status: 200 }); };
  const result = await revokeOAuthToken(HOST);
  assert.deepEqual(calls, [{ url: `https://${HOST}/services/oauth2/revoke`, body: 'token=RT1' }]);
  assert.equal(result.warning, null);
  assert.equal(store[`sfOAuthToken_${HOST}`], undefined);
  assert.deepEqual(store['sfOAuthToken_other.my.salesforce.com'], other);

  // Salesforce unreachable: still removed locally, with a warning
  store[`sfOAuthToken_${HOST}`] = freshToken();
  globalThis.fetch = async () => { throw new Error('Failed to fetch'); };
  const failed = await revokeOAuthToken(HOST);
  assert.match(failed.warning, /removed from this browser/);
  assert.equal(store[`sfOAuthToken_${HOST}`], undefined);
});
