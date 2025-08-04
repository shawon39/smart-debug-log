// Log Display Coordinator  
// This file coordinates the various log display modules and maintains compatibility

// Global state variables (maintaining compatibility with existing code)
let debugLogs = [];
let selectedLogId = null;
let readLogs = new Set();
let clearedLogs = new Set();

/**
 * Main function to load debug logs
 */
async function loadDebugLogs() {
  logRenderer.showLoading();

  try {
    debugLogs = await logLoader.loadDebugLogs();
    await displayDebugLogs();
    updateStats();
    
    // Check debug status for logs progressively (non-blocking)
    logLoader.checkDebugStatusProgressive(debugLogs, (logId) => {
      logRenderer.updateLogIndicator(logId);
    });
  } catch (error) {
    logRenderer.showEmptyState();
  }
}

/**
 * Displays debug logs using the renderer
 */
async function displayDebugLogs() {
  logRenderer.displayDebugLogs(debugLogs);
}

/**
 * Shows loading state
 */
function showLoading() {
  logRenderer.showLoading();
}

/**
 * Shows empty state  
 */
function showEmptyState() {
  logRenderer.showEmptyState();
}

/**
 * Selects a debug log
 * @param {string} logId - Log ID to select
 */
function selectDebugLog(logId) {
  selectedLogId = logId;
  logRenderer.selectDebugLog(logId);
}

/**
 * Shows log details
 * @param {string} logId - Log ID to show details for
 */
async function showLogDetails(logId) {
  await logRenderer.showLogDetails(logId);
}

/**
 * Updates statistics display
 */
function updateStats() {
  logRenderer.updateStats(debugLogs);
}

/**
 * Initializes statistics display
 */
function initializeStats() {
  logRenderer.initializeStats();
}

/**
 * Updates indicator for a specific log
 * @param {string} logId - Log ID to update
 */
function updateLogIndicator(logId) {
  logRenderer.updateLogIndicator(logId);
}

/**
 * Legacy compatibility functions for progressive checking
 */
async function checkDebugStatusForLogsProgressive(logs) {
  await logLoader.checkDebugStatusProgressive(logs, (logId) => {
    logRenderer.updateLogIndicator(logId);
  });
}

async function checkDebugStatusForLogs(logs) {
  await logLoader.checkDebugStatusLimited(logs);
}