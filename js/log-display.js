// Log Display Coordinator  
// This file coordinates the various log display modules and maintains compatibility

// Global state variables (maintaining compatibility with existing code)
let debugLogs = [];
let readLogs = new Map(); // logId -> time it was first marked read (ms)
let clearedLogs = new Map(); // logId -> time it was cleared (ms)
let loadedLogs = []; // All logs of the last load, newest first (pages are taken from here)

// Pagination state variables for incremental log loading
let currentOffset = 0;
let isLoadingMore = false;
let hasMoreLogs = true;

// A running load is shared by callers that arrive while it runs
let logsLoadInFlight = null;
let logsReloadQueued = null;

// Get current page size for pagination
function getCurrentPageSize() {
  // Use the selected limit if available, default to 15 (the default of #logLimit)
  return parseInt(elements?.logLimit?.value || 15);
}

/**
 * Main function to load debug logs (resets pagination and loads first page).
 * With keepPosition (incremental refresh) the opened pages and the list stay on screen while loading.
 * A refresh that starts while a load runs shares it; a reset call waits and then loads once more.
 * @param {{keepPosition?: boolean}} [options]
 */
function loadDebugLogs({ keepPosition = false } = {}) {
  if (logsLoadInFlight) {
    if (keepPosition) {
      return logsLoadInFlight;
    }
    if (!logsReloadQueued) {
      const reload = () => {
        logsReloadQueued = null;
        return loadDebugLogs();
      };
      logsReloadQueued = logsLoadInFlight.then(reload, reload);
    }
    return logsReloadQueued;
  }
    
  logsLoadInFlight = runLoadDebugLogs(keepPosition).finally(() => {
    logsLoadInFlight = null;
  });
  return logsLoadInFlight;
}
    
async function runLoadDebugLogs(keepPosition) {
  const keepCount = keepPosition ? debugLogs.length : 0;
    
  if (keepCount === 0) {
    // Reset pagination state
    currentOffset = 0;
    hasMoreLogs = true;
    isLoadingMore = false;
    logRenderer.removeSeeMoreButton();
    
    logRenderer.showLoading();
  }
    
  try {
    // Load logs (this will cache all available logs internally)
    const { logs } = await logLoader.loadDebugLogs();
    loadedLogs = logs;
    
    showLoadedLogs(keepCount);
    
    // First-page icon precompute: fetch raw content once to compute and cache statuses
    // Subsequent loads will use persisted cache and avoid API calls
    logLoader.checkDebugStatusProgressive(debugLogs, (logId) => {
      logRenderer.updateLogIndicator(logId);
    });
  } catch (error) {
    if (keepCount > 0) {
      // Refresh failed: keep the list on screen and say why
      showToast(`Could not refresh logs. ${logRenderer.describeLoadError(error).text}`, 5000);
      return;
    }
    // Show why there are no logs (no token, no session, API error)
    debugLogs = [];
    hasMoreLogs = false;
    logRenderer.removeSeeMoreButton();
    logRenderer.showEmptyState(error);
  }
}

/**
 * Shows the first `count` visible logs of the last load (at least one page)
 * @param {number} count - Number of logs shown before (0: first page only)
 */
function showLoadedLogs(count) {
  // Filter out cleared logs BEFORE pagination
  const allVisibleLogs = loadedLogs.filter(log => !isLogCleared(log.Id));

  debugLogs = allVisibleLogs.slice(0, Math.max(getCurrentPageSize(), count));
  currentOffset = debugLogs.length;

  // Check if more pages exist
  hasMoreLogs = allVisibleLogs.length > debugLogs.length;
  if (!hasMoreLogs) {
    logRenderer.removeSeeMoreButton();
  }

  displayDebugLogs();
  updateStats();
}

/**
 * Displays debug logs using the renderer
 */
async function displayDebugLogs() {
  logRenderer.displayDebugLogs(debugLogs);
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
  logRenderer.selectDebugLog(logId);
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
 * Loads more debug logs for pagination (uses the logs of the last load, with cleared log filtering)
 */
async function loadMoreLogs() {
  if (isLoadingMore || !hasMoreLogs) {
    return;
  }

  isLoadingMore = true;
  logRenderer.updateSeeMoreButtonState(true);

  try {
    // Get all loaded logs and filter out cleared ones
    const allCachedLogs = loadedLogs;
    
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