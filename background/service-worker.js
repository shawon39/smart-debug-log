import DebugLogManager from './debug-log-manager.js';
import sessionManager from './session-manager.js';
import {
  extractOrgDomain,
  getStoredOAuthToken,
  performOAuthLogin,
  isTokenExpired,
  getTokenStorageKey
} from './oauth-manager.js';
import {
  directToolingQuery,
  directToolingCreate,
  directToolingUpdate,
  directToolingDelete,
  directToolingDescribe,
  directGetLogBody,
  directExecuteAnonymous,
  directQuery
} from './api-client.js';
import {
  storeAutoTraceFlagMetadata,
  getAutoTraceFlagMetadata,
  removeAutoTraceFlagMetadata,
  cleanupExpiredTraceFlagLogs
} from './traceflag-manager.js';
import {
  saveApexCodeToStorage,
  getApexCodesFromStorage,
  updateApexCodeInStorage,
  deleteApexCodeFromStorage
} from './apex-storage.js';

const debugLogManager = new DebugLogManager();

// Simple error check for harmless extension warnings
function checkLastError() {
  if (chrome.runtime.lastError) {
    console.debug('Extension runtime message:', chrome.runtime.lastError.message);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  try {
    sessionManager.initialize();
    debugLogManager.initialize();
    checkLastError();
  } catch (error) {
    console.warn('Extension initialization warning:', error.message);
  }
});

chrome.runtime.onStartup.addListener(() => {
  try {
    sessionManager.initialize();
    debugLogManager.initialize();
    checkLastError();
  } catch (error) {
    console.warn('Extension startup warning:', error.message);
  }
});

// Alarm listener for auto trace flag cleanup
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('cleanup_traceflag_')) {
    const traceFlagId = alarm.name.replace('cleanup_traceflag_', '');
    cleanupExpiredTraceFlagLogs(traceFlagId);
  }
});

// Keyboard shortcut command listener (Alt+Shift+D / Option+Shift+D)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-debug-dashboard') {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let sfHost = null;

      if (tab && tab.url) {
        sfHost = await sessionManager.getSalesforceHost(tab.url, tab.id);
      }

      // Auto-enable debug if possible
      try {
        const token = await getStoredOAuthToken(sfHost);
        if (token && token.id) {
          const parts = token.id.split('/');
          const userId = parts.length >= 2 ? parts[parts.length - 1] : null;

          if (userId) {
            const now = new Date();
            const expiration = new Date(now.getTime() + 45 * 60 * 1000);

            const levelQuery = `SELECT Id FROM DebugLevel WHERE DeveloperName = 'SFDC_DevConsole' LIMIT 1`;
            const levelResult = await directToolingQuery(levelQuery, sfHost);

            if (levelResult.records && levelResult.records.length > 0) {
              const debugLevelId = levelResult.records[0].Id;
              const checkQuery = `SELECT Id, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'USER_DEBUG' AND DebugLevelId = '${debugLevelId}' ORDER BY ExpirationDate DESC LIMIT 1`;
              const checkResult = await directToolingQuery(checkQuery, sfHost);

              let needsAction = true;
              let existingTraceFlagId = null;

              if (checkResult.records && checkResult.records.length > 0) {
                const traceFlagExpiration = new Date(checkResult.records[0].ExpirationDate);
                existingTraceFlagId = checkResult.records[0].Id;
                if (traceFlagExpiration > now) needsAction = false;
              }

              if (needsAction) {
                let traceFlagId;
                if (existingTraceFlagId) {
                  await directToolingUpdate('TraceFlag', existingTraceFlagId, {
                    StartDate: now.toISOString(),
                    ExpirationDate: expiration.toISOString(),
                    DebugLevelId: debugLevelId
                  }, sfHost);
                  traceFlagId = existingTraceFlagId;
                } else {
                  const traceFlagResult = await directToolingCreate('TraceFlag', {
                    TracedEntityId: userId,
                    LogType: 'USER_DEBUG',
                    DebugLevelId: debugLevelId,
                    StartDate: now.toISOString(),
                    ExpirationDate: expiration.toISOString()
                  }, sfHost);
                  traceFlagId = traceFlagResult.id;
                }

                const orgDomain = extractOrgDomain(sfHost);
                await storeAutoTraceFlagMetadata({
                  traceFlagId,
                  userId,
                  startTime: now.toISOString(),
                  expirationDate: expiration.toISOString(),
                  orgDomain
                });

                chrome.alarms.create(`cleanup_traceflag_${traceFlagId}`, { when: expiration.getTime() });
              }
            }
          }
        }
      } catch (e) {
        console.warn('Could not auto-enable debug:', e);
      }

      const baseUrl = chrome.runtime.getURL('dashboard.html');
      const dashboardUrl = sfHost ? `${baseUrl}?host=${encodeURIComponent(sfHost)}` : baseUrl;
      const tabs = await chrome.tabs.query({});
      const existingDashboard = tabs.find(t => {
        if (!t.url) return false;
        if (sfHost) {
          const targetUrl = `${baseUrl}?host=${encodeURIComponent(sfHost)}`;
          return t.url === targetUrl || t.url.startsWith(targetUrl + '&');
        }
        return t.url === baseUrl || (t.url.startsWith(baseUrl) && !t.url.includes('?host='));
      });

      if (existingDashboard) {
        await chrome.tabs.update(existingDashboard.id, { active: true });
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
    const result = await handleMessage(request, sender);
    sendResponse(result);
  } catch (error) {
    console.error('[Background] Message handler error:', error);
    sendResponse({ success: false, error: error.message || 'Unknown error occurred' });
  }
}

async function handleMessage(request, sender) {
  switch (request.type) {
    case 'GET_SALESFORCE_HOST': return await handleGetSalesforceHost(request, sender);
    case 'GET_SESSION': return await handleGetSession(request, sender);
    case 'GET_RECENT_LOGS': return await handleGetRecentLogs(request, sender);
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
    case 'REVOKE_OAUTH_TOKEN': return await handleRevokeOAuthToken(request, sender);
    case 'SEARCH_USERS': return await handleSearchUsers(request, sender);
    case 'CLEAR_ALL_LOGS_CACHE': return await handleClearAllLogsCache(request, sender);
    case 'DELETE_LOGS_BY_IDS': return await handleDeleteLogsByIds(request, sender);
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

async function handleGetRecentLogs(request, sender) {
  const { orgId, limit } = request;
  const logs = await debugLogManager.getRecentLogs(orgId, limit);
  return { success: true, data: logs };
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
  return { success: true, data: result };
}

async function handleToolingUpdate(request, sender) {
  const { sobjectType, recordId, data, sfHost } = request;
  const result = await directToolingUpdate(sobjectType, recordId, data, sfHost);

  if (sobjectType === 'TraceFlag' && data.ExpirationDate) {
    const autoTraceFlags = await getAutoTraceFlagMetadata();
    const metadata = autoTraceFlags.find(tf => tf.traceFlagId === recordId);
    if (metadata) {
      const now = new Date();
      const newExpiration = new Date(data.ExpirationDate);
      if (newExpiration <= now) {
        cleanupExpiredTraceFlagLogs(recordId).catch(() => { });
      } else {
        await removeAutoTraceFlagMetadata(recordId);
        await storeAutoTraceFlagMetadata({ ...metadata, expirationDate: newExpiration.toISOString() });
        const alarmName = `cleanup_traceflag_${recordId}`;
        await chrome.alarms.clear(alarmName);
        await chrome.alarms.create(alarmName, { when: newExpiration.getTime() });
      }
    }
  }
  return { success: true, data: result };
}

async function handleToolingDelete(request, sender) {
  const { sobjectType, recordId, sfHost } = request;
  const result = await directToolingDelete(sobjectType, recordId, sfHost);
  if (sobjectType === 'TraceFlag') {
    const autoTraceFlags = await getAutoTraceFlagMetadata();
    if (autoTraceFlags.find(tf => tf.traceFlagId === recordId)) {
      cleanupExpiredTraceFlagLogs(recordId).catch(() => { });
    }
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
  const updated = await updateApexCodeInStorage({ ...request, timestamp: Date.now() });
  return { success: true, message: 'Apex code updated successfully', data: updated };
}

async function handleDeleteApexCode(request) {
  await deleteApexCodeFromStorage(request.id);
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
  const { sfHost } = request;
  const token = await getStoredOAuthToken(sfHost);
  if (!token) return { success: false, error: 'No OAuth token available' };

  let userId = null;
  if (token.id) {
    const parts = token.id.split('/');
    if (parts.length >= 2) userId = parts[parts.length - 1];
  }
  if (!userId) return { success: false, error: 'Could not determine user ID' };

  const now = new Date();
  const expiration = new Date(now.getTime() + 45 * 60 * 1000);
  const levelQuery = `SELECT Id FROM DebugLevel WHERE DeveloperName = 'SFDC_DevConsole' LIMIT 1`;
  const levelResult = await directToolingQuery(levelQuery, sfHost);

  let debugLevelId;
  if (levelResult.records && levelResult.records.length > 0) {
    debugLevelId = levelResult.records[0].Id;
  } else {
    const anyLevelResult = await directToolingQuery(`SELECT Id FROM DebugLevel LIMIT 1`, sfHost);
    if (anyLevelResult.records && anyLevelResult.records.length > 0) debugLevelId = anyLevelResult.records[0].Id;
    else return { success: false, error: 'No debug level found' };
  }

  const checkQuery = `SELECT Id, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'USER_DEBUG' AND DebugLevelId = '${debugLevelId}' ORDER BY ExpirationDate DESC LIMIT 1`;
  const checkResult = await directToolingQuery(checkQuery, sfHost);

  let traceFlagId;
  if (checkResult.records && checkResult.records.length > 0) {
    const tf = checkResult.records[0];
    if (new Date(tf.ExpirationDate) > now) return { success: true, data: { existing: true, traceFlagId: tf.Id } };
    await directToolingUpdate('TraceFlag', tf.Id, { StartDate: now.toISOString(), ExpirationDate: expiration.toISOString(), DebugLevelId: debugLevelId }, sfHost);
    traceFlagId = tf.Id;
  } else {
    const createResult = await directToolingCreate('TraceFlag', { TracedEntityId: userId, LogType: 'USER_DEBUG', DebugLevelId: debugLevelId, StartDate: now.toISOString(), ExpirationDate: expiration.toISOString() }, sfHost);
    traceFlagId = createResult.id;
  }

  const orgDomain = extractOrgDomain(sfHost || token.instanceUrl);
  await storeAutoTraceFlagMetadata({ traceFlagId, userId, startTime: now.toISOString(), expirationDate: expiration.toISOString(), orgDomain });
  chrome.alarms.create(`cleanup_traceflag_${traceFlagId}`, { when: expiration.getTime() });
  return { success: true, data: { traceFlagId } };
}

async function handleSearchUsers(request) {
  const escapedTerm = request.searchTerm.replace(/'/g, "\\'");
  const query = `SELECT Id, Name, Username, Email FROM User WHERE (Name LIKE '%${escapedTerm}%' OR Username LIKE '%${escapedTerm}%') AND IsActive = true ORDER BY Name LIMIT 10`;
  const result = await directQuery(query, request.sfHost);
  return { success: true, data: result.records || [] };
}

async function handleRevokeOAuthToken(request) {
  const keysToRemove = ['sfOAuthToken'];
  if (request.sfHost) {
    const storageKey = getTokenStorageKey(extractOrgDomain(request.sfHost));
    if (storageKey !== 'sfOAuthToken') keysToRemove.push(storageKey);
  }
  await chrome.storage.local.remove(keysToRemove);
  return { success: true, message: 'Access token revoked successfully' };
}

async function handleClearAllLogsCache(request) {
  const token = await getStoredOAuthToken(request.sfHost);
  if (token && token.id) {
    const parts = token.id.split('/');
    if (parts.length >= 2) await chrome.storage.local.remove(`debug-logs-${parts[parts.length - 2]}`);
  }
  try {
    chrome.runtime.sendMessage({ type: 'CLEAR_ALL_LOGS_CACHE_BROADCAST', orgDomain: extractOrgDomain(request.sfHost) }).catch(() => { });
  } catch (e) { }
  return { success: true, message: 'All logs cache cleared successfully' };
}

async function handleDeleteLogsByIds(request) {
  const { logIds, sfHost } = request;
  if (!logIds?.length) return { success: true, message: 'No log IDs to delete' };
  const token = await getStoredOAuthToken(sfHost);
  if (token && token.id) {
    const parts = token.id.split('/');
    if (parts.length >= 2) await debugLogManager.removeLogsByIds(parts[parts.length - 2], logIds);
  }
  try {
    chrome.runtime.sendMessage({ type: 'LOGS_DELETED', logIds, orgDomain: extractOrgDomain(sfHost) }).catch(() => { });
  } catch (e) { }
  return { success: true, message: `Removed ${logIds.length} log(s) from cache` };
}
