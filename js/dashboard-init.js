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
  if (window.apexCodeManager && currentSession) {
    const orgId = currentSession.orgId || 'unknown';
    await window.apexCodeManager.initialize(orgId);
  }
}

// Initialize Debug Log Manager
async function initializeDebugLogManager() {
  if (window.debugLogManagerUI && currentSession) {
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

  if (!currentSession) {
    alert('No Salesforce session available');
    return;
  }

  try {
    // Create session data with instanceUrl for apex execution
    const sessionForApex = {
      ...currentSession,
      instanceUrl: currentSession.instanceUrl || `https://${currentSession.domain || currentSession.hostname || sfHost}`
    };

    const result = await window.apexExecutor.executeApexCode(code, sessionForApex);

    // Refresh logs regardless of success so user can see new/related logs
    if (typeof loadDebugLogs === 'function') {
      await loadDebugLogs();
    } else if (typeof refreshDashboard === 'function') {
      await refreshDashboard();
    }

    // Only close the modal if execution was successful
    if (result && result.success) {
      if (window.apexCodeManager) {
        window.apexCodeManager.closeModal();
      }
    }
    // If execution failed but didn't throw an error, keep modal open to show results

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
  }
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

  // Use the new save or update logic
  const success = await window.apexCodeManager.saveOrUpdateCurrentCode();
  if (success) {
    const isUpdate = window.apexCodeManager.currentSelectedCode?.id;
    const message = isUpdate ? 'Apex code updated successfully!' : 'Apex code saved successfully!';
    showToast(message);
  } else {
    alert('Failed to save Apex code');
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