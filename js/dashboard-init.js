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
  
  // Setup Apex Manager modal
  if (window.apexCodeManager) {
    window.apexCodeManager.setupModalEventListeners();
  }
  
  updatePollIntervalStat();
  
  // Initialize Apex Manager
  await initializeApexManager();
});

// Cache DOM elements function
function cacheElements() {
  elements = {
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
    clearLogsBtn: document.getElementById('clearLogsBtn'),
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
  const { startMonitoringBtn, stopMonitoringBtn, refreshLogsBtn, clearLogsBtn, markAllReadBtn, copySessionBtn, 
          openIncognitoBtn, openDevConsoleBtn, dismissWarningBtn, pollInterval, logLimit, toggleViewBtn, copyRawBtn } = elements;
  
  // Setup theme toggle
  const themeToggle = document.getElementById('themeToggleDashboard');
  if (themeToggle) {
    setupThemeToggle(themeToggle);
  }
  
  startMonitoringBtn?.addEventListener('click', startMonitoring);
  stopMonitoringBtn?.addEventListener('click', stopMonitoring);
  refreshLogsBtn?.addEventListener('click', refreshDashboard);
  clearLogsBtn?.addEventListener('click', clearAllLogs);
  markAllReadBtn?.addEventListener('click', markAllLogsAsRead);
  
  document.getElementById('closeDashboardBtn')?.addEventListener('click', () => window.close());
  
  copySessionBtn?.addEventListener('click', copySessionUrl);
  openIncognitoBtn?.addEventListener('click', openInIncognito);
  deployPrettierBtn?.addEventListener('click', deployPrettierClass);
  openDevConsoleBtn?.addEventListener('click', openDeveloperConsole);
  dismissWarningBtn?.addEventListener('click', dismissDevConsoleWarning);
  toggleViewBtn?.addEventListener('click', toggleDebugView);
  copyRawBtn?.addEventListener('click', copyRawResponse);
  
  pollInterval?.addEventListener('change', async () => {
    updatePollIntervalStat();
    savePreferences();
    if (isMonitoring) await restartMonitoring();
  });
  
  logLimit?.addEventListener('change', async () => {
    savePreferences();
    if (isMonitoring) await restartMonitoring();
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