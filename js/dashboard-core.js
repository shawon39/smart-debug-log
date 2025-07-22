// Dashboard Core
// This file contains the main dashboard functionality, UI management, connection handling, and monitoring controls

// Global variables
let monitoringInterval = null;
let isMonitoring = false;
let currentSession = null;
let sfHost = null;
let debugLogs = [];
let selectedLogId = null;
let readLogs = new Set();
let currentRawResponse = null;

// Cache DOM elements
const elements = {
  connectionStatusText: document.getElementById('connectionStatusText'),
  monitoringStatusDot: document.getElementById('monitoringStatusDot'),
  monitoringStatusText: document.getElementById('monitoringStatusText'),
  orgActions: document.getElementById('orgActions'),
  copySessionBtn: document.getElementById('copySessionBtn'),
  openIncognitoBtn: document.getElementById('openIncognitoBtn'),
  deployPrettierBtn: document.getElementById('deployPrettierBtn'),
  autoRefreshToggle: document.getElementById('autoRefreshToggle'),
  devConsoleWarning: document.getElementById('devConsoleWarning'),
  openDevConsoleBtn: document.getElementById('openDevConsoleBtn'),
  dismissWarningBtn: document.getElementById('dismissWarningBtn'),
  pollInterval: document.getElementById('pollInterval'),
  logLimit: document.getElementById('logLimit'),
  startMonitoringBtn: document.getElementById('startMonitoringBtn'),
  stopMonitoringBtn: document.getElementById('stopMonitoringBtn'),
  refreshLogsBtn: document.getElementById('refreshLogsBtn'),
  markAllReadBtn: document.getElementById('markAllReadBtn'),
  monitoringStats: document.getElementById('monitoringStats'),
  totalLogsCount: document.getElementById('totalLogsCount'),
  lastPollTime: document.getElementById('lastPollTime'),
  pollIntervalStat: document.getElementById('pollIntervalStat'),
  logsLoading: document.getElementById('logsLoading'),
  emptyState: document.getElementById('emptyState'),
  logsList: document.getElementById('logsList'),
  welcomeState: document.getElementById('welcomeState'),
  limitsWelcomeState: document.getElementById('limitsWelcomeState'),
  debugContentPanel: document.getElementById('debugContentPanel'),
  selectedLogIdElement: document.getElementById('selectedLogId'),
  debugContent: document.getElementById('debugContent'),
  limitsContent: document.getElementById('limitsContent'),
  copyRawResponseBtn: document.getElementById('copyRawResponseBtn'),
  errorAndLimitsContent: document.getElementById('errorAndLimitsContent'),
  errorContent: document.getElementById('errorContent')
};

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Initialize theme first
  await initializeTheme();
  
  const targetHost = getHostFromUrl();
  const headerHost = document.getElementById('headerHost');
  if (headerHost && targetHost) {
    headerHost.textContent = `(${targetHost})`;
  }
  
  // Clear raw response and hide button initially
  clearRawResponse();
  
  // Load saved preferences
  await loadPreferences();
  
  // Ensure auto-refresh default is saved if not present
  await ensureAutoRefreshDefault();
  
  // Initialize stats display
  initializeStats();
  
  await checkConnectionStatus(targetHost);
  await loadDebugLogs();
  setupEventListeners();
  updatePollIntervalStat();
});

// Refresh dashboard when window gains focus (handles both tab switching and window focus)
const refreshDashboard = async () => {
  const targetHost = getHostFromUrl();
  await checkConnectionStatus(targetHost);
  if (currentSession && sfHost) {
    await loadDebugLogs();
  }
  setTimeout(checkDeveloperConsoleStatus, 300);
};

window.addEventListener('focus', () => {
  const autoRefreshEnabled = getAutoRefreshState();
  if (autoRefreshEnabled) {
    setTimeout(refreshDashboard, 100);
  }
});

// Helper function to get auto-refresh state
function getAutoRefreshState() {
  const toggle = document.getElementById('autoRefreshToggle');
  if (!toggle) {
    return true; // Default to enabled if element not found
  }
  return toggle.checked;
}

// Setup event listeners
function setupEventListeners() {
  const { startMonitoringBtn, stopMonitoringBtn, refreshLogsBtn, markAllReadBtn, copySessionBtn, 
          openIncognitoBtn, openDevConsoleBtn, dismissWarningBtn, pollInterval, logLimit, copyRawResponseBtn } = elements;
  
  // Setup theme toggle
  const themeToggle = document.getElementById('themeToggleDashboard');
  if (themeToggle) {
    setupThemeToggle(themeToggle);
  }
  
  startMonitoringBtn?.addEventListener('click', startMonitoring);
  stopMonitoringBtn?.addEventListener('click', stopMonitoring);
  refreshLogsBtn?.addEventListener('click', refreshDashboard);
  markAllReadBtn?.addEventListener('click', markAllLogsAsRead);
  
  document.getElementById('closeDashboardBtn')?.addEventListener('click', () => window.close());
  
  copySessionBtn?.addEventListener('click', copySessionUrl);
  openIncognitoBtn?.addEventListener('click', openInIncognito);
  deployPrettierBtn?.addEventListener('click', deployPrettierClass);
  openDevConsoleBtn?.addEventListener('click', openDeveloperConsole);
  dismissWarningBtn?.addEventListener('click', dismissDevConsoleWarning);
  copyRawResponseBtn?.addEventListener('click', copyRawResponse);
  
  pollInterval?.addEventListener('change', async () => {
    updatePollIntervalStat();
    savePreferences();
    if (isMonitoring) await restartMonitoring();
  });
  
  logLimit?.addEventListener('change', async () => {
    savePreferences();
    if (isMonitoring) await restartMonitoring();
    loadDebugLogs();
  });
  
  // Auto refresh toggle event listener
  const autoRefreshToggle = document.getElementById('autoRefreshToggle');
  if (autoRefreshToggle) {
    autoRefreshToggle.addEventListener('change', async () => {
      await savePreferences();
    });
  }
}

function updatePollIntervalStat() {
  const { pollInterval, pollIntervalStat } = elements;
  if (!pollInterval || !pollIntervalStat) return;
  const interval = parseInt(pollInterval.value);
  pollIntervalStat.textContent = interval >= 60 ? `${interval/60}m` : `${interval}s`;
}



// Ensure auto-refresh default value is saved
async function ensureAutoRefreshDefault() {
  try {
    const result = await chrome.storage.local.get(['autoRefresh']);
    
    if (result.autoRefresh === undefined) {
      await chrome.storage.local.set({ autoRefresh: true });
    }
  } catch (error) {
    // Silent error handling
  }
}

// Preference management
async function loadPreferences() {
  try {
    const result = await chrome.storage.local.get(['pollInterval', 'logLimit', 'autoRefresh']);
    
    if (result.pollInterval && elements.pollInterval) {
      elements.pollInterval.value = result.pollInterval;
    }
    
    if (result.logLimit && elements.logLimit) {
      elements.logLimit.value = result.logLimit;
    }
    
    // Load auto-refresh preference (default to true)
    const autoRefreshToggle = document.getElementById('autoRefreshToggle');
    if (autoRefreshToggle) {
      const autoRefreshValue = result.autoRefresh !== undefined ? result.autoRefresh : true;
      autoRefreshToggle.checked = autoRefreshValue;
    }
  } catch (error) {
    // Silent error handling
  }
}

async function savePreferences() {
  try {
    const preferences = {};
    
    if (elements.pollInterval) {
      preferences.pollInterval = elements.pollInterval.value;
    }
    
    if (elements.logLimit) {
      preferences.logLimit = elements.logLimit.value;
    }
    
    const autoRefreshToggle = document.getElementById('autoRefreshToggle');
    if (autoRefreshToggle) {
      preferences.autoRefresh = autoRefreshToggle.checked;
    }
    
    await chrome.storage.local.set(preferences);
  } catch (error) {
    // Silent error handling
  }
}

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

// Monitoring status management
function updateMonitoringStatus(monitoring, statusText = '') {
  const { monitoringStatusDot, monitoringStatusText, startMonitoringBtn, stopMonitoringBtn, monitoringStats } = elements;
  if (!monitoringStatusDot || !monitoringStatusText) return;
  
  isMonitoring = monitoring;
  
  if (monitoring) {
    monitoringStatusDot.classList.add('monitoring');
    monitoringStatusText.textContent = statusText || 'Active';
    
    startMonitoringBtn?.classList.add('hidden');
    stopMonitoringBtn?.classList.remove('hidden');
    monitoringStats?.classList.remove('hidden');
  } else {
    monitoringStatusDot.classList.remove('monitoring');
    monitoringStatusText.textContent = statusText || 'Stopped';
    
    startMonitoringBtn?.classList.remove('hidden');
    stopMonitoringBtn?.classList.add('hidden');
    monitoringStats?.classList.add('hidden');
  }
}

// Monitoring controls
async function startMonitoring() {
  if (!currentSession) {
    await checkConnectionStatus();
    if (!currentSession) {
      alert('Please ensure you are logged into Salesforce and try again.');
      return;
    }
  }
  
  updateMonitoringStatus(true, 'Starting...');
  await loadDebugLogs();
  
  // Use background service worker for monitoring
  try {
    const orgId = currentSession.orgId || sfHost;
    const options = {
      pollInterval: parseInt(elements.pollInterval.value),
      logLimit: parseInt(elements.logLimit.value),
      notifyOnNew: true,
      autoDownload: false
    };
    
    const result = await chrome.runtime.sendMessage({
      type: 'START_DEBUG_MONITORING',
      orgId: orgId,
      session: currentSession,
      options: options
    });
    
    if (result.success) {
      updateMonitoringStatus(true, 'Active');
      
      // Set up interval for UI updates
      const uiUpdateInterval = Math.max(parseInt(elements.pollInterval.value) * 1000, 5000);
      monitoringInterval = setInterval(loadDebugLogs, uiUpdateInterval);
    } else {
      updateMonitoringStatus(false, 'Failed to start');
    }
  } catch (error) {
    updateMonitoringStatus(false, 'Error');
  }
}

async function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  
  // Stop background monitoring
  try {
    const orgId = currentSession?.orgId || sfHost;
    if (orgId) {
      await chrome.runtime.sendMessage({
        type: 'STOP_DEBUG_MONITORING',
        orgId: orgId
      });
    }
  } catch (error) {

  }
  
  updateMonitoringStatus(false, 'Stopped');
}

async function restartMonitoring() {
  if (isMonitoring) {
    await stopMonitoring();
    setTimeout(startMonitoring, 100);
  }
}

// Session management functions
async function copySessionUrl() {
  if (!currentSession || !sfHost) return;
  
  const sessionId = currentSession.key || currentSession.sessionId;
  if (!sessionId) return;
  
  const sessionUrl = `https://${sfHost}/secur/frontdoor.jsp?sid=${sessionId}`;
  
  try {
    await navigator.clipboard.writeText(sessionUrl);
    
    const { copySessionBtn } = elements;
    const originalText = copySessionBtn.innerHTML;
    copySessionBtn.innerHTML = 'Copied';
    copySessionBtn.disabled = true;
    
    setTimeout(() => {
      copySessionBtn.innerHTML = originalText;
      copySessionBtn.disabled = false;
    }, 2000);
    
  } catch (error) {
    alert(`Session URL: ${sessionUrl}`);
  }
}

async function openInIncognito() {
  if (!currentSession || !sfHost) return;
  
  const sessionId = currentSession.key || currentSession.sessionId;
  if (!sessionId) return;
  
  const orgUrl = `https://${sfHost}/secur/frontdoor.jsp?sid=${sessionId}`;
  
  try {
    await chrome.windows.create({
      url: orgUrl,
      incognito: true,
      focused: true
    });
  } catch (error) {
    try {
      await chrome.tabs.create({
        url: orgUrl,
        active: true
      });
    } catch (fallbackError) {
      // Failed
    }
  }
}

// Custom modal dialog for code deployment
function showCodeDeployDialog(description) {
  return new Promise((resolve) => {
    // Create modal elements
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'modal-content';
    
    const content = document.createElement('div');
    content.className = 'modal-text';
    
    // Format the description with proper code styling
    const formattedDescription = description
      .replace(/List<\w+>\s+\w+\s*=\s*\[SELECT[^\]]+\];/g, (match) => {
        const escapedMatch = match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<code class="code-block">${escapedMatch}</code>`;
      })
      .replace(/Console\.log\([^)]+\);/g, `<code class="code-inline">$&</code>`)
      .replace(/Deploy to org: (.+)$/m, `<div class="deploy-info-block"><strong>Deploy to org:</strong> $1</div>`)
      .replace(/\n/g, '<br>');
    
    content.innerHTML = `
      <h3 class="modal-title">Deploy Console Class</h3>
      <div class="modal-description">${formattedDescription}</div>
      <div class="modal-actions">
        <button id="deployConfirm" class="modal-button-primary">Deploy to Org</button>
        <button id="deployCancel" class="modal-button-secondary">Cancel</button>
      </div>
    `;
    
    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Add event listeners
    document.getElementById('deployConfirm').addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(true);
    });
    
    document.getElementById('deployCancel').addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(false);
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        resolve(false);
      }
    });
  });
}

async function deployPrettierClass() {
  if (!currentSession || !sfHost) {
    alert('No active Salesforce session found. Please ensure you are logged into Salesforce.');
    return;
  }

  // Pre-deployment validation
  // Check if we're in a sandbox environment
  const isSandbox = sfHost.includes('sandbox') || sfHost.includes('develop') || sfHost.includes('scratch');
  
  // Validate session has required properties
  if (!currentSession.sessionId && !currentSession.key) {
    alert('❌ Invalid session: No authentication token found. Please refresh Salesforce and try again.');
    return;
  }

  const className = 'Console';
  const classBody = `public with sharing class Console {
    public static void log(Object obj) {
        System.debug(JSON.serializePretty(obj));
    }
    
    public static void log(String label, Object obj) {
        System.debug(label);
        System.debug(JSON.serializePretty(obj));
    }
}`;

  const classDescription = `📋 Console Utility Class

Ready to use enhanced debug logging for your Salesforce development.

⚡ Code Example:
List<Account> accountList = [SELECT Id, Name, Industry, Type FROM Account LIMIT 5];

⚡ Usage Examples:
Console.log(accountList);
Console.log('Account Results', accountList);

Deploy to org: ${sfHost}`;

  // Show confirmation dialog with better formatting
  const confirmed = await showCodeDeployDialog(classDescription);
  if (!confirmed) {
    return;
  }

  // Update button state
  const { deployPrettierBtn } = elements;
  const originalText = deployPrettierBtn.innerHTML;
  deployPrettierBtn.innerHTML = 'Deploying...';
  deployPrettierBtn.disabled = true;

  try {
    // Prepare the class data for deployment
    const classData = {
      Name: className,
      Body: classBody
    };

    // Deploy using the Tooling API
    const result = await chrome.runtime.sendMessage({
      type: 'TOOLING_CREATE',
      sobjectType: 'ApexClass',
      data: classData,
      session: currentSession
    });

    if (result.success) {
      alert('✅ Class is deployed');
      
      // Update button to show success
      deployPrettierBtn.innerHTML = 'Deployed ✓';
      deployPrettierBtn.style.backgroundColor = '#28a745';
      
      setTimeout(() => {
        deployPrettierBtn.innerHTML = originalText;
        deployPrettierBtn.style.backgroundColor = '';
        deployPrettierBtn.disabled = false;
      }, 3000);
    } else {
      throw new Error(result.error || 'Unknown deployment error');
    }
  } catch (error) {
    console.error('Deployment error:', error);
    
    let errorMessage = '⚠️ Console class already exists in your org.';
    
    alert(errorMessage);
    
    // Reset button state
    deployPrettierBtn.innerHTML = originalText;
    deployPrettierBtn.disabled = false;
  }
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

function dismissSessionHelp() {
  const controlsBar = document.querySelector('.controls-bar');
  const existingHelpPanel = controlsBar?.querySelector('.session-help-panel');
  existingHelpPanel?.remove();
}

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

// Clear raw response function
function clearRawResponse() {
  currentRawResponse = null;
  const { copyRawResponseBtn } = elements;
  copyRawResponseBtn?.classList.add('hidden');
}

// Copy raw response function
async function copyRawResponse() {
  if (!currentRawResponse) return;
  
  try {
    await navigator.clipboard.writeText(currentRawResponse);
    
    const { copyRawResponseBtn } = elements;
    const originalText = copyRawResponseBtn.innerHTML;
    copyRawResponseBtn.innerHTML = 'Copied';
    copyRawResponseBtn.disabled = true;
    
    setTimeout(() => {
      copyRawResponseBtn.innerHTML = originalText;
      copyRawResponseBtn.disabled = false;
    }, 2000);
    
  } catch (error) {
    // Fallback: show alert with the content
    alert('Raw Response:\n\n' + currentRawResponse);
  }
}

// Mark all logs as read
function markAllLogsAsRead() {
  if (!debugLogs || debugLogs.length === 0) {
    return;
  }
  
  // Mark all logs as read
  debugLogs.forEach(log => {
    markLogAsRead(log.Id);
  });
  
  // Remove all unread indicators from the UI
  document.querySelectorAll('.unread-indicator').forEach(indicator => {
    indicator.remove();
  });
  
  // Show a brief confirmation message
  const { markAllReadBtn } = elements;
  if (markAllReadBtn) {
    const originalText = markAllReadBtn.textContent;
    markAllReadBtn.textContent = 'Marked as Read ✓';
    markAllReadBtn.style.color = '#ffffff';
    
    setTimeout(() => {
      markAllReadBtn.textContent = originalText;
      markAllReadBtn.style.color = '';
    }, 2000);
  }
}

// Cleanup on window unload
window.addEventListener('beforeunload', () => {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
}); 

