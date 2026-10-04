// Connection Management and Session Handling
// This file handles Salesforce connection status, session detection, and related utilities

// Connection status management
async function checkConnectionStatus(targetHost = null) {
  try {
    // The dashboard knows its org (?host=): read that org's session cookie directly. Chrome hides
    // the URL of our own dashboard tab (no "tabs" permission), and the org's browser tab is often
    // on another host name (*.lightning.force.com), so a tab search cannot be relied on.
    if (targetHost && await connectToHost(targetHost)) {
      return;
    }

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
      updateConnectionStatus(false, `Not connected to ${targetHost}. Log in to this org in a browser tab or generate an access token, then refresh.`);
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

// Connects to the given org host: its browser session if there is one, else its OAuth token
// (the API calls only need the token). Returns true when connected.
async function connectToHost(targetHost) {
  let session = null;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SESSION', sfHost: targetHost });
    if (response && response.success && response.data) session = response.data;
  } catch (error) {
    // Fall through to the token check
  }

  if (!session) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_USER_INFO', sfHost: targetHost });
      if (response && response.success && response.data && response.data.orgId) {
        // Token only: no session cookie (Incognito Login needs one)
        session = { hostname: targetHost, orgId: response.data.orgId.substring(0, 15), tokenOnly: true };
      }
    } catch (error) {
      // No token either
    }
  }

  if (!session) return false;
  if (!session.orgName) session.orgName = session.hostname || targetHost;

  sfHost = targetHost;
  currentSession = session;
  loadReadLogsFromStorage(); // Load read logs for this org
  loadClearedLogsFromStorage(); // Load cleared logs for this org
  cleanupExpiredLogs(); // Cleanup expired logs after loading
  updateConnectionStatus(true, `Connected to ${targetHost}`, session);
  return true;
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

    // Not connected: still offer Generate Token for this org (a token alone is enough to connect)
    if (getHostFromUrl()) setTimeout(checkOAuthTokenStatus, 500);
    
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
    // Check if OAuth token exists
    const targetHost = getHostFromUrl() || sfHost;
    const response = await chrome.runtime.sendMessage({
      type: 'CHECK_TOKEN_STATUS',
      sfHost: targetHost
    });
    
    const revokeBtn = elements.revokeTokenDashboardBtn;
    
    if (response && response.success && response.data) {
      if (!response.data.hasToken || response.data.isExpired) {
        // No token or expired - show warning (unless dismissed in this tab), hide revoke button.
        // A dismissed banner must not stop the Revoke button from following the token.
        if (!sessionStorage.getItem('oauth_warning_dismissed')) {
          showTokenWarning();
        }
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

      // Same steps as a page load with a token: Revoke button, current user and trace flag status
      await checkOAuthTokenStatus();
      await initializeDebugLogManager().catch(e => console.warn('Could not refresh debug log status:', e));

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
    showTokenError(error.message);
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

// Shows why login failed (for example "app must be installed") in the token banner
function showTokenError(message) {
  const subtitle = elements.devConsoleWarning?.querySelector('.warning-subtitle');
  if (subtitle) {
    subtitle.textContent = message;
    subtitle.classList.add('is-error');
  }
}

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
  const originalText = button?.innerHTML;
  
  try {
    if (button) {
      button.disabled = true;
      button.innerHTML = `${Icons.svg('loader')}Revoking...`;
    }
    
    const targetHost = getHostFromUrl() || sfHost;
    
    const response = await chrome.runtime.sendMessage({
      type: 'REVOKE_OAUTH_TOKEN',
      sfHost: targetHost
    });
    
    if (response && response.success) {
      // The token is gone here, but Salesforce may not have confirmed the revoke
      if (response.warning) showToast(response.warning, 6000);
      if (button) {
        button.innerHTML = `${Icons.svg('check')}Token revoked`;
        button.classList.add('deploy-success');
      }
      
      // Show warning banner and hide revoke button
      showTokenWarning();
      
      setTimeout(() => {
        if (button) {
          button.style.display = 'none';
          button.innerHTML = originalText;
          button.classList.remove('deploy-success');
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
    showToast(`Could not revoke the token: ${error.message}`, 5000);
    if (button) {
      button.innerHTML = `${Icons.svg('circleX')}Failed - try again`;
      setTimeout(() => {
        button.innerHTML = originalText;
        button.disabled = false;
      }, 2000);
    }
  }
}

// OAuth setup help (link in the token banner): callback URL and an optional own consumer key
function setupOAuthHelpModal() {
  const modal = document.getElementById('oauthHelpModal');
  const openBtn = document.getElementById('openOauthHelpBtn');
  if (!modal || !openBtn) return;

  const closeBtn = document.getElementById('closeOauthHelpBtn');
  const redirectEl = document.getElementById('oauthRedirectUri');
  const copyBtn = document.getElementById('copyOauthRedirectBtn');
  const input = document.getElementById('oauthClientIdInput');
  const saveBtn = document.getElementById('saveOauthClientIdBtn');
  const clearBtn = document.getElementById('clearOauthClientIdBtn');
  const statusEl = document.getElementById('oauthClientIdStatus');
  let lastFocused = null;

  const setStatus = (message, isError = false) => {
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', isError);
  };

  const showConfig = (config) => {
    redirectEl.textContent = config.redirectUri;
    input.value = config.usingCustomClientId ? config.clientId : '';
    clearBtn.disabled = !config.usingCustomClientId;
    setStatus(config.usingCustomClientId ? 'Using your own app.' : 'Using the default app.');
  };

  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeModal();
    }
  };

  const closeModal = () => {
    modal.style.display = 'none';
    document.removeEventListener('keydown', onKeydown, true);
    lastFocused?.focus?.();
  };

  const openModal = async () => {
    lastFocused = document.activeElement;
    modal.style.display = 'flex';
    document.addEventListener('keydown', onKeydown, true);
    closeBtn?.focus();
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_OAUTH_CONFIG' });
      if (!response || !response.success) throw new Error(response?.error || 'No response');
      showConfig(response.data);
    } catch (error) {
      setStatus(`Could not load the OAuth settings: ${error.message}`, true);
    }
  };

  const saveClientId = async (value) => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SET_OAUTH_CLIENT_ID', clientId: value });
      if (!response || !response.success) throw new Error(response?.error || 'No response');
      showConfig(response.data);
      if (response.data.usingCustomClientId) {
        setStatus('Saved. Click Generate Token to log in with your app.');
      }
    } catch (error) {
      setStatus(error.message, true);
    }
  };

  openBtn.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  saveBtn?.addEventListener('click', () => saveClientId(input.value));
  clearBtn?.addEventListener('click', () => saveClientId(''));
  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(redirectEl.textContent);
      setStatus('Callback URL copied.');
    } catch (error) {
      setStatus(`Could not copy: ${error.message}`, true);
    }
  });
}

document.addEventListener('DOMContentLoaded', setupOAuthHelpModal);