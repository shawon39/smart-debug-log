// Monitoring Controls and Status Management
// This file handles preference management and log management functions

// Monitoring status management

// Ensure auto-refresh default value is saved
async function ensureAutoRefreshDefault() {
  try {
    const result = await chrome.storage.local.get(['autoRefresh']);
    
    if (result.autoRefresh === undefined) {
      await chrome.storage.local.set({ autoRefresh: true });
    }
  } catch (error) {
    // Silent error handling
  }
}

// Preference management
async function loadPreferences() {
  try {
    const result = await chrome.storage.local.get(['logLimit', 'autoRefresh', 'logTypeFilter', 'logFilter']);
    
    if (result.logLimit && elements.logLimit) {
      elements.logLimit.value = result.logLimit;
    }
    
    // Load auto-refresh preference (default to true)
    const autoRefreshToggle = document.getElementById('autoRefreshToggle');
    if (autoRefreshToggle) {
      const autoRefreshValue = result.autoRefresh !== undefined ? result.autoRefresh : true;
      autoRefreshToggle.checked = autoRefreshValue;
    }
    
    // Load log type filter preference (default to 'Monitoring')
    const logTypeFilter = document.getElementById('logTypeFilter');
    if (logTypeFilter) {
      const logTypeValue = result.logTypeFilter || 'Monitoring';
      logTypeFilter.value = logTypeValue;
    }

    // Log filter (default 'useful': empty logs are hidden)
    if (result.logFilter && elements.logFilter) {
      elements.logFilter.value = result.logFilter;
    }
  } catch (error) {
    // Silent error handling
  }
}

async function savePreferences() {
  try {
    const preferences = {};
    
    if (elements.logLimit) {
      preferences.logLimit = elements.logLimit.value;
    }
    
    const autoRefreshToggle = document.getElementById('autoRefreshToggle');
    if (autoRefreshToggle) {
      preferences.autoRefresh = autoRefreshToggle.checked;
    }
    
    const logTypeFilter = document.getElementById('logTypeFilter');
    if (logTypeFilter) {
      preferences.logTypeFilter = logTypeFilter.value;
    }

    if (elements.logFilter) {
      preferences.logFilter = elements.logFilter.value;
    }
    
    await chrome.storage.local.set(preferences);
  } catch (error) {
    // Silent error handling
  }
}

// Clear all logs from UI
function clearAllLogs() {
  // Logs the log filter hides are cleared too, so an all-hidden list can be cleared
  const unclearedLogs = loadedLogs.filter(log => !isLogCleared(log.Id));
  if (unclearedLogs.length === 0) {
    return;
  }
  stopFilterScan();
  
  // Mark all cached logs as cleared for persistent filtering (per org)
  try {
    const allCachedLogs = (typeof logLoader?.getCachedLogs === 'function') ? (logLoader.getCachedLogs() || []) : [];
    // The cached list and the shown (loaded) logs are normally the same; marking twice is harmless
    const targetLogs = allCachedLogs.concat(unclearedLogs);
    targetLogs.forEach(log => {
      if (log?.Id) {
        markLogAsCleared(log.Id);
      }
    });
  } catch (e) {
    // Fallback to the logs of the last load
    unclearedLogs.forEach(log => {
      if (log?.Id) {
        markLogAsCleared(log.Id);
      }
    });
  }

  // Clear the logs list UI
  const { logsList, welcomeState, limitsWelcomeState, debugContentPanel, 
          errorAndLimitsContent, selectedLogIdElement } = elements;
  
  if (logsList) {
    logsList.innerHTML = '';
  }
  
  // Reset debug messages panel to welcome state
  if (welcomeState && debugContentPanel) {
    welcomeState.classList.remove('hidden');
    debugContentPanel.classList.add('hidden');
  }
  
  // Reset error analysis panel to welcome state
  if (limitsWelcomeState && errorAndLimitsContent) {
    limitsWelcomeState.classList.remove('hidden');
    errorAndLimitsContent.classList.add('hidden');
  }
  
  // Clear selected log ID display
  if (selectedLogIdElement) {
    selectedLogIdElement.textContent = '';
    selectedLogIdElement.title = '';
  }
  
  // Clear raw response
  if (typeof clearRawResponse === 'function') {
    clearRawResponse();
  }
  
  // Show empty state
  showEmptyState();
  
  // Reset pagination state and remove see more button
  currentOffset = 0;
  hasMoreLogs = false;
  isLoadingMore = false;
  if (typeof logRenderer?.removeSeeMoreButton === 'function') {
    logRenderer.removeSeeMoreButton();
  }

  // Update stats (debugLogs array remains for future filtering)
  updateStats();
  updateLogsFilterNote();
  
  // Show confirmation message
  const { clearLogsBtn } = elements;
  if (clearLogsBtn) {
    const originalText = clearLogsBtn.innerHTML;
    clearLogsBtn.innerHTML = Icons.svg('check');
    clearLogsBtn.classList.add('success-feedback');
    
    setTimeout(() => {
      clearLogsBtn.innerHTML = originalText;
      clearLogsBtn.classList.remove('success-feedback');
    }, 2000);
  }
}

// Mark all logs as read
function markAllLogsAsRead() {
  if (!debugLogs || debugLogs.length === 0) {
    return;
  }
  
  // Mark all logs as read
  debugLogs.forEach(log => {
    markLogAsRead(log.Id);
  });
  
  // Remove all unread indicators from the UI
  document.querySelectorAll('.unread-indicator').forEach(indicator => {
    indicator.remove();
  });
  
  // Show a brief confirmation message
  const { markAllReadBtn } = elements;
  if (markAllReadBtn) {
    const originalText = markAllReadBtn.innerHTML;
    markAllReadBtn.innerHTML = Icons.svg('check');
    markAllReadBtn.classList.add('success-feedback');
    
    setTimeout(() => {
      markAllReadBtn.innerHTML = originalText;
      markAllReadBtn.classList.remove('success-feedback');
    }, 2000);
  }
}