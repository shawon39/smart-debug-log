import sessionManager from './session-manager.js';
import DebugLogManager from './debug-log-manager.js';

const debugLogManager = new DebugLogManager();

chrome.runtime.onInstalled.addListener(() => {
  sessionManager.initialize();
  debugLogManager.initialize();
});

chrome.runtime.onStartup.addListener(() => {
  sessionManager.initialize();
  debugLogManager.initialize();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true;
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('debug-log-')) {
    const logId = notificationId.replace('debug-log-', '');
  }
});

async function handleMessage(request, sender, sendResponse) {
  try {
    let result;
    switch (request.type) {
      case 'GET_SALESFORCE_HOST':
        result = await handleGetSalesforceHost(request, sender);
        break;
      case 'GET_SESSION':
        result = await handleGetSession(request, sender);
        break;
      case 'START_DEBUG_MONITORING':
        result = await handleStartDebugMonitoring(request, sender);
        break;
      case 'STOP_DEBUG_MONITORING':
        result = await handleStopDebugMonitoring(request, sender);
        break;
      case 'GET_MONITORING_STATUS':
        result = await handleGetMonitoringStatus(request, sender);
        break;
      case 'GET_RECENT_LOGS':
        result = await handleGetRecentLogs(request, sender);
        break;
      case 'GET_LOG_CONTENT':
        result = await handleGetLogContent(request, sender);
        break;
      case 'EXECUTE_TOOLING_QUERY':
        result = await handleExecuteToolingQuery(request, sender);
        break;
      case 'TOOLING_CREATE':
        result = await handleToolingCreate(request, sender);
        break;
      case 'DOWNLOAD_LOG':
        result = await handleDownloadLog(request, sender);
        break;
      case 'ENSURE_DEBUG_INFRASTRUCTURE':
        result = await handleEnsureDebugInfrastructure(request, sender);
        break;
      default:
        result = { success: false, message: `Unknown message type: ${request.type}` };
    }
    sendResponse(result);
  } catch (error) {
    sendResponse({
      success: false,
      error: error.message || 'Unknown error occurred'
    });
  }
}

async function handleGetSalesforceHost(request, sender) {
  try {
    const url = request.url || sender.tab?.url;
    const tabId = request.tabId || sender.tab?.id;
    
    if (!url) {
      return { success: false, message: 'No URL provided' };
    }

    let sfHost = null;
    let extractedFromExtension = false;

    if (url.startsWith('chrome-extension://')) {
      try {
        const urlObj = new URL(url);
        const hostParam = urlObj.searchParams.get('host');
        
        if (hostParam) {
          sfHost = hostParam;
          extractedFromExtension = true;
        }
      } catch (error) {
        // Continue
      }
    }

    if (!sfHost) {
      sfHost = await sessionManager.getSalesforceHost(url, tabId);
    }

    let sessionInfo = null;
    let sessionFound = false;
    
    try {
      const session = await sessionManager.getSession(sfHost, tabId);
      if (session) {
        sessionFound = true;
        sessionInfo = {
          orgId: session.orgId,
          sessionId: session.sessionId ? session.sessionId + '...' : 'NOT_FOUND',
          sessionToken: session.sessionToken ? session.sessionToken.substring(0, 20) + '...' : 'NOT_FOUND',
          hostname: session.hostname,
          domain: session.domain,
          displayDomain: session.displayDomain,
          apiDomain: session.apiDomain,
          isValid: session.isValid,
          hasKey: !!session.key,
          keyLength: session.key ? session.key.length : 0,
          sessionIdLength: session.sessionId ? session.sessionId.length : 0
        };
      }
    } catch (sessionError) {
      // Failed
    }

    return {
      success: true,
      data: {
        salesforceHost: sfHost,
        sessionFound: sessionFound,
        sessionInfo: sessionInfo,
        extractedFromExtension: extractedFromExtension
      }
    };

  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to detect Salesforce host'
    };
  }
}

async function handleGetSession(request, sender) {
  try {
    const sfHost = request.sfHost;
    const tabId = request.tabId || sender.tab?.id;
    
    if (!sfHost) {
      return { success: false, message: 'Salesforce host is required' };
    }

    const session = await sessionManager.getSession(sfHost, tabId);
    
    if (!session) {
      const relatedDomains = sessionManager.getRelatedDomains(sfHost);
      
      for (const domain of relatedDomains) {
        try {
          const relatedSession = await sessionManager.getSessionFromDomain(domain, tabId);
          if (relatedSession) {
            return {
              success: true,
              data: relatedSession
            };
          }
        } catch (relatedError) {
          // Continue
        }
      }
      
      return { success: false, message: 'No session found' };
    }

    return {
      success: true,
      data: session
    };

  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to get session'
    };
  }
}

async function handleStartDebugMonitoring(request, sender) {
  try {
    const { orgId, session, options } = request;
    const result = await debugLogManager.startMonitoring(orgId, session, options);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to start monitoring'
    };
  }
}

async function handleStopDebugMonitoring(request, sender) {
  try {
    const { orgId } = request;
    const result = await debugLogManager.stopMonitoring(orgId);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to stop monitoring'
    };
  }
}

async function handleGetMonitoringStatus(request, sender) {
  try {
    const status = debugLogManager.getMonitoringStatus();
    return { success: true, data: status };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to get monitoring status'
    };
  }
}

async function handleGetRecentLogs(request, sender) {
  try {
    const { orgId, limit } = request;
    const logs = await debugLogManager.getRecentLogs(orgId, limit);
    return { success: true, data: logs };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to get recent logs'
    };
  }
}

async function handleGetLogContent(request, sender) {
  try {
    const { logId, orgId, targetHost } = request;
    
    const tabs = await chrome.tabs.query({});
    const salesforceTabs = tabs.filter(tab => 
      tab.url && (
        tab.url.includes('.salesforce.com') || 
        tab.url.includes('.force.com') ||
        tab.url.includes('.lightning.force.com') ||
        tab.url.includes('--c.visualforce.com') ||
        tab.url.includes('.my.salesforce.com')
      )
    );

    if (salesforceTabs.length === 0) {
      return { success: false, message: 'No Salesforce tabs available for API calls' };
    }

    let targetTabs = salesforceTabs;
    if (targetHost) {
      const hostTabs = salesforceTabs.filter(tab => {
        const tabUrl = new URL(tab.url);
        return tabUrl.hostname === targetHost || tab.url.includes(targetHost);
      });
      
      if (hostTabs.length > 0) {
        targetTabs = hostTabs;
      }
    }

    let targetTab = null;
    for (const tab of targetTabs) {
      try {
        const tabUrl = new URL(tab.url);
        const sfHost = tabUrl.hostname;
        const session = await sessionManager.getSession(sfHost, tab.id);
        
        if (session && session.isValid) {
          targetTab = tab;
          break;
        }
      } catch (error) {
        // Continue
      }
    }

    if (!targetTab) {
      for (const tab of salesforceTabs) {
        try {
          const tabUrl = new URL(tab.url);
          const sfHost = tabUrl.hostname;
          const session = await sessionManager.getSession(sfHost, tab.id);
          
          if (session && session.isValid) {
            targetTab = tab;
            break;
          }
        } catch (error) {
          // Continue
        }
      }
    }

    if (!targetTab) {
      return { success: false, message: 'No valid Salesforce session found' };
    }

    const tabUrl = new URL(targetTab.url);
    const sfHost = tabUrl.hostname;
    const session = await sessionManager.getSession(sfHost, targetTab.id);

    if (!session) {
      return { success: false, message: 'Failed to get session for log retrieval' };
    }

    const isReady = await debugLogManager.isContentScriptReady(targetTab.id);
    if (!isReady) {
      return { success: false, message: 'Content script not ready' };
    }

    const instanceUrl = `https://${tabUrl.hostname}`;

    const sessionData = {
      sessionId: session.sessionId,
      instanceUrl: instanceUrl,
      orgId: session.orgId,
      domain: session.domain
    };

    const response = await chrome.tabs.sendMessage(targetTab.id, {
      action: 'GET_LOG_BODY',
      logId: logId,
      session: sessionData
    });

    if (response && response.success) {
      return { success: true, data: response.data };
    } else {
      return { success: false, message: response?.error || 'Failed to get log content' };
    }

  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to get log content'
    };
  }
}

async function handleExecuteToolingQuery(request, sender) {
  try {
    const { query, session } = request;
    
    if (!query) {
      return { success: false, message: 'Query is required' };
    }
    
    if (!session) {
      return { success: false, message: 'Session is required' };
    }

    const result = await debugLogManager.executeToolingQuery(session, query);
    
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to execute tooling query'
    };
  }
}

async function handleToolingCreate(request, sender) {
  try {
    const { sobjectType, data, session } = request;
    
    if (!sobjectType) {
      return { success: false, message: 'SObject type is required' };
    }
    
    if (!data) {
      return { success: false, message: 'Data is required' };
    }
    
    if (!session) {
      return { success: false, message: 'Session is required' };
    }

    const result = await debugLogManager.executeToolingCreate(session, sobjectType, data);
    
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to create record via Tooling API'
    };
  }
}

async function handleDownloadLog(request, sender) {
  try {
    const { logId, session } = request;
    
    if (!logId || !session) {
      return { success: false, message: 'Log ID and session are required' };
    }

    await debugLogManager.downloadLogContent(logId, session);
    return { success: true, message: 'Log content downloaded successfully' };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to download log content'
    };
  }
}

async function handleEnsureDebugInfrastructure(request, sender) {
  try {
    const { session } = request;
    
    if (!session) {
      return { success: false, message: 'Session is required' };
    }

    const infrastructureReady = await debugLogManager.ensureDebugInfrastructure(session);
    
    return { 
      success: infrastructureReady, 
      message: infrastructureReady ? 'Debug infrastructure ready' : 'Failed to setup debug infrastructure'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to ensure debug infrastructure'
    };
  }
} 