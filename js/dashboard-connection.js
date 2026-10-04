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
    connectionStatusText.textContent = displayName;
    if (orgId) {
      const orgIdEl = document.createElement('span');
      orgIdEl.className = 'org-id';
      orgIdEl.textContent = orgId;
      connectionStatusText.appendChild(orgIdEl);
    }
    connectionStatusText.title = `Connected to ${displayName}${orgId ? ' (' + orgId + ')' : ''}`;
    connectionStatusText.classList.add('is-connected');
    connectionStatusText.classList.remove('is-error');
    
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
    
    setTimeout(checkOAuthTokenStatus, 500);
  } else {
    connectionStatusText.textContent = statusText;
    connectionStatusText.title = statusText;
    connectionStatusText.classList.remove('is-connected');
    connectionStatusText.classList.add('is-error');
    
    if (orgActions) {
      orgActions.classList.add('hidden');
      orgActions.style.display = 'none';
    }
  }
}

// Refresh dashboard when window gains focus (handles both tab switching and window focus)
// Focus events this soon after the last refresh (or after the page opened) are ignored
const FOCUS_REFRESH_MIN_GAP_MS = 10000;
let lastDashboardRefreshTime = Date.now();

const refreshDashboard = async () => {
  lastDashboardRefreshTime = Date.now();
  const targetHost = getHostFromUrl();
  await checkConnectionStatus(targetHost);
  if (currentSession && sfHost) {
    // Incremental refresh to get latest logs without clearing cache; keeps the opened pages and selection
    await loadDebugLogs({ keepPosition: true });
  }
  setTimeout(checkOAuthTokenStatus, 300);
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
  if (autoRefreshEnabled && Date.now() - lastDashboardRefreshTime >= FOCUS_REFRESH_MIN_GAP_MS) {
    setTimeout(refreshDashboard, 100);
  }
});

// OAuth Token management
async function checkOAuthTokenStatus() {
  try {
    const isDismissed = sessionStorage.getItem('oauth_warning_dismissed');
    if (isDismissed) {
      hideTokenWarning();
      return;
    }

    // Check if OAuth token exists
    const targetHost = getHostFromUrl() || sfHost;
    const response = await chrome.runtime.sendMessage({
      type: 'CHECK_TOKEN_STATUS',
      sfHost: targetHost
    });
    
    const revokeBtn = elements.revokeTokenDashboardBtn;
    
    if (response && response.success && response.data) {
      if (!response.data.hasToken || response.data.isExpired) {
        // No token or expired - show warning, hide revoke button
        showTokenWarning();
        if (revokeBtn) {
          revokeBtn.style.display = 'none';
        }
      } else {
        // Token exists and is valid - hide warning, show revoke button
        hideTokenWarning();
        if (revokeBtn) {
          revokeBtn.style.display = 'inline-flex';
        }
      }
    } else {
      hideTokenWarning();
      if (revokeBtn) {
        revokeBtn.style.display = 'none';
      }
    }
  } catch (error) {
    hideTokenWarning();
    const revokeBtn = elements.revokeTokenDashboardBtn;
    if (revokeBtn) {
      revokeBtn.style.display = 'none';
    }
  }
}

// Alias for backward compatibility
const checkDeveloperConsoleStatus = checkOAuthTokenStatus;

function showTokenWarning() {
  elements.devConsoleWarning?.classList.remove('hidden');
}

function hideTokenWarning() {
  elements.devConsoleWarning?.classList.add('hidden');
}

async function generateAccessToken() {
  const button = document.getElementById('openDevConsoleBtn');
  const originalText = button?.innerHTML;
  
  try {
    if (button) {
      button.disabled = true;
      button.innerHTML = `${Icons.svg('loader')}Authenticating...`;
    }
    
    // Get the domain from URL parameter or use detected sfHost
    const targetHost = getHostFromUrl() || sfHost;
    
    const response = await chrome.runtime.sendMessage({
      type: 'SF_GENERATE_TOKEN',
      orgUrl: targetHost
    });
    
    if (response && response.success) {
      if (button) {
        button.innerHTML = `${Icons.svg('check')}Token generated`;
      }
      hideTokenWarning();
      
      // Auto-enable debug logging (45 min) for current user
      try {
        await chrome.runtime.sendMessage({ 
          type: 'ENSURE_TRACE_FLAG',
          sfHost: targetHost
        });
        
        // Set log type to Monitoring after trace flag creation
        const logTypeFilter = document.getElementById('logTypeFilter');
        if (logTypeFilter) {
          logTypeFilter.value = 'Monitoring';
          // Save the preference
          await savePreferences();
        }
      } catch (traceFlagError) {
        // Continue even if trace flag creation fails - user can enable manually
        console.warn('Could not auto-enable debug:', traceFlagError);
      }
      
      // Refresh the dashboard to use the new token
      setTimeout(async () => {
        await loadDebugLogs();
        if (button) {
          button.innerHTML = originalText;
          button.disabled = false;
        }
      }, 1500);
    } else {
      throw new Error(response?.error || 'Failed to generate token');
    }
  } catch (error) {
    console.error('Token generation failed:', error);
    if (button) {
      button.innerHTML = `${Icons.svg('circleX')}Failed - try again`;
      setTimeout(() => {
        button.innerHTML = originalText;
        button.disabled = false;
      }, 2000);
    }
  }
}

// Alias for backward compatibility
const openDeveloperConsole = generateAccessToken;

function dismissTokenWarning() {
  sessionStorage.setItem('oauth_warning_dismissed', 'true');
  hideTokenWarning();
}

// Alias for backward compatibility
const dismissDevConsoleWarning = dismissTokenWarning;

async function revokeAccessTokenDashboard() {
  const confirmed = confirm('Are you sure you want to revoke your access token? You\'ll need to re-authenticate to use features requiring an access token.');
  
  if (!confirmed) {
    return;
  }
  
  const button = elements.revokeTokenDashboardBtn;
  const originalText = button?.textContent;
  
  try {
    if (button) {
      button.disabled = true;
      button.textContent = 'Revoking...';
    }
    
    const targetHost = getHostFromUrl() || sfHost;
    
    const response = await chrome.runtime.sendMessage({
      type: 'REVOKE_OAUTH_TOKEN',
      sfHost: targetHost
    });
    
    if (response && response.success) {
      if (button) {
        button.textContent = 'Token Revoked!';
        button.style.background = 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)';
      }
      
      // Show warning banner and hide revoke button
      showTokenWarning();
      
      setTimeout(() => {
        if (button) {
          button.style.display = 'none';
          button.textContent = originalText;
          button.style.background = '';
          button.disabled = false;
        }
        // Refresh to clear any loaded logs
        refreshDashboard();
      }, 1500);
    } else {
      throw new Error(response?.error || 'Failed to revoke token');
    }
  } catch (error) {
    console.error('Token revocation failed:', error);
    if (button) {
      button.textContent = 'Failed - Try Again';
      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 2000);
    }
  }
}