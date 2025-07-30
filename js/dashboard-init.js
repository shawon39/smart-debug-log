// Dashboard Initialization and Setup
// This file handles initial setup, event listeners, and DOM management

// Global variables
let currentSession = null;
let sfHost = null;
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
}