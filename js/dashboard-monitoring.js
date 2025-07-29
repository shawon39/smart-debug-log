// Monitoring Controls and Status Management
// This file handles start/stop monitoring, status updates, and preference management

// Monitoring variables
let monitoringInterval = null;
let isMonitoring = false;

// Monitoring status management
function updateMonitoringStatus(monitoring, statusText = '') {
  const { monitoringStatusDot, monitoringStatusText, startMonitoringBtn, stopMonitoringBtn, monitoringStats } = elements;
  if (!monitoringStatusDot || !monitoringStatusText) return;
  
  isMonitoring = monitoring;
  
  if (monitoring) {
    monitoringStatusDot.classList.add('monitoring');
    monitoringStatusText.textContent = statusText || 'Active';
    
    startMonitoringBtn?.classList.add('hidden');
    stopMonitoringBtn?.classList.remove('hidden');
    monitoringStats?.classList.remove('hidden');
  } else {
    monitoringStatusDot.classList.remove('monitoring');
    monitoringStatusText.textContent = statusText || 'Stopped';
    
    startMonitoringBtn?.classList.remove('hidden');
    stopMonitoringBtn?.classList.add('hidden');
    monitoringStats?.classList.add('hidden');
  }
}

// Monitoring controls
async function startMonitoring() {
  if (!currentSession) {
    await checkConnectionStatus();
    if (!currentSession) {
      alert('Please ensure you are logged into Salesforce and try again.');
      return;
    }
  }
  
  updateMonitoringStatus(true, 'Starting...');
  await loadDebugLogs();
  
  // Use background service worker for monitoring
  try {
    const orgId = currentSession.orgId || sfHost;
    const options = {
      pollInterval: parseInt(elements.pollInterval.value),
      logLimit: parseInt(elements.logLimit.value),
      notifyOnNew: true,
      autoDownload: false
    };
    
    const result = await chrome.runtime.sendMessage({
      type: 'START_DEBUG_MONITORING',
      orgId: orgId,
      session: currentSession,
      options: options
    });
    
    if (result.success) {
      updateMonitoringStatus(true, 'Active');
      
      // Set up interval for UI updates
      const uiUpdateInterval = Math.max(parseInt(elements.pollInterval.value) * 1000, 5000);
      monitoringInterval = setInterval(loadDebugLogs, uiUpdateInterval);
    } else {
      updateMonitoringStatus(false, 'Failed to start');
    }
  } catch (error) {
    updateMonitoringStatus(false, 'Error');
  }
}

async function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  
  // Stop background monitoring
  try {
    const orgId = currentSession?.orgId || sfHost;
    if (orgId) {
      await chrome.runtime.sendMessage({
        type: 'STOP_DEBUG_MONITORING',
        orgId: orgId
      });
    }
  } catch (error) {

  }
  
  updateMonitoringStatus(false, 'Stopped');
}

async function restartMonitoring() {
  if (isMonitoring) {
    await stopMonitoring();
    setTimeout(startMonitoring, 100);
  }
}

function updatePollIntervalStat() {
  const { pollInterval, pollIntervalStat } = elements;
  if (!pollInterval || !pollIntervalStat) return;
  const interval = parseInt(pollInterval.value);
  pollIntervalStat.textContent = interval >= 60 ? `${interval/60}m` : `${interval}s`;
}

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
    const result = await chrome.storage.local.get(['pollInterval', 'logLimit', 'autoRefresh']);
    
    if (result.pollInterval && elements.pollInterval) {
      elements.pollInterval.value = result.pollInterval;
    }
    
    if (result.logLimit && elements.logLimit) {
      elements.logLimit.value = result.logLimit;
    }
    
    // Load auto-refresh preference (default to true)
    const autoRefreshToggle = document.getElementById('autoRefreshToggle');
    if (autoRefreshToggle) {
      const autoRefreshValue = result.autoRefresh !== undefined ? result.autoRefresh : true;
      autoRefreshToggle.checked = autoRefreshValue;
    }
  } catch (error) {
    // Silent error handling
  }
}

async function savePreferences() {
  try {
    const preferences = {};
    
    if (elements.pollInterval) {
      preferences.pollInterval = elements.pollInterval.value;
    }
    
    if (elements.logLimit) {
      preferences.logLimit = elements.logLimit.value;
    }
    
    const autoRefreshToggle = document.getElementById('autoRefreshToggle');
    if (autoRefreshToggle) {
      preferences.autoRefresh = autoRefreshToggle.checked;
    }
    
    await chrome.storage.local.set(preferences);
  } catch (error) {
    // Silent error handling
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
    const originalText = markAllReadBtn.textContent;
    markAllReadBtn.textContent = 'Marked as Read ✓';
    markAllReadBtn.style.color = '#ffffff';
    
    setTimeout(() => {
      markAllReadBtn.textContent = originalText;
      markAllReadBtn.style.color = '';
    }, 2000);
  }
}

// Cleanup on window unload
window.addEventListener('beforeunload', () => {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
});