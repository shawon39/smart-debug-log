// Minimal chrome.* API stand-in so dashboard.html and popup.html run in a normal browser tab
// against the fictional org in mock-org.js. Used only to capture store screenshots.
(function () {
  const ORG = window.MOCK_ORG;
  const store = {};
  const listeners = { message: [], storage: [] };
  const delay = (value, ms = 60) => new Promise(resolve => setTimeout(() => resolve(value), ms));
  const query = (records) => ({ totalSize: records.length, done: true, records });

  // ?theme=dark starts the page in dark mode (key from js/core/basic-utilities.js)
  store['smart-debug-log-theme'] = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';

  // Saved snippets live in storage like the real extension keeps them
  store[`apexCodes_${ORG.ORG_ID.substring(0, 15)}`] = ORG.apexSnippets.map(s => ({
    id: s.id, name: s.name, code: s.code, orgId: ORG.ORG_ID.substring(0, 15), timestamp: s.updatedAt
  }));

  function toolingQuery(soql) {
    const q = soql.replace(/\s+/g, ' ');
    if (/SUM\(LogLength\)/i.test(q)) return query([{ totalBytes: 48 * 1024 * 1024, logCount: 214 }]);
    if (/FROM ApexLog/i.test(q)) {
      const limit = Number((q.match(/LIMIT (\d+)/i) || [])[1]) || 100;
      return query(ORG.logs.slice(0, limit));
    }
    if (/FROM TraceFlag/i.test(q)) {
      const only = (q.match(/TracedEntityId = '(\w+)'/) || [])[1];
      return query(ORG.traceFlags.filter(tf => !only || tf.TracedEntityId === only));
    }
    if (/FROM DebugLevel/i.test(q)) return query(ORG.debugLevels);
    if (/FROM ApexClass/i.test(q)) return query([{ Id: '01p8a00000DpM0Z', Body: 'public class Console {}' }]);
    if (/FROM User/i.test(q)) return query(ORG.users);
    return query([]);
  }

  async function handle(msg) {
    switch (msg.type) {
      case 'GET_SALESFORCE_HOST':
        return { success: true, data: { salesforceHost: ORG.HOST, sessionFound: true, sessionInfo: { orgId: ORG.ORG_ID.substring(0, 15), hostname: ORG.HOST } } };
      case 'GET_SESSION':
        return { success: true, data: { hostname: ORG.HOST, orgId: ORG.ORG_ID.substring(0, 15), domain: ORG.HOST, isValid: true } };
      case 'GET_USER_INFO':
        return { success: true, data: { userId: ORG.USER_ID, orgId: ORG.ORG_ID, instanceUrl: `https://${ORG.HOST}` } };
      case 'CHECK_TOKEN_STATUS':
        return { success: true, data: { hasToken: true, isExpired: false, instanceUrl: `https://${ORG.HOST}` } };
      case 'GET_TRACE_FLAG_STATUS': {
        const tf = ORG.traceFlags[0];
        return { success: true, data: { active: true, startTime: tf.StartDate, expirationDate: tf.ExpirationDate, logType: 'USER_DEBUG', debugLevel: 'SFDC_DevConsole' } };
      }
      case 'ENSURE_TRACE_FLAG':
        return { success: true, data: { existing: true, traceFlagId: ORG.traceFlags[0].Id } };
      case 'EXECUTE_TOOLING_QUERY':
        return { success: true, data: toolingQuery(msg.query) };
      case 'GET_LOG_CONTENT':
        return { success: true, data: { content: ORG.bodies[msg.logId] || '', logId: msg.logId } };
      case 'SEARCH_USERS': {
        const term = String(msg.searchTerm || '').toLowerCase();
        return { success: true, data: ORG.users.filter(u => (u.Name + u.Username).toLowerCase().includes(term)) };
      }
      case 'GET_APEX_CODES':
        return { success: true, data: store[`apexCodes_${ORG.ORG_ID.substring(0, 15)}`] };
      case 'EXECUTE_ANONYMOUS':
        return { success: true, data: ORG.executeResult };
      case 'GET_LOG_STORAGE':
        return { success: true, data: { totalBytes: 48 * 1024 * 1024, logCount: 214, limitBytes: 1000 * 1024 * 1024 } };
      case 'GET_OAUTH_CONFIG':
        return { success: true, data: { redirectUri: 'https://nhjppmlfmlhfmgfhoopllbhapfjajpnj.chromiumapp.org/salesforce', clientId: 'default', usingCustomClientId: false } };
      case 'TOOLING_DESCRIBE':
        return { success: true, data: { fields: [] } };
      default:
        console.info('[mock] unhandled message', msg.type);
        return { success: true, data: {} };
    }
  }

  function storageGet(keys) {
    if (keys == null) return { ...store };
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const out = {};
    for (const key of list) {
      if (key in store) out[key] = store[key];
      else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[key] = keys[key];
    }
    return out;
  }

  const withCallback = (promise, callback) => {
    if (typeof callback === 'function') { promise.then(callback); return undefined; }
    return promise;
  };

  const event = list => ({ addListener: fn => list.push(fn), removeListener: () => { }, hasListener: () => false });

  window.chrome = {
    runtime: {
      id: 'nhjppmlfmlhfmgfhoopllbhapfjajpnj',
      lastError: undefined,
      getURL: path => `${location.origin}/${String(path || '').replace(/^\//, '')}`,
      getManifest: () => ({ version: '2.6.0', name: 'Salesforce Debug Log Beautifier' }),
      sendMessage: (msg, callback) => withCallback(delay(null, 40).then(() => handle(msg)), callback),
      onMessage: event(listeners.message),
      getContexts: async () => []
    },
    storage: {
      local: {
        get: (keys, callback) => withCallback(Promise.resolve(storageGet(keys)), callback),
        set: (items, callback) => { Object.assign(store, items); return withCallback(Promise.resolve(), callback); },
        remove: (keys, callback) => { [].concat(keys).forEach(k => delete store[k]); return withCallback(Promise.resolve(), callback); },
        setAccessLevel: async () => { }
      },
      onChanged: event(listeners.storage)
    },
    tabs: {
      query: async () => [{ id: 7, windowId: 1, url: `https://${ORG.HOST}/lightning/setup/ApexDebugLogs/home`, active: false, lastAccessed: Date.now() }],
      sendMessage: async () => { throw new Error('No content script in the mock'); },
      create: async () => ({}),
      update: async () => ({})
    },
    windows: { create: async () => ({}), update: async () => ({}) },
    scripting: { executeScript: async () => [] },
    identity: { getRedirectURL: path => `https://nhjppmlfmlhfmgfhoopllbhapfjajpnj.chromiumapp.org/${path || ''}` }
  };
})();
