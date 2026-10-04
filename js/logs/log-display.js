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

// The log filter (#logFilter, next to the search box): 'useful' hides empty logs, 'all' shows every
// log, 'debug' and 'errors' keep logs whose body has System.debug output / a fatal error or exception
function getLogFilter() {
  return elements?.logFilter?.value || 'useful';
}

// 'debug' and 'errors' need the log body, so logs are scanned before they can be shown
function isContentFilter(filter = getLogFilter()) {
  return filter === 'debug' || filter === 'errors';
}

// Empty = no Apex output. Known exactly once the body was read; before that, a log under 1 KB counts
// as empty (a log without a size does not)
function isEmptyLog(log) {
  const checked = logCache.getEmptyStatus(log.Id);
  if (typeof checked === 'boolean') return checked;
  return log.LogLength != null && log.LogLength < EMPTY_LOG_MAX_BYTES;
}

function matchesLogFilter(log, filter) {
  if (filter === 'all') return true;
  if (filter === 'debug') return logCache.getDebugStatus(log.Id) === true;
  if (filter === 'errors') return logCache.getErrorStatus(log.Id) === true || logCache.getExceptionStatus(log.Id) === true;
  return !isEmptyLog(log);
}

function getUnclearedLogs() {
  return loadedLogs.filter(log => !isLogCleared(log.Id));
}

// Logs of the last load the list can show (not cleared, matching the filter), newest first
function getVisibleLogs() {
  const filter = getLogFilter();
  return getUnclearedLogs().filter(log => matchesLogFilter(log, filter));
}

// Logs with content whose body was not scanned yet (what the debug/errors filters still have to check)
function getUnscannedLogs() {
  return logCache.getUncachedLogs(loadedLogs.filter(log => !isEmptyLog(log)));
}

function getEmptyLogs() {
  return getUnclearedLogs().filter(isEmptyLog);
}

// For the debug/errors filters: scans unscanned logs, newest first and 3 at a time like the icons,
// until the list has `filterScanWanted` matches or nothing is left to scan. The list updates after
// each batch. A larger request while it runs ("See more") raises the target; a new load or filter
// (scanGeneration changes) stops it.
let filterScan = null;
let filterScanWanted = 0;
let scanGeneration = 0;

function scanForFilter(wanted) {
  if (!isContentFilter()) return null;
  filterScanWanted = Math.max(filterScanWanted, wanted);
  if (filterScan) return filterScan;

  const generation = scanGeneration;
  const scan = (async () => {
    const tried = new Set(); // A body that fails to download is not tried again in this scan
    while (generation === scanGeneration && isContentFilter() && getVisibleLogs().length < filterScanWanted) {
      const batch = getUnscannedLogs().filter(log => !tried.has(log.Id)).slice(0, logLoader.batchSize);
      if (batch.length === 0) break;
      batch.forEach(log => tried.add(log.Id));
      await logLoader.checkDebugStatusProgressive(batch, (logId) => logRenderer.updateLogIndicator(logId));
      if (generation === scanGeneration && isContentFilter()) showLoadedLogs(filterScanWanted);
    }
  })().finally(() => {
    if (filterScan !== scan) return; // A newer scan took over
    filterScan = null;
    filterScanWanted = 0;
    if (generation !== scanGeneration) return;
    updateLogsFilterNote();
    // The empty state said "Checking logs..." while the scan ran
    if (debugLogs.length === 0 && isContentFilter() && getUnclearedLogs().length > 0) {
      logRenderer.showEmptyState(null, describeFilteredEmptyState());
    }
  });
  filterScan = scan;
  return scan;
}

// Stops a running filter scan (a new load, filter or Clear all)
function stopFilterScan() {
  scanGeneration++;
  filterScan = null;
  filterScanWanted = 0;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Shown instead of "No debug logs yet" when there are logs, but the filter hides all of them
function describeFilteredEmptyState() {
  const filter = getLogFilter();
  if (isContentFilter(filter)) {
    return {
      title: filter === 'debug' ? 'No logs with System.debug' : 'No logs with errors',
      text: filterScan ? 'Checking logs...' : 'None of the loaded logs has one.'
    };
  }
  return { title: 'Only empty logs', text: 'They hold no Apex output. Run your code, or show them below.' };
}

// The line under the list: what the filter hides, with Show / Hide / Delete
let deletingEmptyLogs = null; // Progress text while empty logs are checked and deleted

function updateLogsFilterNote(visibleCount = null) {
  const note = elements?.logsFilterNote;
  if (!note) return;
  const filter = getLogFilter();
  const parts = [];
  if (deletingEmptyLogs) {
    parts.push(`<span>${deletingEmptyLogs}</span>`);
  } else if (isContentFilter(filter)) {
    if (filterScan) {
      parts.push('<span>Checking logs...</span>');
    } else {
      const hidden = getUnclearedLogs().length - (visibleCount ?? getVisibleLogs().length);
      if (hidden > 0) parts.push(`<span>${plural(hidden, 'other log')} hidden</span>`, '<button type="button" data-filter-action="all">Show all</button>');
    }
  } else {
    const empty = getEmptyLogs().length;
    if (empty > 0) {
      parts.push(
        filter === 'all' ? `<span>${plural(empty, 'empty log')}</span>` : `<span>${plural(empty, 'empty log')} hidden</span>`,
        filter === 'all'
          ? '<button type="button" data-filter-action="useful">Hide</button>'
          : '<button type="button" data-filter-action="all">Show</button>',
        '<button type="button" class="danger" data-filter-action="delete-empty">Delete</button>'
      );
    }
  }
  note.innerHTML = parts.join('<span class="logs-filter-sep" aria-hidden="true">&middot;</span>');
  note.classList.toggle('hidden', parts.length === 0);
}

// Changes the log filter (the select or a link in the note) and shows the first page again
function setLogFilter(filter) {
  if (elements.logFilter) elements.logFilter.value = filter;
  savePreferences();
  stopFilterScan();
  showLoadedLogs(0);
  logLoader.checkDebugStatusProgressive(debugLogs, (logId) => logRenderer.updateLogIndicator(logId));
}

// Deletes the empty logs in Salesforce. Each body is checked first (they are tiny), so a small log
// that has output is never deleted. Open dashboards drop deleted logs on LOGS_DELETED.
const EMPTY_CHECK_CONCURRENCY = 5;

async function deleteEmptyLogs() {
  const candidates = getEmptyLogs();
  if (candidates.length === 0 || deletingEmptyLogs) return;
  // The list shows the logs of every user in the org
  const myUserId = window.debugLogManagerUI?.userId;
  const othersCount = myUserId ? candidates.filter(log => log.LogUserId && log.LogUserId !== myUserId).length : 0;
  const owners = othersCount > 0 ? ` (${othersCount} of them from other users)` : '';
  if (!confirm(`Delete ${plural(candidates.length, 'empty debug log')}${owners} in Salesforce? They hold no Apex output, and each one is checked before it is deleted. This cannot be undone.`)) return;

  try {
    const emptyIds = [];
    for (let i = 0; i < candidates.length; i += EMPTY_CHECK_CONCURRENCY) {
      deletingEmptyLogs = `Checking ${Math.min(i + EMPTY_CHECK_CONCURRENCY, candidates.length)} of ${candidates.length}...`;
      updateLogsFilterNote();
      await Promise.all(candidates.slice(i, i + EMPTY_CHECK_CONCURRENCY).map(async (log) => {
        try {
          // Also remembers the result, so a small log with output is shown and not checked again
          logLoader.cacheStatusFromContent(log.Id, await logLoader.getLogContent(log.Id));
          if (logCache.getEmptyStatus(log.Id)) emptyIds.push(log.Id);
        } catch (error) {
          // Not checked, so not deleted
        }
      }));
    }
    if (emptyIds.length < candidates.length) showLoadedLogs(debugLogs.length);
    if (emptyIds.length === 0) {
      showToast('No empty logs to delete', 3000);
      return;
    }

    deletingEmptyLogs = 'Deleting...';
    updateLogsFilterNote();
    const response = await chrome.runtime.sendMessage({ type: 'DELETE_APEX_LOGS', sfHost: getHostFromUrl() || sfHost, logIds: emptyIds });
    if (!response || !response.success) throw new Error(response?.error || 'Delete failed');
    const { deleted = 0, failed = 0 } = response.data || {};
    showToast(failed > 0 ? `Deleted ${plural(deleted, 'empty log')}, ${failed} could not be deleted` : `Deleted ${plural(deleted, 'empty log')}`, 4000);
  } catch (error) {
    showToast(`Could not delete empty logs: ${error.message}`, 5000);
  } finally {
    deletingEmptyLogs = null;
    updateLogsFilterNote();
  }
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

    // The old list is gone: no scan, note or Delete may act on it while loading
    stopFilterScan();
    loadedLogs = [];
    updateLogsFilterNote();
    
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
    updateLogsFilterNote();
  }
}

/**
 * Shows the first `count` visible logs of the last load (at least one page)
 * @param {number} count - Number of logs shown before (0: first page only)
 */
function showLoadedLogs(count) {
  // Filter out cleared logs and logs the log filter hides BEFORE pagination
  const allVisibleLogs = getVisibleLogs();
  const wanted = Math.max(getCurrentPageSize(), count);
  const unscannedCount = isContentFilter() ? getUnscannedLogs().length : 0;

  debugLogs = allVisibleLogs.slice(0, wanted);
  currentOffset = debugLogs.length;

  // Check if more pages exist (the debug/errors filters may still find more in unscanned logs)
  hasMoreLogs = allVisibleLogs.length > debugLogs.length || unscannedCount > 0;
  if (!hasMoreLogs) {
    logRenderer.removeSeeMoreButton();
  }

  // Start scanning first, so the texts below already say "Checking logs..."
  if (unscannedCount > 0 && debugLogs.length < wanted) {
    scanForFilter(wanted);
  }

  displayDebugLogs();
  updateStats();

  // Every log is hidden by the filter: say so instead of "No debug logs yet"
  if (debugLogs.length === 0 && getUnclearedLogs().length > 0) {
    logRenderer.showEmptyState(null, describeFilteredEmptyState());
  }
  updateLogsFilterNote(allVisibleLogs.length);
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

  // The debug/errors filters: one more page (beyond what a running scan is already filling)
  if (isContentFilter()) {
    showLoadedLogs(Math.max(debugLogs.length, filterScanWanted) + getCurrentPageSize());
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
    
    // Filter out cleared logs and logs the log filter hides from ALL cached logs
    const allVisibleLogs = getVisibleLogs();
    
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