import sessionManager from './session-manager.js';
import DebugLogManager from './debug-log-manager.js';

const debugLogManager = new DebugLogManager();

// Simple error check for harmless extension warnings
function checkLastError() {
  if (chrome.runtime.lastError) {
    // Just log the error - no need for complex suppression logic
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true;
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
      case 'SAVE_APEX_CODE':
        result = await handleSaveApexCode(request, sender);
        break;
      case 'UPDATE_APEX_CODE':
        result = await handleUpdateApexCode(request, sender);
        break;
      case 'GET_APEX_CODES':
        result = await handleGetApexCodes(request, sender);
        break;
      case 'DELETE_APEX_CODE':
        result = await handleDeleteApexCode(request, sender);
        break;
      case 'EXECUTE_ANONYMOUS':
        result = await handleExecuteAnonymous(request, sender);
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

// Apex Code Management Functions
async function handleSaveApexCode(request, sender) {
  try {
    const { name, code, orgId } = request;
    
    if (!name || !code) {
      return { success: false, message: 'Name and code are required' };
    }

    await saveApexCodeToStorage({
      name,
      code,
      orgId: orgId || 'unknown',
      timestamp: Date.now()
    });

    return { success: true, message: 'Apex code saved successfully' };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to save Apex code'
    };
  }
}

async function handleGetApexCodes(request, sender) {
  try {
    const { orgId } = request;
    const codes = await getApexCodesFromStorage(orgId);
    return { success: true, data: codes };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to get Apex codes'
    };
  }
}

async function handleUpdateApexCode(request, sender) {
  try {
    const { id, name, code, orgId } = request;
    
    if (!id || !name || !code) {
      return { success: false, message: 'ID, name and code are required' };
    }

    await updateApexCodeInStorage({
      id,
      name,
      code,
      orgId: orgId || 'unknown',
      timestamp: Date.now()
    });

    return { success: true, message: 'Apex code updated successfully' };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to update Apex code'
    };
  }
}

async function handleDeleteApexCode(request, sender) {
  try {
    const { id } = request;
    await deleteApexCodeFromStorage(id);
    return { success: true, message: 'Apex code deleted successfully' };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to delete Apex code'
    };
  }
}

async function handleExecuteAnonymous(request, sender) {
  try {
    const { code, session } = request;
    
    if (!code || !session) {
      return { success: false, message: 'Code and session are required' };
    }

    const result = await executeAnonymousApex(session, code);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to execute anonymous Apex'
    };
  }
}

// Storage Functions
async function saveApexCodeToStorage(apexData) {
  const id = `apex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const storageKey = `apexCodes_${apexData.orgId}`;
  
  const result = await chrome.storage.local.get(storageKey);
  const codes = result[storageKey] || [];
  
  codes.push({
    id,
    ...apexData
  });
  
  await chrome.storage.local.set({ [storageKey]: codes });
}

async function getApexCodesFromStorage(orgId) {
  const storageKey = `apexCodes_${orgId}`;
  const result = await chrome.storage.local.get(storageKey);
  return result[storageKey] || [];
}

async function updateApexCodeInStorage(apexData) {
  const allKeys = await chrome.storage.local.get();
  
  for (const key of Object.keys(allKeys)) {
    if (key.startsWith('apexCodes_')) {
      const codes = allKeys[key];
      const codeIndex = codes.findIndex(code => code.id === apexData.id);
      
      if (codeIndex !== -1) {
        // Update existing code
        codes[codeIndex] = {
          ...codes[codeIndex],
          ...apexData,
          timestamp: Date.now() // Update timestamp
        };
        await chrome.storage.local.set({ [key]: codes });
        return;
      }
    }
  }
  
  // If code not found, throw error
  throw new Error('Apex code not found for update');
}

async function deleteApexCodeFromStorage(id) {
  const allKeys = await chrome.storage.local.get();
  
  for (const key of Object.keys(allKeys)) {
    if (key.startsWith('apexCodes_')) {
      const codes = allKeys[key];
      const updatedCodes = codes.filter(code => code.id !== id);
      
      if (updatedCodes.length !== codes.length) {
        await chrome.storage.local.set({ [key]: updatedCodes });
        break;
      }
    }
  }
}

async function executeAnonymousApex(session, apexCode) {
  const tabs = await chrome.tabs.query({});
  const salesforceTabs = tabs.filter(tab => 
    tab.url && (
      tab.url.includes('.salesforce.com') || 
      tab.url.includes('.force.com') ||
      tab.url.includes('.lightning.force.com') ||
      tab.url.includes('.my.salesforce.com')
    )
  );

  if (salesforceTabs.length === 0) {
    throw new Error('No Salesforce tabs available for API calls');
  }

  const targetTab = salesforceTabs[0];
  
  // Ensure session has instanceUrl
  const sessionForApex = {
    ...session,
    instanceUrl: session.instanceUrl || `https://${session.domain || session.hostname}`
  };
  
  try {
    const response = await chrome.tabs.sendMessage(targetTab.id, {
      action: 'EXECUTE_ANONYMOUS',
      code: apexCode,
      session: sessionForApex
    });

    if (response && response.success) {
      return response.data;
    } else {
      throw new Error(response?.error || 'Failed to execute anonymous Apex');
    }
  } catch (error) {
    if (error.message.includes('Receiving end does not exist')) {
      // Try to inject content script and retry once
      try {
        await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          files: ['content/api-handler.js', 'content/api-operations.js', 'content/session-extraction.js']
        });
        
        // Wait longer for the scripts to initialize and register listeners
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Send a ping to verify content script is ready
        try {
          const pingResponse = await chrome.tabs.sendMessage(targetTab.id, { action: 'PING' });
          if (!pingResponse || !pingResponse.success) {
            throw new Error('Content script not responding to ping');
          }
        } catch (pingError) {
          throw new Error('Content script failed to initialize properly');
        }
        
        // Retry the message
        const retryResponse = await chrome.tabs.sendMessage(targetTab.id, {
          action: 'EXECUTE_ANONYMOUS',
          code: apexCode,
          session: sessionForApex
        });

        if (retryResponse && retryResponse.success) {
          return retryResponse.data;
        } else {
          throw new Error(retryResponse?.error || 'Failed to execute anonymous Apex after retry');
        }
      } catch (retryError) {
        throw new Error(`Could not establish connection: ${retryError.message}. Please refresh the Salesforce tab and try again.`);
      }
    }
    throw error;
  }
}


