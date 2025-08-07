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

// Get current page size for pagination
function getCurrentPageSize() {
  // Use the selected limit if available, default to 10
  return parseInt(elements?.logLimit?.value || 10);
}

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
    // Load logs (this will cache all available logs internally)
    await logLoader.loadDebugLogs(currentOffset, true);
    
    // Now get all cached logs for proper pagination
    const allCachedLogs = logLoader.getCachedLogs();
    
    if (!allCachedLogs || allCachedLogs.length === 0) {
      logRenderer.showEmptyState();
      hasMoreLogs = false;
      return;
    }
    
    // Filter out cleared logs BEFORE pagination
    const allVisibleLogs = allCachedLogs.filter(log => !isLogCleared(log.Id));
    
    // Get first page of visible logs
    const pageSize = getCurrentPageSize();
    debugLogs = allVisibleLogs.slice(0, pageSize);
    currentOffset = debugLogs.length;
    
    // Check if more pages exist
    hasMoreLogs = allVisibleLogs.length > pageSize;
    
    await displayDebugLogs();
    updateStats();
    
    // First-page icon precompute: fetch raw content once to compute and cache statuses
    // Subsequent loads will use persisted cache and avoid API calls
    logLoader.checkDebugStatusProgressive(debugLogs, (logId) => {
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
 * Loads more debug logs for pagination (uses cached data with cleared log filtering)
 */
async function loadMoreLogs() {
  if (isLoadingMore || !hasMoreLogs) {
    return;
  }

  isLoadingMore = true;
  logRenderer.updateSeeMoreButtonState(true);

  try {
    // Get all cached logs and filter out cleared ones
    const allCachedLogs = logLoader.getCachedLogs();
    
    if (!allCachedLogs || allCachedLogs.length === 0) {
      hasMoreLogs = false;
      logRenderer.removeSeeMoreButton();
      return;
    }
    
    // Filter out cleared logs from ALL cached logs
    const allVisibleLogs = allCachedLogs.filter(log => !isLogCleared(log.Id));
    
    // Get the next page of visible logs
    const pageSize = getCurrentPageSize();
    const nextPageLogs = allVisibleLogs.slice(currentOffset, currentOffset + pageSize);
    
    if (nextPageLogs.length === 0) {
      hasMoreLogs = false;
      logRenderer.removeSeeMoreButton();
      return;
    }
    
    // Check if more pages exist after this one
    const remainingLogs = allVisibleLogs.slice(currentOffset + pageSize);
    hasMoreLogs = remainingLogs.length > 0;
    
    // Update pagination state
    currentOffset += nextPageLogs.length;
    
    // Add new logs to debugLogs array and display
    debugLogs = debugLogs.concat(nextPageLogs);
    logRenderer.appendMoreLogs(nextPageLogs);
    updateStats();
    
    // Precompute icons for newly appended logs (first time only)
    logLoader.checkDebugStatusProgressive(nextPageLogs, (logId) => {
      logRenderer.updateLogIndicator(logId);
    });
    
    if (!hasMoreLogs) {
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