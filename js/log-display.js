// Log Display and Management
// This file handles log loading, displaying, selection, and stats

// View state variables
let debugLogs = [];
let selectedLogId = null;
let readLogs = new Set();
let clearedLogs = new Set();
let logDebugStatusCache = new Map(); // Cache for logs with debug message status

async function loadDebugLogs() {
  if (!currentSession || !sfHost) {
    const targetHost = getHostFromUrl();
    await checkConnectionStatus(targetHost);
    if (!currentSession) {
      showEmptyState();
      return;
    }
  }

  showLoading();

  try {
    const salesforceTabs = await getSalesforceTabs();

    const targetHost = getHostFromUrl();
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];
    
    const realSalesforceTabs = salesforceTabs.filter(tab => isRealSalesforceUrl(tab.url));
    const extensionTabs = salesforceTabs.filter(tab => !isRealSalesforceUrl(tab.url));
    
    const orderedTabs = [];
    
    if (targetHost) {
      const targetHostTabs = realSalesforceTabs.filter(tab => {
        const tabUrl = new URL(tab.url);
        return tabUrl.hostname === targetHost || tab.url.includes(targetHost);
      });
      orderedTabs.push(...targetHostTabs);
    }
    
    if (activeTab && isRealSalesforceUrl(activeTab.url) && !orderedTabs.find(tab => tab.id === activeTab.id)) {
      orderedTabs.push(activeTab);
    }
    
    const otherRealTabs = realSalesforceTabs
      .filter(tab => !orderedTabs.find(existingTab => existingTab.id === tab.id))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    
    orderedTabs.push(...otherRealTabs);
    
    const otherExtensionTabs = extensionTabs
      .filter(tab => !orderedTabs.find(existingTab => existingTab.id === tab.id))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    
    orderedTabs.push(...otherExtensionTabs);

    let logsFound = false;
    
    for (const tab of orderedTabs) {
      try {
        let isScriptLoaded = false;
        try {
          const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'PING' });
          isScriptLoaded = pingResponse && pingResponse.success;
        } catch (e) {
          isScriptLoaded = false;
        }
        
        if (!isScriptLoaded) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: [
                'content/api-handler.js',
                'content/api-operations.js', 
                'content/session-extraction.js'
              ]
            });
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (injectionError) {
            continue;
          }
        }
        
        let finalPingResponse;
        try {
          finalPingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'PING' });
        } catch (pingError) {
          continue;
        }
        
        if (!finalPingResponse || !finalPingResponse.success) {
          continue;
        }

        let instanceUrl;
        if (tab.url) {
          const url = new URL(tab.url);
          instanceUrl = `${url.protocol}//${url.hostname}`;
        } else {
          instanceUrl = `https://${sfHost}`;
        }
        
        const sessionData = {
          sessionId: currentSession.key || currentSession.sessionId,
          instanceUrl: instanceUrl
        };
        
        const query = `SELECT Id, LogUserId, StartTime, LogLength, Application, Operation, DurationMilliseconds 
                       FROM ApexLog 
                       ORDER BY StartTime DESC 
                       LIMIT ${parseInt(elements.logLimit.value)}`;

        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'TOOLING_QUERY',
          query: query,
          session: sessionData
        });

        if (response && response.success && response.data) {
          debugLogs = response.data.records || [];
          await displayDebugLogs();
          updateStats();
          logsFound = true;
          break;
        }
      } catch (error) {
        continue;
      }
    }

    if (!logsFound) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_RECENT_LOGS',
          orgId: currentSession.orgId,
          limit: parseInt(elements.logLimit.value)
        });

        if (response.success && response.data && response.data.length > 0) {
          debugLogs = response.data;
          await displayDebugLogs();
          updateStats();
          logsFound = true;
        }
      } catch (error) {
        // Failed
      }
      
      if (!logsFound) {
        try {
          const query = `SELECT Id, LogUserId, StartTime, LogLength, Application, Operation, DurationMilliseconds 
                         FROM ApexLog 
                         ORDER BY StartTime DESC 
                         LIMIT ${parseInt(elements.logLimit.value)}`;
          
          const response = await chrome.runtime.sendMessage({
            type: 'EXECUTE_TOOLING_QUERY',
            query: query,
            session: currentSession
          });

          if (response.success && response.data && response.data.records) {
            debugLogs = response.data.records;
            await displayDebugLogs();
            updateStats();
            logsFound = true;
          }
        } catch (error) {
          // Failed
        }
      }
      
      if (!logsFound) {
        showEmptyState();
      }
    }
  } catch (error) {
    showEmptyState();
  }
}

function showLoading() {
  const { logsLoading, emptyState, logsList } = elements;
  logsLoading.classList.remove('hidden');
  emptyState.classList.add('hidden');
  logsList.innerHTML = '';
}

function showEmptyState() {
  const { logsLoading, emptyState, logsList } = elements;
  logsLoading.classList.add('hidden');
  emptyState.classList.remove('hidden');
  logsList.innerHTML = '';
}

async function displayDebugLogs() {
  const { logsLoading, emptyState, logsList } = elements;
  logsLoading.classList.add('hidden');
  emptyState.classList.add('hidden');

  if (!debugLogs || debugLogs.length === 0) {
    showEmptyState();
    return;
  }

  // Filter out cleared logs
  const visibleLogs = debugLogs.filter(log => !isLogCleared(log.Id));
  
  if (visibleLogs.length === 0) {
    showEmptyState();
    return;
  }

  // Render logs immediately for fast display
  logsList.innerHTML = visibleLogs.map(log => {
    const logTime = new Date(log.StartTime);
    const now = new Date();
    const hoursSinceLog = (now - logTime) / (1000 * 60 * 60);
    const isLikelyExpired = hoursSinceLog > 24;
    
    const expiredClass = isLikelyExpired ? 'log-item-expired' : '';
    const expiredIndicator = isLikelyExpired ? '<span class="expired-indicator" title="This log may have expired (older than 24 hours)">⚠️</span>' : '';
    
    // Check if this log is unread
    const isUnread = !isLogRead(log.Id);
    const unreadIndicator = isUnread ? '<span class="unread-indicator" title="Unread log"></span>' : '';
    
    // Check if this log has debug messages (from cache)
    const debugStatus = logDebugStatusCache.get(log.Id);
    const hasDebugIndicator = (debugStatus === true) ? '<span class="has-debug-indicator" title="Contains debug messages">📋</span>' : '';
    
    return `
    <div class="log-item ${selectedLogId === log.Id ? 'selected' : ''} ${expiredClass}" data-log-id="${log.Id}">
      <div class="log-header">
        <div class="log-id">${log.Id}${unreadIndicator}</div>
        <div class="log-time">
          ${expiredIndicator}${hasDebugIndicator}
          ${formatDateTimeWithHighlight(log.StartTime)}
        </div>
      </div>
      <div class="log-details">
        <span class="log-operation">${log.Operation || 'Unknown'}</span>
        <span class="log-duration">${log.DurationMilliseconds || 0}ms</span>
        <span class="log-size">${formatFileSize(log.LogLength || 0)}</span>
      </div>
    </div>
  `;
  }).join('');

  document.querySelectorAll('.log-item').forEach(item => {
    item.addEventListener('click', () => {
      const logId = item.getAttribute('data-log-id');
      selectDebugLog(logId);
    });
  });

  // Check debug status for logs that haven't been cached yet (async, non-blocking)
  checkDebugStatusForLogsProgressive(visibleLogs);
}

function selectDebugLog(logId) {
  // Mark log as read
  markLogAsRead(logId);
  
  // Remove unread indicator from this log
  const logElement = document.querySelector(`[data-log-id="${logId}"]`);
  if (logElement) {
    const unreadIndicator = logElement.querySelector('.unread-indicator');
    if (unreadIndicator) {
      unreadIndicator.remove();
    }
  }
  
  // Update selected state
  selectedLogId = logId;
  
  // Update visual selection
  document.querySelectorAll('.log-item').forEach(item => {
    item.classList.remove('selected');
  });
  logElement?.classList.add('selected');
  
  // Show log details
  showLogDetails(logId);
}

async function showLogDetails(logId) {
  const log = debugLogs.find(l => l.Id === logId);
  if (!log) return;

  const { selectedLogIdElement, welcomeState, limitsWelcomeState, debugContentPanel, debugContent, limitsContent, errorAndLimitsContent, errorContent } = elements;
  
  if (selectedLogIdElement) {
    selectedLogIdElement.textContent = `Log ID: ${logId}`;
  }

  welcomeState.classList.add('hidden');
  limitsWelcomeState.classList.add('hidden');
  debugContentPanel.classList.remove('hidden');
  
  // Clear raw response while loading
  clearRawResponse();
  
  debugContent.innerHTML = '<div class="loading-message">Loading debug messages...</div>';
  if (errorAndLimitsContent) {
    errorAndLimitsContent.classList.remove('hidden');
    if (errorContent) {
      errorContent.innerHTML = '<div class="loading-message">Analyzing errors...</div>';
    }
    if (limitsContent) {
      limitsContent.innerHTML = '<div class="loading-message">Loading governor limits...</div>';
    }
  }

  try {
    // Get log content
    const targetHost = getHostFromUrl();
    const response = await chrome.runtime.sendMessage({
      type: 'GET_LOG_CONTENT',
      logId: logId,
      orgId: currentSession.orgId,
      targetHost: targetHost
    });

    if (response.success && response.data) {
      // Store raw response data
      currentRawResponse = response.data.content || response.data;
      
      // Cache debug message status for this log
      const hasDebugMsgs = hasDebugMessages(currentRawResponse);
      logDebugStatusCache.set(logId, hasDebugMsgs);
      
      // Update the log display to show the new indicator
      await displayDebugLogs();
      
      // Show toggle button and set up view controls
      const { toggleViewBtn } = elements;
      toggleViewBtn?.classList.remove('hidden');
      
      // Reset to debug view when new log is loaded
      resetToDebugView();
      
      const parsedContent = parseDebugLogContent(currentRawResponse);
      
      // Display debug content using the new unified function
      displayDebugContent(parsedContent);
    } else {
      // Handle specific error cases
      let errorMessage = 'Failed to load debug log content.';
      if (response.error && response.error.includes('not found or expired')) {
        errorMessage = '<div class="error-message-block">' +
          '<strong>Debug Log Expired</strong><br>' +
          'This debug log is no longer available. Debug logs in Salesforce automatically expire after 24 hours or may be deleted.<br>' +
          '<small>Try generating a new debug log to view recent execution details.</small>' +
          '</div>';
      } else if (response.message) {
        errorMessage = `<div class="error-message">Error: ${escapeHtml(response.message)}</div>`;
      }
      
      debugContent.innerHTML = errorMessage;
      if (errorContent) {
        errorContent.innerHTML = '<div class="error-message">Unable to analyze errors.</div>';
      }
      if (limitsContent) {
        limitsContent.innerHTML = '<div class="error-message">Unable to load governor limits.</div>';
      }
      
      // Clear raw response and hide button on error
      clearRawResponse();
      
      // Cache that this log was checked but has no accessible debug messages  
      logDebugStatusCache.set(logId, false);
      await displayDebugLogs();
    }
  } catch (error) {
    debugContent.innerHTML = '<div class="error-message">Error loading debug messages.</div>';
    if (errorContent) {
      errorContent.innerHTML = '<div class="error-message">Error analyzing errors.</div>';
    }
    if (limitsContent) {
      limitsContent.innerHTML = '<div class="error-message">Error loading governor limits.</div>';
    }
    
    // Clear raw response and hide button on error
    clearRawResponse();
    
    // Cache that this log was checked but has no accessible debug messages  
    logDebugStatusCache.set(logId, false);
    await displayDebugLogs();
  }
}

function updateStats() {
  const { totalLogsCount, lastPollTime } = elements;
  if (totalLogsCount) {
    // Count only visible logs (not cleared)
    const visibleLogsCount = debugLogs.filter(log => !isLogCleared(log.Id)).length;
    totalLogsCount.textContent = visibleLogsCount;
  }
  if (lastPollTime) {
    lastPollTime.textContent = new Date().toLocaleTimeString();
  }
}

function initializeStats() {
  const { totalLogsCount, lastPollTime } = elements;
  if (totalLogsCount) {
    totalLogsCount.textContent = '0';
  }
  if (lastPollTime) {
    lastPollTime.textContent = 'Never';
  }
}

// Helper function to update individual log indicator in the DOM
function updateLogIndicator(logId, hasDebugMessages) {
  const logElement = document.querySelector(`[data-log-id="${logId}"]`);
  if (!logElement) return;
  
  const logTimeElement = logElement.querySelector('.log-time');
  if (!logTimeElement) return;
  
  // Remove existing debug indicator if any
  const existingIndicator = logTimeElement.querySelector('.has-debug-indicator');
  if (existingIndicator) {
    existingIndicator.remove();
  }
  
  // Add new indicator if log has debug messages
  if (hasDebugMessages) {
    const expiredIndicator = logTimeElement.querySelector('.expired-indicator');
    const indicatorHtml = '<span class="has-debug-indicator" title="Contains debug messages">📋</span>';
    
    if (expiredIndicator) {
      // Insert after expired indicator
      expiredIndicator.insertAdjacentHTML('afterend', indicatorHtml);
    } else {
      // Insert at beginning
      logTimeElement.insertAdjacentHTML('afterbegin', indicatorHtml);
    }
  }
}

// Check debug status for logs progressively (non-blocking)
async function checkDebugStatusForLogsProgressive(logs) {
  const uncachedLogs = logs.filter(log => !logDebugStatusCache.has(log.Id));
  
  if (uncachedLogs.length === 0) {
    return; // All logs already cached
  }

  // Process all uncached logs in batches to avoid overwhelming the system
  const batchSize = 3;
  
  for (let i = 0; i < uncachedLogs.length; i += batchSize) {
    const batch = uncachedLogs.slice(i, i + batchSize);
    
    // Process each log in the batch independently
    batch.forEach(async (log) => {
      try {
        const targetHost = getHostFromUrl();
        const response = await chrome.runtime.sendMessage({
          type: 'GET_LOG_CONTENT',
          logId: log.Id,
          orgId: currentSession.orgId,
          targetHost: targetHost
        });

        if (response.success && response.data) {
          const logContent = response.data.content || response.data;
          const hasDebugMsgs = hasDebugMessages(logContent);
          logDebugStatusCache.set(log.Id, hasDebugMsgs);
          
          // Update UI immediately for this specific log
          updateLogIndicator(log.Id, hasDebugMsgs);
        } else {
          // If we can't fetch the log content, assume no debug messages
          logDebugStatusCache.set(log.Id, false);
          updateLogIndicator(log.Id, false);
        }
      } catch (error) {
        // If there's an error, assume no debug messages
        logDebugStatusCache.set(log.Id, false);
        updateLogIndicator(log.Id, false);
      }
    });
    
    // Add a small delay between batches to avoid overwhelming the system
    if (i + batchSize < uncachedLogs.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

// Check debug status for logs that haven't been cached yet
async function checkDebugStatusForLogs(logs) {
  const uncachedLogs = logs.filter(log => !logDebugStatusCache.has(log.Id));
  
  if (uncachedLogs.length === 0) {
    return; // All logs already cached
  }

  // Only check a few logs at a time to avoid overwhelming the system
  const maxConcurrentChecks = 3;
  const logsToCheck = uncachedLogs.slice(0, maxConcurrentChecks);
  
  const checkPromises = logsToCheck.map(async (log) => {
    try {
      const targetHost = getHostFromUrl();
      const response = await chrome.runtime.sendMessage({
        type: 'GET_LOG_CONTENT',
        logId: log.Id,
        orgId: currentSession.orgId,
        targetHost: targetHost
      });

      if (response.success && response.data) {
        const logContent = response.data.content || response.data;
        const hasDebugMsgs = hasDebugMessages(logContent);
        logDebugStatusCache.set(log.Id, hasDebugMsgs);
      } else {
        // If we can't fetch the log content, assume no debug messages
        logDebugStatusCache.set(log.Id, false);
      }
    } catch (error) {
      // If there's an error, assume no debug messages
      logDebugStatusCache.set(log.Id, false);
    }
  });

  // Wait for all checks to complete (or timeout after 5 seconds)
  try {
    await Promise.race([
      Promise.all(checkPromises),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
  } catch (error) {
    // Some checks failed or timed out, but that's okay
  }
}