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
  copyRawResponseBtn: document.getElementById('copyRawResponseBtn')
};

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const targetHost = getHostFromUrl();
  const headerHost = document.getElementById('headerHost');
  if (headerHost && targetHost) {
    headerHost.textContent = `(${targetHost})`;
  }
  
  // Clear raw response and hide button initially
  clearRawResponse();
  
  await checkConnectionStatus(targetHost);
  await loadDebugLogs();
  setupEventListeners();
  updatePollIntervalStat();
});

// Refresh dashboard when window becomes visible or focused
const refreshDashboard = async () => {
  const targetHost = getHostFromUrl();
  await checkConnectionStatus(targetHost);
  if (currentSession && sfHost) {
    await loadDebugLogs();
  }
  setTimeout(checkDeveloperConsoleStatus, 300);
};

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) setTimeout(refreshDashboard, 100);
});

window.addEventListener('focus', () => {
  setTimeout(refreshDashboard, 100);
});

// Setup event listeners
function setupEventListeners() {
  const { startMonitoringBtn, stopMonitoringBtn, refreshLogsBtn, markAllReadBtn, copySessionBtn, 
          openIncognitoBtn, openDevConsoleBtn, dismissWarningBtn, pollInterval, logLimit, copyRawResponseBtn } = elements;
  
  startMonitoringBtn?.addEventListener('click', startMonitoring);
  stopMonitoringBtn?.addEventListener('click', stopMonitoring);
  refreshLogsBtn?.addEventListener('click', refreshDashboard);
  markAllReadBtn?.addEventListener('click', markAllLogsAsRead);
  
  document.getElementById('closeDashboardBtn')?.addEventListener('click', () => window.close());
  
  copySessionBtn?.addEventListener('click', copySessionUrl);
  openIncognitoBtn?.addEventListener('click', openInIncognito);
  openDevConsoleBtn?.addEventListener('click', openDeveloperConsole);
  dismissWarningBtn?.addEventListener('click', dismissDevConsoleWarning);
  copyRawResponseBtn?.addEventListener('click', copyRawResponse);
  
  pollInterval?.addEventListener('change', () => {
    updatePollIntervalStat();
    if (isMonitoring) restartMonitoring();
  });
  
  logLimit?.addEventListener('change', loadDebugLogs);
}

function updatePollIntervalStat() {
  const { pollInterval, pollIntervalStat } = elements;
  if (!pollInterval || !pollIntervalStat) return;
  const interval = parseInt(pollInterval.value);
  pollIntervalStat.textContent = interval >= 60 ? `${interval/60}m` : `${interval}s`;
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
  
  const interval = parseInt(elements.pollInterval.value) * 1000;
  monitoringInterval = setInterval(loadDebugLogs, interval);
  
  updateMonitoringStatus(true, 'Active');
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  
  updateMonitoringStatus(false, 'Stopped');
}

function restartMonitoring() {
  if (isMonitoring) {
    stopMonitoring();
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