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
  
  // Setup Apex Manager modal
  if (window.apexCodeManager) {
    window.apexCodeManager.setupModalEventListeners();
  }
  
  // Setup Debug Log Manager modal
  if (window.debugLogManagerUI) {
    window.debugLogManagerUI.setupModalEventListeners();
  }
  
  setupEventListeners();
  
  // Setup Apex Manager modal
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
          openDebugLogsBtn, debugLogManagerBtn, logTypeFilter } = elements;
  
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

// Show no-token warning banner (different from dev console warning)
function showNoTokenWarning() {
  const warningBanner = document.getElementById('noTokenWarning');
  if (warningBanner) {
    warningBanner.style.display = 'flex';
  }
}

// Hide no-token warning banner
function hideNoTokenWarning() {
  const warningBanner = document.getElementById('noTokenWarning');
  if (warningBanner) {
    warningBanner.style.display = 'none';
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
    const isUpdate = window.apexCodeManager.getCurrentSelectedCode()?.id;
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