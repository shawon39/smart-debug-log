// Log Display Coordinator  
// This file coordinates the various log display modules and maintains compatibility

// Global state variables (maintaining compatibility with existing code)
let debugLogs = [];
let selectedLogId = null;
let readLogs = new Set();
let clearedLogs = new Set();

// Pagination state variables for incremental log loading
let currentOffset = 0;
let isLoadingMore = false;
let hasMoreLogs = true;
const LOGS_PER_PAGE = 10;

/**
 * Main function to load debug logs (resets pagination and loads first page)
 */
async function loadDebugLogs() {
  // Reset pagination state
  currentOffset = 0;
  hasMoreLogs = true;
  isLoadingMore = false;
  logRenderer.removeSeeMoreButton();
  
  logRenderer.showLoading();

  try {
    const result = await logLoader.loadDebugLogs(currentOffset, true);
    
    // Handle structured response from checkForMore
    const newLogs = result.logs || [];
    hasMoreLogs = result.hasMore || false;
    
    // Update offset only if we have more logs to load
    if (hasMoreLogs) {
      currentOffset += newLogs.length;
    }
    
    debugLogs = newLogs;
    await displayDebugLogs();
    updateStats();
    
    // Check debug status for logs progressively (non-blocking)
    // Only check non-cleared logs to minimize API calls
    const visibleLogs = debugLogs.filter(log => !isLogCleared(log.Id));
    logLoader.checkDebugStatusProgressive(visibleLogs, (logId) => {
      logRenderer.updateLogIndicator(logId);
    });
  } catch (error) {
    logRenderer.showEmptyState();
    hasMoreLogs = false;
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
 * Loads more debug logs for pagination
 */
async function loadMoreLogs() {
  if (isLoadingMore || !hasMoreLogs) {
    return;
  }

  isLoadingMore = true;
  logRenderer.updateSeeMoreButtonState(true);

  try {
    const moreLogs = await logLoader.loadMoreDebugLogs(currentOffset);
    
    if (!moreLogs || moreLogs.length === 0) {
      hasMoreLogs = false;
      logRenderer.removeSeeMoreButton();
      return;
    }
    
    // Update pagination state
    if (moreLogs.length < LOGS_PER_PAGE) {
      hasMoreLogs = false;
    } else {
      currentOffset += moreLogs.length;
    }
    
    // Filter out any logs that are already in our debugLogs array (avoid duplicates)
    const existingLogIds = new Set(debugLogs.map(log => log.Id));
    const newLogs = moreLogs.filter(log => !existingLogIds.has(log.Id));
    
    if (newLogs.length > 0) {
      // Add new logs to the debugLogs array
      debugLogs = debugLogs.concat(newLogs);
      
      // Append new logs to the UI
      logRenderer.appendMoreLogs(newLogs);
      updateStats();
      
      // Check debug status for new logs progressively (non-blocking)
      const visibleNewLogs = newLogs.filter(log => !isLogCleared(log.Id));
      logLoader.checkDebugStatusProgressive(visibleNewLogs, (logId) => {
        logRenderer.updateLogIndicator(logId);
      });
    } else {
      // All logs were duplicates, stop loading more
      hasMoreLogs = false;
      logRenderer.removeSeeMoreButton();
    }
    
  } catch (error) {
    console.error('Failed to load more logs:', error);
    hasMoreLogs = false;
    logRenderer.removeSeeMoreButton();
  } finally {
    isLoadingMore = false;
    logRenderer.updateSeeMoreButtonState(false);
    
    // Remove button if no more logs
    if (!hasMoreLogs) {
      logRenderer.removeSeeMoreButton();
    }
  }
}

/**
 * Legacy compatibility functions for progressive checking
 */
async function checkDebugStatusForLogsProgressive(logs) {
  // Filter out cleared logs to minimize API calls
  const visibleLogs = logs.filter(log => !isLogCleared(log.Id));
  await logLoader.checkDebugStatusProgressive(visibleLogs, (logId) => {
    logRenderer.updateLogIndicator(logId);
  });
}

async function checkDebugStatusForLogs(logs) {
  // Filter out cleared logs to minimize API calls
  const visibleLogs = logs.filter(log => !isLogCleared(log.Id));
  await logLoader.checkDebugStatusLimited(visibleLogs);
}