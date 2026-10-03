// Dashboard Initialization and Setup
// This file handles initial setup, event listeners, and DOM management

// Global variables
let currentSession = null;
let sfHost = null;
let currentRawResponse = null;

// DOM elements will be cached after DOM is loaded
let elements = {};

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
  await new Promise(resolve => setTimeout(resolve, 100));

  // Cache DOM elements after DOM is loaded
  cacheElements();

  // Initialize theme first
  await initializeTheme();

  // Initialize view preference
  await initializeViewPreference();

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

  // Check OAuth token status and show warning if needed
  await checkAndShowTokenWarning(targetHost);

  await loadDebugLogs();

  // Initialize log search functionality
  if (logRenderer && typeof logRenderer.initializeSearch === 'function') {
    logRenderer.initializeSearch();
  }

  // Check if trace flag was just created (from popup)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('traceFlagCreated') === 'true') {
    const logTypeFilter = document.getElementById('logTypeFilter');
    if (logTypeFilter) {
      logTypeFilter.value = 'Monitoring';
      await savePreferences();
    }
  }

  setupEventListeners();

  // Setup Manager modals
  if (window.apexCodeManager) {
    window.apexCodeManager.setupModalEventListeners();
  }

  if (window.debugLogManagerUI) {
    window.debugLogManagerUI.setupModalEventListeners();
  }

  // Initialize Apex Manager
  await initializeApexManager();

  // Initialize Debug Log Manager
  await initializeDebugLogManager();
});

// Refresh status indicator when dashboard becomes visible
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && window.debugLogManagerUI && window.debugLogManagerUI.userId) {
    await window.debugLogManagerUI.refreshStatusIndicator();
  }
});

// Cache DOM elements function
function cacheElements() {
  elements = {
    connectionStatusText: document.getElementById('connectionStatusText'),
    orgActions: document.getElementById('orgActions'),
    copySessionBtn: document.getElementById('copySessionBtn'),
    openIncognitoBtn: document.getElementById('openIncognitoBtn'),
    deployPrettierBtn: document.getElementById('deployPrettierBtn'),
    autoRefreshToggle: document.getElementById('autoRefreshToggle'),
    devConsoleWarning: document.getElementById('devConsoleWarning'),
    openDevConsoleBtn: document.getElementById('openDevConsoleBtn'),
    dismissWarningBtn: document.getElementById('dismissWarningBtn'),
    revokeTokenDashboardBtn: document.getElementById('revokeTokenDashboardBtn'),
    logLimit: document.getElementById('logLimit'),
    refreshLogsBtn: document.getElementById('refreshLogsBtn'),
    clearLogsBtn: document.getElementById('clearLogsBtn'),
    markAllReadBtn: document.getElementById('markAllReadBtn'),
    logsLoading: document.getElementById('logsLoading'),
    emptyState: document.getElementById('emptyState'),
    logsList: document.getElementById('logsList'),
    welcomeState: document.getElementById('welcomeState'),
    limitsWelcomeState: document.getElementById('limitsWelcomeState'),
    debugContentPanel: document.getElementById('debugContentPanel'),
    selectedLogIdElement: document.getElementById('selectedLogId'),
    debugContent: document.getElementById('debugContent'),
    limitsContent: document.getElementById('limitsContent'),
    toggleViewBtn: document.getElementById('toggleViewBtn'),
    copyRawBtn: document.getElementById('copyRawBtn'),
    rawSearchContainer: document.getElementById('rawSearchContainer'),
    rawSearchInput: document.getElementById('rawSearchInput'),
    searchResultsInfo: document.getElementById('searchResultsInfo'),
    searchPrevBtn: document.getElementById('searchPrevBtn'),
    searchNextBtn: document.getElementById('searchNextBtn'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    errorAndLimitsContent: document.getElementById('errorAndLimitsContent'),
    errorContent: document.getElementById('errorContent'),
    openDebugLogsBtn: document.getElementById('openDebugLogsBtn'),
    debugLogManagerBtn: document.getElementById('debugLogManagerBtn'),
    logTypeFilter: document.getElementById('logTypeFilter'),
    openApexManagerBtn: document.getElementById('openApexManagerBtn'),
    // Apex Manager elements
    runApexBtn: document.getElementById('runApexBtn'),
    saveApexBtn: document.getElementById('saveApexBtn'),
    addCodeBlockBtn: document.getElementById('addCodeBlockBtn'),
    apexCodeEditor: document.getElementById('apexCodeEditor'),
    apexCodeList: document.getElementById('apexCodeList')
  };
}

// Setup event listeners
function setupEventListeners() {
  const { refreshLogsBtn, clearLogsBtn, markAllReadBtn, copySessionBtn,
    openIncognitoBtn, openDevConsoleBtn, dismissWarningBtn, revokeTokenDashboardBtn, logLimit, toggleViewBtn, copyRawBtn,
    openDebugLogsBtn, debugLogManagerBtn, openApexManagerBtn, logTypeFilter } = elements;

  // Setup theme toggle
  const themeToggle = document.getElementById('themeToggleDashboard');
  if (themeToggle) {
    setupThemeToggle(themeToggle);
  }

  refreshLogsBtn?.addEventListener('click', refreshDashboard);
  clearLogsBtn?.addEventListener('click', clearAllLogs);
  markAllReadBtn?.addEventListener('click', markAllLogsAsRead);

  document.getElementById('closeDashboardBtn')?.addEventListener('click', () => window.close());

  copySessionBtn?.addEventListener('click', copySessionUrl);
  openIncognitoBtn?.addEventListener('click', openInIncognito);
  deployPrettierBtn?.addEventListener('click', deployPrettierClass);
  openDevConsoleBtn?.addEventListener('click', openDeveloperConsole);
  dismissWarningBtn?.addEventListener('click', dismissDevConsoleWarning);
  revokeTokenDashboardBtn?.addEventListener('click', revokeAccessTokenDashboard);
  toggleViewBtn?.addEventListener('click', toggleDebugView);
  copyRawBtn?.addEventListener('click', copyRawResponse);

  // Debug logs buttons event listeners
  openDebugLogsBtn?.addEventListener('click', openDebugLogsSetup);
  openApexManagerBtn?.addEventListener('click', () => {
    if (window.apexCodeManager) {
      window.apexCodeManager.openModal();
    }
  });
  debugLogManagerBtn?.addEventListener('click', () => {
    if (window.debugLogManagerUI) {
      window.debugLogManagerUI.openModal();
    }
  });

  logLimit?.addEventListener('change', async () => {
    savePreferences();
    await loadDebugLogs();
  });

  logTypeFilter?.addEventListener('change', async () => {
    savePreferences();
    // Clear cache when log type changes to prevent mixing logs
    if (typeof logLoader?.clearCache === 'function') {
      logLoader.clearCache();
    }
    await loadDebugLogs();
  });

  // Auto refresh toggle event listener
  const autoRefreshToggle = document.getElementById('autoRefreshToggle');
  if (autoRefreshToggle) {
    autoRefreshToggle.addEventListener('change', async () => {
      await savePreferences();
    });
  }



  // Apex Manager event listeners
  setupApexManagerEventListeners();
}

// Setup Apex Manager Event Listeners
function setupApexManagerEventListeners() {
  const { runApexBtn, saveApexBtn, addCodeBlockBtn } = elements;

  runApexBtn?.addEventListener('click', handleRunApex);
  saveApexBtn?.addEventListener('click', handleSaveApex);
  addCodeBlockBtn?.addEventListener('click', handleAddCodeBlock);

  // Export / import saved Apex snippets (backup / share / move between browsers).
  const importFile = document.getElementById('importApexFile');
  document.getElementById('exportApexBtn')?.addEventListener('click', () => window.apexCodeManager?.exportApexCodes());
  document.getElementById('importApexBtn')?.addEventListener('click', () => importFile?.click());
  importFile?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) window.apexCodeManager?.importApexCodes(file);
    e.target.value = ''; // reset so the same file can be re-imported
  });
}


// Initialize Apex Manager
async function initializeApexManager() {
  if (window.apexCodeManager) {
    await window.apexCodeManager.initialize(await resolveApexOrgId());
  }
}

// Snippets are saved per org. Use the org of this host's OAuth token (execution uses it too),
// else the browser session's org. Storage keys both by the same 15-character org ID.
async function resolveApexOrgId() {
  const host = getHostFromUrl();
  if (host) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_USER_INFO', sfHost: host });
      if (response?.success && response.data?.orgId) return response.data.orgId;
    } catch (error) {
      console.warn('Could not read the org ID from the access token:', error);
    }
  }
  return currentSession?.orgId || null;
}

// Initialize Debug Log Manager (it works with the OAuth token, so no browser session is needed)
async function initializeDebugLogManager() {
  if (window.debugLogManagerUI) {
    await window.debugLogManagerUI.initialize(currentSession);
    // Refresh status indicator after initialization
    await window.debugLogManagerUI.refreshStatusIndicator();
  }
}

// Check OAuth token status and show warning if needed
async function checkAndShowTokenWarning(targetHost) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CHECK_TOKEN_STATUS',
      sfHost: targetHost
    });

    const warningBanner = document.getElementById('noTokenWarning');
    const generateBtn = document.getElementById('generateTokenFromWarning');

    if (!warningBanner) return;

    if (response && response.success && response.data) {
      if (!response.data.hasToken || response.data.isExpired) {
        // Show warning
        warningBanner.style.display = 'flex';

        // Setup generate token button click handler
        if (generateBtn) {
          generateBtn.onclick = async () => {
            generateBtn.disabled = true;
            generateBtn.textContent = 'Generating...';

            try {
              await generateAccessToken();
              // Hide warning on success
              warningBanner.style.display = 'none';
            } catch (error) {
              console.error('Failed to generate token:', error);
              generateBtn.textContent = 'Retry';
            } finally {
              generateBtn.disabled = false;
            }
          };
        }
      } else {
        // Token exists and is valid - hide warning
        warningBanner.style.display = 'none';
      }
    }
  } catch (error) {
    console.warn('Could not check token status:', error);
  }
}

// Apex Manager Event Handlers
let apexRunInProgress = false;

async function handleRunApex() {
  if (!window.apexExecutor || !window.apexCodeManager) {
    alert('Apex execution components not loaded');
    return;
  }

  const code = window.apexCodeManager.getCurrentCode();
  if (!code || !code.trim()) {
    alert('No Apex code to execute');
    return;
  }

  // Execution uses the OAuth token of this dashboard's org, so no browser session is needed.
  if (apexRunInProgress) return;
  apexRunInProgress = true;
  let runStart = 0, succeeded = false;

  try {
    // Make sure debug logging is on, so the run creates a log. A failure here does not stop the run.
    await ensureTraceFlagForApexRun();

    runStart = Date.now();
    const result = await window.apexExecutor.executeApexCode(code);
    succeeded = !!(result && result.success);

    // Only close the modal if execution was successful
    if (succeeded) {
      window.apexCodeManager.closeModal();
    } else if (typeof loadDebugLogs === 'function') {
      // Keep the modal open to show the error; refresh logs so the failed run's log appears
      await loadDebugLogs();
    }

  } catch (error) {
    console.error('Apex execution failed:', error);
    // Don't close modal on error - let user see the execution results
    // Remove the alert and let the execution results display handle error messaging
    // Still refresh logs so latest attempts (and any partial logs) appear
    try {
      if (typeof loadDebugLogs === 'function') {
        await loadDebugLogs();
      } else if (typeof refreshDashboard === 'function') {
        await refreshDashboard();
      }
    } catch (e) {
      // ignore refresh errors
    }
  } finally {
    apexRunInProgress = false;
  }

  // Show the run's log (this can take a few seconds, so it is outside the run guard)
  if (succeeded) await showLogForApexRun(runStart);
}

// Turns on a trace flag for the current user when none is active (not forced).
// On failure, shows a short note and lets the run continue.
async function ensureTraceFlagForApexRun() {
  let error = null;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'ENSURE_TRACE_FLAG', sfHost: getHostFromUrl() });
    if (response && response.success) {
      window.debugLogManagerUI?.refreshStatusIndicator();
      return;
    }
    error = response?.error || 'Unknown error';
  } catch (e) {
    error = e.message;
  }
  showToast(`Debug logging could not be turned on (${error}). The code will still run, but it may not create a log.`, 6000);
}

// After a successful run, refresh the logs and select the run's log: the newest
// executeAnonymous log that started at or after the run. New logs can take a few seconds to show up.
async function showLogForApexRun(runStart) {
  const since = Math.floor(runStart / 1000) * 1000 - 1000; // StartTime has whole seconds; allow 1 s clock difference
  const userId = window.debugLogManagerUI?.userId;
  const findRunLog = () => debugLogs
    .filter(log => /executeAnonymous/i.test(log.Operation || '')
      && new Date(log.StartTime).getTime() >= since
      && (!userId || log.LogUserId === userId))
    .sort((a, b) => new Date(b.StartTime) - new Date(a.StartTime))[0];

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 2000));
    await loadDebugLogs();
    const log = findRunLog();
    if (log) {
      selectDebugLog(log.Id);
      return;
    }
    // Logs from this run are Monitoring logs: switch the log type filter if it hides them.
    const filter = document.getElementById('logTypeFilter');
    if (filter && filter.value !== 'Monitoring') {
      filter.value = 'Monitoring';
      await savePreferences();
      logLoader.clearCache();
    }
  }
  showToast('Run finished. The log can take a few seconds to appear.');
}

async function handleSaveApex() {
  if (!window.apexCodeManager) {
    alert('Apex manager not loaded');
    return;
  }

  const code = window.apexCodeManager.getCurrentCode();
  if (!code || !code.trim()) {
    alert('No Apex code to save');
    return;
  }

  // Decide the wording before saving: a first save selects the new snippet.
  const isUpdate = !!window.apexCodeManager.currentSelectedCode?.id;
  try {
    await window.apexCodeManager.saveOrUpdateCurrentCode();
    showToast(isUpdate ? 'Apex code updated successfully!' : 'Apex code saved successfully!');
  } catch (error) {
    alert('Failed to save Apex code: ' + error.message);
  }
}

function handleAddCodeBlock() {
  if (window.apexCodeManager) {
    window.apexCodeManager.addNewCodeBlock();
  }
}



// Toast notification function
function showToast(message, duration = 3000) {
  // Remove any existing toast
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) {
    existingToast.remove();
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = message;

  // Add to document
  document.body.appendChild(toast);

  // Show toast
  setTimeout(() => toast.classList.add('show'), 100);

  // Hide and remove toast
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Listen for log deletion broadcasts from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handledTypes = ['LOGS_DELETED', 'CLEAR_ALL_LOGS_CACHE_BROADCAST'];

  if (!handledTypes.includes(request.type)) {
    return false; // Don't handle other message types
  }

  if (request.type === 'LOGS_DELETED' && request.logIds && request.logIds.length > 0) {

    // Remove from localStorage cache
    try {
      const logIdSet = new Set(request.logIds);

      // Clean all localStorage caches for this org
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cachedLogs_')) {
          try {
            const cached = localStorage.getItem(key);
            if (cached) {
              const logs = JSON.parse(cached);
              const filteredLogs = logs.filter(log => !logIdSet.has(log.Id));

              if (filteredLogs.length !== logs.length) {
                localStorage.setItem(key, JSON.stringify(filteredLogs));
              }
            }
          } catch (parseError) {
            // Invalid cache entry, skip
          }
        }
      }

      // If logs are currently displayed, remove them from view
      if (typeof debugLogs !== 'undefined' && Array.isArray(debugLogs)) {
        const originalLength = debugLogs.length;
        debugLogs = debugLogs.filter(log => !logIdSet.has(log.Id));

        if (debugLogs.length !== originalLength) {
          // Re-render the log list
          if (typeof logRenderer !== 'undefined' && logRenderer.renderLogsList) {
            logRenderer.renderLogsList(debugLogs);
          }

          // Update stats
          if (typeof updateStats === 'function') {
            updateStats();
          }
        }
      }

    } catch (error) {
      console.error('Failed to handle LOGS_DELETED:', error);
    }
  }

  // Handle clear all logs cache broadcast
  if (request.type === 'CLEAR_ALL_LOGS_CACHE_BROADCAST') {

    try {
      // Clear all localStorage caches
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('cachedLogs_') || key.startsWith('lastFetchTime_'))) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => localStorage.removeItem(key));

      // Reload logs to show empty state
      if (typeof loadDebugLogs === 'function') {
        loadDebugLogs();
      }

    } catch (error) {
      console.error('Failed to handle CLEAR_ALL_LOGS_CACHE_BROADCAST:', error);
    }
  }

  sendResponse({ success: true });
  return true;
});