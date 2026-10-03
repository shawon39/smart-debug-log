import sessionManager from './session-manager.js';
import {
  extractOrgDomain,
  getStoredOAuthToken,
  performOAuthLogin,
  isTokenExpired,
  revokeOAuthToken,
  getOAuthConfig,
  setOAuthClientId
} from './oauth-manager.js';
import {
  directToolingQuery,
  directToolingCreate,
  directToolingUpdate,
  directToolingDelete,
  directToolingDescribe,
  directGetLogBody,
  directExecuteAnonymous,
  directQuery,
  directDeleteApexLogs,
  deleteApexLogsWhere,
  directGetLogStorage,
  directGetSingleAccessUrl,
  forgetCachedLogBodies,
  isValidSalesforceId
} from './api-client.js';
import {
  ensureTraceFlag,
  getTraceFlagStatus,
  getLocalTraceFlagStatus,
  updateAutoTraceFlagWindow,
  forgetAutoTraceFlag,
  cleanupExpiredTraceFlagLogs,
  reconcileAutoTraceFlags
} from './traceflag-manager.js';
import {
  saveApexCodeToStorage,
  getApexCodesFromStorage,
  updateApexCodeInStorage,
  deleteApexCodeFromStorage
} from './apex-storage.js';

// OAuth tokens live in chrome.storage.local: allow only extension pages and this worker to read
// it. Content scripts then get "Access to storage is not allowed from this context".
try {
  if (typeof chrome.storage.local.setAccessLevel === 'function') {
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => { });
  }
} catch (error) {
  // Older Chrome: content scripts keep the default access
}

const NO_ORG_ERROR = 'No Salesforce org selected. Reopen the dashboard from a Salesforce tab.';

// Messages that change data in an org (or the org's token) must name the org explicitly
const ORG_REQUIRED_TYPES = new Set([
  'TOOLING_CREATE',
  'TOOLING_UPDATE',
  'TOOLING_DELETE',
  'EXECUTE_ANONYMOUS',
  'ENSURE_TRACE_FLAG',
  'DELETE_APEX_LOGS',
  'DELETE_LOGS_BY_IDS',
  'REVOKE_OAUTH_TOKEN',
  'GET_SINGLE_ACCESS_URL'
]);

// Short cache for the popup's trace flag status (per org)
const TRACE_STATUS_TTL_MS = 30 * 1000;
const traceStatusCache = new Map();

function forgetTraceStatus(sfHost) {
  traceStatusCache.delete(extractOrgDomain(sfHost));
}

function broadcastLogsDeleted(logIds, sfHost) {
  try {
    chrome.runtime.sendMessage({ type: 'LOGS_DELETED', logIds, orgDomain: extractOrgDomain(sfHost) }).catch(() => { });
  } catch (e) { }
}

// Simple error check for harmless extension warnings
function checkLastError() {
  if (chrome.runtime.lastError) {
    console.debug('Extension runtime message:', chrome.runtime.lastError.message);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  try {
    sessionManager.initialize();
    checkLastError();
  } catch (error) {
    console.warn('Extension initialization warning:', error.message);
  }
  reconcileAutoTraceFlags().catch(error => console.warn('Trace flag alarm check failed:', error.message));
});

chrome.runtime.onStartup.addListener(() => {
  try {
    sessionManager.initialize();
    checkLastError();
  } catch (error) {
    console.warn('Extension startup warning:', error.message);
  }
  reconcileAutoTraceFlags().catch(error => console.warn('Trace flag alarm check failed:', error.message));
});

// Alarm listener for auto trace flag cleanup
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('cleanup_traceflag_')) {
    const traceFlagId = alarm.name.replace('cleanup_traceflag_', '');
    cleanupExpiredTraceFlagLogs(traceFlagId);
  }
});

// Open dashboard tabs. Without the "tabs" permission Chrome hides the URL of our own pages in
// tabs.query, so read them from runtime.getContexts (Chrome 116+).
async function getOpenDashboards() {
  if (!chrome.runtime.getContexts) return [];
  const baseUrl = chrome.runtime.getURL('dashboard.html');
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  return contexts
    .filter(context => context.documentUrl && context.documentUrl.startsWith(baseUrl))
    .map(context => ({ tabId: context.tabId, windowId: context.windowId, url: context.documentUrl }));
}

// Keyboard shortcut command listener (Alt+Shift+D / Option+Shift+D)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-debug-dashboard') {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let sfHost = null;

      if (tab && tab.url) {
        sfHost = await sessionManager.getSalesforceHost(tab.url, tab.id);
      }

      // Auto-enable debug logging, but only for the org of this Salesforce tab
      if (sfHost) {
        try {
          const result = await ensureTraceFlag(sfHost);
          if (!result.success) console.warn('Could not auto-enable debug:', result.error);
          forgetTraceStatus(sfHost);
        } catch (e) {
          console.warn('Could not auto-enable debug:', e);
        }
      }

      const baseUrl = chrome.runtime.getURL('dashboard.html');
      const dashboardUrl = sfHost ? `${baseUrl}?host=${encodeURIComponent(sfHost)}` : baseUrl;
      const existingDashboard = (await getOpenDashboards()).find(dashboard => {
        if (sfHost) {
          const targetUrl = `${baseUrl}?host=${encodeURIComponent(sfHost)}`;
          return dashboard.url === targetUrl || dashboard.url.startsWith(targetUrl + '&');
        }
        return dashboard.url === baseUrl || !dashboard.url.includes('?host=');
      });

      if (existingDashboard) {
        await chrome.tabs.update(existingDashboard.tabId, { active: true });
        await chrome.windows.update(existingDashboard.windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: dashboardUrl, active: true });
      }
    } catch (error) {
      console.error('Failed to open dashboard via shortcut:', error);
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessageWrapper(request, sender, sendResponse);
  return true;
});

async function handleMessageWrapper(request, sender, sendResponse) {
  try {
    // Only this extension's own pages (dashboard, popup) may call the worker. Content scripts
    // share the extension id, so the sender URL must also be an extension page. There is no
    // externally_connectable, so external pages cannot reach this listener at all.
    const extensionOrigin = chrome.runtime.getURL('');
    if (sender.id !== chrome.runtime.id || !sender.url || !sender.url.startsWith(extensionOrigin)) {
      sendResponse({ success: false, error: 'Unauthorized sender' });
      return;
    }
    const result = await handleMessage(request, sender);
    sendResponse(result);
  } catch (error) {
    console.error('[Background] Message handler error:', error);
    sendResponse({ success: false, error: error.message || 'Unknown error occurred' });
  }
}

async function handleMessage(request, sender) {
  if (ORG_REQUIRED_TYPES.has(request.type) && !request.sfHost) {
    return { success: false, error: NO_ORG_ERROR };
  }

  switch (request.type) {
    case 'GET_SALESFORCE_HOST': return await handleGetSalesforceHost(request, sender);
    case 'GET_SESSION': return await handleGetSession(request, sender);
    case 'GET_LOG_CONTENT': return await handleGetLogContent(request, sender);
    case 'EXECUTE_TOOLING_QUERY': return await handleExecuteToolingQuery(request, sender);
    case 'TOOLING_CREATE': return await handleToolingCreate(request, sender);
    case 'TOOLING_UPDATE': return await handleToolingUpdate(request, sender);
    case 'TOOLING_DELETE': return await handleToolingDelete(request, sender);
    case 'TOOLING_DESCRIBE': return await handleToolingDescribe(request, sender);
    case 'SAVE_APEX_CODE': return await handleSaveApexCode(request, sender);
    case 'UPDATE_APEX_CODE': return await handleUpdateApexCode(request, sender);
    case 'GET_APEX_CODES': return await handleGetApexCodes(request, sender);
    case 'DELETE_APEX_CODE': return await handleDeleteApexCode(request, sender);
    case 'EXECUTE_ANONYMOUS': return await handleExecuteAnonymous(request, sender);
    case 'SF_GENERATE_TOKEN': return await handleGenerateToken(request, sender);
    case 'GET_USER_INFO': return await handleGetUserInfo(request, sender);
    case 'CHECK_TOKEN_STATUS': return await handleCheckTokenStatus(request, sender);
    case 'ENSURE_TRACE_FLAG': return await handleEnsureTraceFlag(request, sender);
    case 'GET_TRACE_FLAG_STATUS': return await handleGetTraceFlagStatus(request, sender);
    case 'REVOKE_OAUTH_TOKEN': return await handleRevokeOAuthToken(request, sender);
    case 'SEARCH_USERS': return await handleSearchUsers(request, sender);
    case 'DELETE_LOGS_BY_IDS': return await handleDeleteLogsByIds(request, sender);
    case 'DELETE_APEX_LOGS': return await handleDeleteApexLogs(request, sender);
    case 'GET_LOG_STORAGE': return await handleGetLogStorage(request, sender);
    case 'GET_SINGLE_ACCESS_URL': return await handleGetSingleAccessUrl(request, sender);
    case 'GET_OAUTH_CONFIG': return await handleGetOAuthConfig(request, sender);
    case 'SET_OAUTH_CLIENT_ID': return await handleSetOAuthClientId(request, sender);
    default: return { success: false, message: `Unknown message type: ${request.type}` };
  }
}

// Handler functions
async function handleGetSalesforceHost(request, sender) {
  const url = request.url || sender.tab?.url;
  const tabId = request.tabId || sender.tab?.id;
  if (!url) return { success: false, message: 'No URL provided' };

  let sfHost = null;
  let extractedFromExtension = false;

  if (url.startsWith('chrome-extension://')) {
    try {
      const urlObj = new URL(url);
      const hostParam = urlObj.searchParams.get('host');
      if (hostParam) { sfHost = hostParam; extractedFromExtension = true; }
    } catch (e) { }
  }

  if (!sfHost) sfHost = await sessionManager.getSalesforceHost(url, tabId);
  if (!sfHost) return { success: false, message: 'Not a Salesforce URL' };

  let sessionInfo = null;
  let sessionFound = false;
  try {
    const session = await sessionManager.getSession(sfHost, tabId);
    if (session) {
      sessionFound = true;
      sessionInfo = {
        orgId: session.orgId, hostname: session.hostname, domain: session.domain,
        displayDomain: session.displayDomain, apiDomain: session.apiDomain,
        isValid: session.isValid, hasKey: !!session.key
      };
    }
  } catch (e) { }

  return { success: true, data: { salesforceHost: sfHost, sessionFound, sessionInfo, extractedFromExtension } };
}

async function handleGetSession(request, sender) {
  const sfHost = request.sfHost;
  const tabId = request.tabId || sender.tab?.id;
  const skipValidation = request.skipValidation || false;
  if (!sfHost) return { success: false, message: 'Salesforce host is required' };

  const session = await sessionManager.getSession(sfHost, tabId, skipValidation);
  if (!session) {
    const relatedDomains = sessionManager.getRelatedDomains(sfHost);
    for (const domain of relatedDomains) {
      try {
        const relatedSession = await sessionManager.getSessionFromDomain(domain, tabId);
        if (relatedSession) return { success: true, data: relatedSession };
      } catch (e) { }
    }
    return { success: false, message: 'No session found' };
  }
  return { success: true, data: session };
}

async function handleGetLogContent(request, sender) {
  const { logId, sfHost } = request;
  const result = await directGetLogBody(logId, sfHost);
  return { success: true, data: result };
}

async function handleExecuteToolingQuery(request, sender) {
  const { query, sfHost } = request;
  const result = await directToolingQuery(query, sfHost);
  return { success: true, data: result };
}

async function handleToolingCreate(request, sender) {
  const { sobjectType, data, sfHost } = request;
  const result = await directToolingCreate(sobjectType, data, sfHost);
  if (sobjectType === 'TraceFlag') forgetTraceStatus(sfHost);
  return { success: true, data: result };
}

async function handleToolingUpdate(request, sender) {
  const { sobjectType, recordId, data, sfHost } = request;
  const result = await directToolingUpdate(sobjectType, recordId, data, sfHost);

  if (sobjectType === 'TraceFlag') {
    forgetTraceStatus(sfHost);
    // Keep our alarm in step with the new end time; never deletes logs
    if (data.ExpirationDate) await updateAutoTraceFlagWindow(recordId, data.ExpirationDate);
  }
  return { success: true, data: result };
}

async function handleToolingDelete(request, sender) {
  const { sobjectType, recordId, sfHost } = request;
  const result = await directToolingDelete(sobjectType, recordId, sfHost);
  if (sobjectType === 'TraceFlag') {
    forgetTraceStatus(sfHost);
    // Stop tracking the deleted flag; its logs stay
    await forgetAutoTraceFlag(recordId);
  }
  return { success: true, data: result };
}

async function handleToolingDescribe(request, sender) {
  const { sobjectType, sfHost } = request;
  const result = await directToolingDescribe(sobjectType, sfHost);
  return { success: true, data: result };
}

async function handleSaveApexCode(request) {
  const record = await saveApexCodeToStorage({ ...request, timestamp: Date.now() });
  return { success: true, message: 'Apex code saved successfully', data: record };
}

async function handleGetApexCodes(request) {
  const codes = await getApexCodesFromStorage(request.orgId);
  return { success: true, data: codes };
}

async function handleUpdateApexCode(request) {
  const updated = await updateApexCodeInStorage({ ...request, timestamp: Date.now() }, request.orgId);
  return { success: true, message: 'Apex code updated successfully', data: updated };
}

async function handleDeleteApexCode(request) {
  await deleteApexCodeFromStorage(request.id, request.orgId);
  return { success: true, message: 'Apex code deleted successfully' };
}

async function handleExecuteAnonymous(request) {
  const result = await directExecuteAnonymous(request.code, request.sfHost);
  return { success: true, data: result };
}

async function handleGenerateToken(request) {
  const tokens = await performOAuthLogin(request.orgUrl);
  return { success: true, data: { instanceUrl: tokens.instanceUrl, issuedAt: tokens.issuedAt } };
}

async function handleGetUserInfo(request) {
  const token = await getStoredOAuthToken(request.sfHost);
  if (!token) return { success: false, error: 'No OAuth token available' };
  let userId = null, orgId = null;
  if (token.id) {
    const parts = token.id.split('/');
    if (parts.length >= 2) { userId = parts[parts.length - 1]; orgId = parts[parts.length - 2]; }
  }
  return { success: true, data: { userId, orgId, instanceUrl: token.instanceUrl } };
}

async function handleCheckTokenStatus(request) {
  const token = await getStoredOAuthToken(request.sfHost);
  if (!token) return { success: true, data: { hasToken: false, message: 'No access token for this org' } };
  return { success: true, data: { hasToken: true, isExpired: isTokenExpired(token), instanceUrl: token.instanceUrl } };
}

async function handleEnsureTraceFlag(request) {
  const { sfHost, force } = request;
  const durationMinutes = Number(request.durationMinutes) > 0 ? Number(request.durationMinutes) : 45;
  const result = await ensureTraceFlag(sfHost, { force: !!force, durationMinutes });
  forgetTraceStatus(sfHost);
  return result;
}

// Logging status for the popup: the user's real trace flags (any LogType, active or scheduled),
// cached for 30 seconds. Falls back to the flags this extension created when Salesforce
// cannot be asked.
async function handleGetTraceFlagStatus(request) {
  try {
    const { sfHost } = request;
    if (!sfHost) return { success: true, data: { active: false } };

    const orgDomain = extractOrgDomain(sfHost);
    const cached = traceStatusCache.get(orgDomain);
    if (cached && Date.now() - cached.at < TRACE_STATUS_TTL_MS) {
      return { success: true, data: cached.data };
    }

    try {
      const data = await getTraceFlagStatus(sfHost);
      traceStatusCache.set(orgDomain, { at: Date.now(), data });
      return { success: true, data };
    } catch (error) {
      return { success: true, data: await getLocalTraceFlagStatus(sfHost) };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function handleSearchUsers(request) {
  // Escape backslash first, then the single quote and the LIKE wildcards % and _, so the
  // search term cannot break out of the SOQL string literal or match everything.
  const escapedTerm = String(request.searchTerm || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  const query = `SELECT Id, Name, Username, Email FROM User WHERE (Name LIKE '%${escapedTerm}%' OR Username LIKE '%${escapedTerm}%') AND IsActive = true ORDER BY Name LIMIT 10`;
  const result = await directQuery(query, request.sfHost);
  return { success: true, data: result.records || [] };
}

async function handleRevokeOAuthToken(request) {
  // Revokes the token at Salesforce too, then removes this org's local copy
  const { warning } = await revokeOAuthToken(request.sfHost);
  forgetCachedLogBodies(request.sfHost);
  forgetTraceStatus(request.sfHost);
  const response = { success: true, message: 'Access token revoked successfully' };
  if (warning) response.warning = warning;
  return response;
}

// Deletes nothing in Salesforce: it only tells open pages to drop these logs from their
// caches. Real deletes go through DELETE_APEX_LOGS.
async function handleDeleteLogsByIds(request) {
  const { logIds, sfHost } = request;
  if (!logIds?.length) return { success: true, message: 'No log IDs to delete' };
  forgetCachedLogBodies(sfHost, logIds);
  broadcastLogsDeleted(logIds, sfHost);
  return { success: true, message: `Removed ${logIds.length} log(s) from cache` };
}

// Deletes ApexLogs in Salesforce: the given IDs, or every log of one user. Never all logs.
async function handleDeleteApexLogs(request) {
  const { sfHost, logIds, userId } = request;
  let summary;

  if (Array.isArray(logIds) && logIds.length > 0) {
    if (!logIds.every(isValidSalesforceId)) return { success: false, error: 'Invalid log ID' };
    summary = await directDeleteApexLogs(logIds, sfHost);
  } else if (userId) {
    if (!isValidSalesforceId(userId)) return { success: false, error: 'Invalid user ID' };
    summary = await deleteApexLogsWhere(`LogUserId = '${userId}'`, sfHost);
  } else {
    return { success: false, error: 'Choose the logs or the user whose logs to delete.' };
  }

  if (summary.deletedIds.length > 0) broadcastLogsDeleted(summary.deletedIds, sfHost);
  return { success: true, data: summary };
}

async function handleGetLogStorage(request) {
  const data = await directGetLogStorage(request.sfHost);
  return { success: true, data };
}

// One-time login link for Copy Session URL / Incognito Login (needs the "web" scope)
async function handleGetSingleAccessUrl(request) {
  const url = await directGetSingleAccessUrl(request.sfHost);
  if (!url) return { success: false, error: 'The access token has no web scope' };
  return { success: true, data: { url } };
}

async function handleGetOAuthConfig() {
  return { success: true, data: await getOAuthConfig() };
}

async function handleSetOAuthClientId(request) {
  return { success: true, data: await setOAuthClientId(request.clientId) };
}
