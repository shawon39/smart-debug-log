// Connection Management and Session Handling
// This file handles Salesforce connection status, session detection, and related utilities

// Connection status management
async function checkConnectionStatus(targetHost = null) {
  try {
    const salesforceTabs = await getSalesforceTabs();

    if (salesforceTabs.length === 0) {
      updateConnectionStatus(false, 'No Salesforce tabs found');
      return;
    }

    // If we have a target host, prioritize tabs from that host
    if (targetHost) {
      // Find tabs that match the target host
      const targetHostTabs = salesforceTabs.filter(tab => {
        const tabUrl = new URL(tab.url);
        return tabUrl.hostname === targetHost || tab.url.includes(targetHost);
      });
      
      // Try tabs matching the target host first
      for (const tab of targetHostTabs) {
        const sessionData = await tryGetSessionForTab(tab);
        if (sessionData && (sessionData.sfHost === targetHost || sessionData.session.hostname === targetHost)) {
          sfHost = sessionData.sfHost;
          currentSession = sessionData.session;
          loadReadLogsFromStorage(); // Load read logs for this org
          loadClearedLogsFromStorage(); // Load cleared logs for this org
          cleanupExpiredLogs(); // Cleanup expired logs after loading
          updateConnectionStatus(true, `Connected to ${targetHost}`, sessionData.session);
          return;
        }
      }
      
      // If no valid session found for target host, show helpful error
      updateConnectionStatus(false, `No valid session found for ${targetHost}`);
      return;
    }

    // If no target host specified, use the original logic
    // First, check if the currently active/focused tab is a Salesforce tab
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];
    
    if (activeTab && activeTab.url && isSalesforceUrl(activeTab.url)) {
      const sessionData = await tryGetSessionForTab(activeTab);
      if (sessionData) {
        sfHost = sessionData.sfHost;
        currentSession = sessionData.session;
        loadReadLogsFromStorage();
        loadClearedLogsFromStorage();
        cleanupExpiredLogs();
        updateConnectionStatus(true, 'Connected', sessionData.session);
        return;
      }
    }

    // If active tab isn't Salesforce or doesn't have a session, 
    // check the most recently accessed Salesforce tab
    const sortedSalesforceTabs = salesforceTabs.sort((a, b) => {
      // Sort by lastAccessed (most recent first), with fallback to id for tabs without lastAccessed
      const aTime = a.lastAccessed || 0;
      const bTime = b.lastAccessed || 0;
      return bTime - aTime;
    });

    // Try each Salesforce tab starting with most recently accessed
    for (const tab of sortedSalesforceTabs) {
      const sessionData = await tryGetSessionForTab(tab);
      if (sessionData) {
        sfHost = sessionData.sfHost;
        currentSession = sessionData.session;
        loadReadLogsFromStorage(); // Load read logs for this org
        loadClearedLogsFromStorage(); // Load cleared logs for this org
        cleanupExpiredLogs(); // Cleanup expired logs after loading
        updateConnectionStatus(true, 'Connected', sessionData.session);
        return;
      }
    }

    updateConnectionStatus(false, 'No valid session found');
  } catch (error) {
    updateConnectionStatus(false, 'Connection check failed');
  }
}

// Helper function to try getting session for a specific tab
async function tryGetSessionForTab(tab) {
  try {
    const hostResponse = await chrome.runtime.sendMessage({
      type: 'GET_SALESFORCE_HOST',
      url: tab.url,
      tabId: tab.id
    });

    if (hostResponse.success && hostResponse.data.salesforceHost) {
      const sessionResponse = await chrome.runtime.sendMessage({
        type: 'GET_SESSION',
        sfHost: hostResponse.data.salesforceHost,
        tabId: tab.id
      });

      if (sessionResponse.success && sessionResponse.data) {
        const session = sessionResponse.data;
        // Add orgName if not present
        if (!session.orgName && session.hostname) {
          session.orgName = session.hostname;
        }
        
        return {
          sfHost: hostResponse.data.salesforceHost,
          session: session
        };
      }
    }
  } catch (error) {
    // Continue to return null on error
  }
  return null;
}

function updateConnectionStatus(connected, statusText = '', session = null) {
  const { connectionStatusText, orgActions } = elements;
  if (!connectionStatusText) return;
  
  if (connected && session) {
    const displayName = session.orgName || session.hostname || sfHost;
    const orgId = session.organizationId || session.orgId || '';
    connectionStatusText.textContent = `Connected ${displayName}${orgId ? ' (' + orgId + ')' : ''}`;
    
    if (orgActions) {
      orgActions.classList.remove('hidden');
      orgActions.style.display = 'flex';
    }
    
    const targetHost = getHostFromUrl();
    if (targetHost) {
      document.title = `Salesforce Debug Log Beautifier - ${targetHost}`;
    }
    
    const controlsBar = document.querySelector('.controls-bar');
    const existingHelpPanel = controlsBar?.querySelector('.session-help-panel');
    existingHelpPanel?.remove();
    
    setTimeout(checkDeveloperConsoleStatus, 500);
  } else {
    connectionStatusText.textContent = statusText;
    
    if (orgActions) {
      orgActions.classList.add('hidden');
      orgActions.style.display = 'none';
    }
  }
}

// Refresh dashboard when window gains focus (handles both tab switching and window focus)
const refreshDashboard = async () => {
  const targetHost = getHostFromUrl();
  await checkConnectionStatus(targetHost);
  if (currentSession && sfHost) {
    await loadDebugLogs();
  }
  setTimeout(checkDeveloperConsoleStatus, 300);
};

// Helper function to get auto-refresh state
function getAutoRefreshState() {
  const toggle = document.getElementById('autoRefreshToggle');
  if (!toggle) {
    return true; // Default to enabled if element not found
  }
  return toggle.checked;
}

window.addEventListener('focus', () => {
  const autoRefreshEnabled = getAutoRefreshState();
  if (autoRefreshEnabled) {
    setTimeout(refreshDashboard, 100);
  }
});

// Developer Console management
async function checkDeveloperConsoleStatus() {
  if (!sfHost || !currentSession) {
    hideDevConsoleWarning();
    return;
  }

  try {
    const isDismissed = sessionStorage.getItem(`devConsole_dismissed_${sfHost}`);
    if (isDismissed) {
      hideDevConsoleWarning();
      return;
    }

    const tabs = await chrome.tabs.query({});
    const devConsoleTabs = tabs.filter(tab => {
      if (!tab.url) return false;
      return tab.url.includes(sfHost) && 
             (tab.url.includes('/_ui/common/apex/debug/ApexCSIPage') ||
              tab.url.includes('/debug/debug.jsp') ||
              tab.url.includes('/apexDebug') ||
              tab.url.includes('debug') && tab.url.includes('apex'));
    });

    if (devConsoleTabs.length === 0) {
      showDevConsoleWarning();
    } else {
      hideDevConsoleWarning();
    }
  } catch (error) {
    hideDevConsoleWarning();
  }
}

function showDevConsoleWarning() {
  elements.devConsoleWarning?.classList.remove('hidden');
}

function hideDevConsoleWarning() {
  elements.devConsoleWarning?.classList.add('hidden');
}

async function openDeveloperConsole() {
  if (!sfHost) return;

  try {
    const developerConsoleUrl = `https://${sfHost}/_ui/common/apex/debug/ApexCSIPage`;
    
    await chrome.tabs.create({
      url: developerConsoleUrl,
      active: false
    });

    setTimeout(checkDeveloperConsoleStatus, 1000);
    
  } catch (error) {
    // Failed
  }
}

function dismissDevConsoleWarning() {
  if (sfHost) {
    sessionStorage.setItem(`devConsole_dismissed_${sfHost}`, 'true');
  }
  hideDevConsoleWarning();
}

function dismissSessionHelp() {
  const controlsBar = document.querySelector('.controls-bar');
  const existingHelpPanel = controlsBar?.querySelector('.session-help-panel');
  existingHelpPanel?.remove();
}

async function autoEstablishSession(targetHost) {
  try {
    const classicDomain = targetHost.replace('.lightning.force.com', '.my.salesforce.com');
    
    await chrome.tabs.create({
      url: `https://${classicDomain}/lightning/page/home`,
      active: true
    });
    
    setTimeout(async () => {
      await checkConnectionStatus(targetHost);
    }, 3000);
    
  } catch (error) {
    // Failed
  }
}