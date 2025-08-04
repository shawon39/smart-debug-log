// Log Rendering and UI Updates  
// This file handles rendering logs in the UI and managing visual states

class LogRenderer {
  constructor() {
    this.selectedLogId = null;
  }

  /**
   * Shows loading state
   */
  showLoading() {
    const { logsLoading, emptyState, logsList } = elements;
    logsLoading.classList.remove('hidden');
    emptyState.classList.add('hidden');
    logsList.innerHTML = '';
  }

  /**
   * Shows empty state when no logs are available
   */
  showEmptyState() {
    const { logsLoading, emptyState, logsList } = elements;
    logsLoading.classList.add('hidden');
    emptyState.classList.remove('hidden');
    logsList.innerHTML = '';
  }

  /**
   * Renders debug logs in the UI
   * @param {Array} logs - Array of debug logs
   */
  displayDebugLogs(logs) {
    const { logsLoading, emptyState, logsList } = elements;
    logsLoading.classList.add('hidden');
    emptyState.classList.add('hidden');

    if (!logs || logs.length === 0) {
      this.showEmptyState();
      return;
    }

    // Filter out cleared logs
    const visibleLogs = logs.filter(log => !isLogCleared(log.Id));
    
    if (visibleLogs.length === 0) {
      this.showEmptyState();
      return;
    }

    // Render logs
    logsList.innerHTML = visibleLogs.map(log => this._renderLogItem(log)).join('');

    // Add click event listeners
    document.querySelectorAll('.log-item').forEach(item => {
      item.addEventListener('click', () => {
        const logId = item.getAttribute('data-log-id');
        this.selectDebugLog(logId);
      });
    });
  }

  /**
   * Selects a debug log and shows its details
   * @param {string} logId - Log ID to select
   */
  selectDebugLog(logId) {
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
    this.selectedLogId = logId;
    
    // Update visual selection
    document.querySelectorAll('.log-item').forEach(item => {
      item.classList.remove('selected');
    });
    logElement?.classList.add('selected');
    
    // Show log details
    this.showLogDetails(logId);
  }

  /**
   * Shows details for a selected log
   * @param {string} logId - Log ID to show details for
   */
  async showLogDetails(logId) {
    const log = debugLogs.find(l => l.Id === logId);
    if (!log) return;

    const { selectedLogIdElement, welcomeState, limitsWelcomeState, debugContentPanel, 
            debugContent, limitsContent, errorAndLimitsContent, errorContent } = elements;
    
    if (selectedLogIdElement) {
      selectedLogIdElement.textContent = `Log ID: ${logId}`;
    }

    welcomeState.classList.add('hidden');
    limitsWelcomeState.classList.add('hidden');
    debugContentPanel.classList.remove('hidden');
    
    // Clear raw response while loading
    clearRawResponse();
    
    // Show loading states
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
      const content = await logLoader.getLogContent(logId);
      
      // Store raw response data
      currentRawResponse = content;
      
      // Cache debug and error status for this log
      const hasDebugMsgs = hasDebugMessages(content);
      const hasErrorMsgs = hasErrors(content);
      
      logCache.setDebugStatus(logId, hasDebugMsgs);
      logCache.setErrorStatus(logId, hasErrorMsgs);
      
      // Update the log display to show the new indicators
      this.displayDebugLogs(debugLogs);
      
      // Show toggle button and set up view controls
      const { toggleViewBtn } = elements;
      toggleViewBtn?.classList.remove('hidden');
      
      // Reset to debug view when new log is loaded
      resetToDebugView();
      
      const parsedContent = parseDebugLogContent(content);
      
      // Display debug content using the unified function
      displayDebugContent(parsedContent);

    } catch (error) {
      this._handleLogDetailsError(error, logId);
    }
  }

  /**
   * Updates indicator for a specific log
   * @param {string} logId - Log ID to update
   */
  updateLogIndicator(logId) {
    const logElement = document.querySelector(`[data-log-id="${logId}"]`);
    if (!logElement) return;
    
    const logTimeElement = logElement.querySelector('.log-time');
    if (!logTimeElement) return;
    
    // Get current status from caches
    const debugStatus = logCache.getDebugStatus(logId) || false;
    const errorStatus = logCache.getErrorStatus(logId) || false;
    
    // Remove existing indicators
    const existingDebugIndicator = logTimeElement.querySelector('.has-debug-indicator');
    if (existingDebugIndicator) {
      existingDebugIndicator.remove();
    }
    
    const existingErrorIndicator = logTimeElement.querySelector('.has-error-indicator');
    if (existingErrorIndicator) {
      existingErrorIndicator.remove();
    }
    
    // Build indicators HTML
    let indicatorsHtml = '';
    if (debugStatus) {
      indicatorsHtml += '<span class="has-debug-indicator" title="Contains debug messages">📋</span>';
    }
    if (errorStatus) {
      indicatorsHtml += '<span class="has-error-indicator" title="Contains errors">❗</span>';
    }
    
    // Add indicators if any exist
    if (indicatorsHtml) {
      const expiredIndicator = logTimeElement.querySelector('.expired-indicator');
      
      if (expiredIndicator) {
        // Insert after expired indicator
        expiredIndicator.insertAdjacentHTML('afterend', indicatorsHtml);
      } else {
        // Insert at beginning
        logTimeElement.insertAdjacentHTML('afterbegin', indicatorsHtml);
      }
    }
  }

  /**
   * Updates statistics display
   * @param {Array} logs - Current logs array
   */
  updateStats(logs) {
    const { totalLogsCount, lastPollTime } = elements;
    if (totalLogsCount) {
      // Count only visible logs (not cleared)
      const visibleLogsCount = logs.filter(log => !isLogCleared(log.Id)).length;
      totalLogsCount.textContent = visibleLogsCount;
    }
    if (lastPollTime) {
      lastPollTime.textContent = new Date().toLocaleTimeString();
    }
  }

  /**
   * Initializes statistics display
   */
  initializeStats() {
    const { totalLogsCount, lastPollTime } = elements;
    if (totalLogsCount) {
      totalLogsCount.textContent = '0';
    }
    if (lastPollTime) {
      lastPollTime.textContent = 'Never';
    }
  }

  /**
   * Renders a single log item
   * @private
   * @param {Object} log - Log object
   * @returns {string} HTML for log item
   */
  _renderLogItem(log) {
    const logTime = new Date(log.StartTime);
    const now = new Date();
    const hoursSinceLog = (now - logTime) / (1000 * 60 * 60);
    const isLikelyExpired = hoursSinceLog > 24;
    
    const expiredClass = isLikelyExpired ? 'log-item-expired' : '';
    const expiredIndicator = isLikelyExpired ? '<span class="expired-indicator" title="This log may have expired (older than 24 hours)">⚠️</span>' : '';
    
    // Check if this log is unread
    const isUnread = !isLogRead(log.Id);
    const unreadIndicator = isUnread ? '<span class="unread-indicator" title="Unread log"></span>' : '';
    
    // Check cache for indicators
    const debugStatus = logCache.getDebugStatus(log.Id);
    const hasDebugIndicator = (debugStatus === true) ? '<span class="has-debug-indicator" title="Contains debug messages">📋</span>' : '';
    
    const errorStatus = logCache.getErrorStatus(log.Id);
    const hasErrorIndicator = (errorStatus === true) ? '<span class="has-error-indicator" title="Contains errors">❗</span>' : '';
    
    return `
    <div class="log-item ${this.selectedLogId === log.Id ? 'selected' : ''} ${expiredClass}" data-log-id="${log.Id}">
      <div class="log-header">
        <div class="log-id">${log.Id}${unreadIndicator}</div>
        <div class="log-time">
          ${expiredIndicator}${hasDebugIndicator}${hasErrorIndicator}
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
  }

  /**
   * Handles errors when loading log details
   * @private
   * @param {Error} error - Error object
   * @param {string} logId - Log ID that failed to load
   */
  _handleLogDetailsError(error, logId) {
    const { debugContent, errorContent, limitsContent } = elements;
    
    let errorMessage = 'Failed to load debug log content.';
    if (error.message && error.message.includes('not found or expired')) {
      errorMessage = '<div class="error-message-block">' +
        '<strong>Debug Log Expired</strong><br>' +
        'This debug log is no longer available. Debug logs in Salesforce automatically expire after 24 hours or may be deleted.<br>' +
        '<small>Try generating a new debug log to view recent execution details.</small>' +
        '</div>';
    } else if (error.message) {
      errorMessage = `<div class="error-message">Error: ${escapeHtml(error.message)}</div>`;
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
    logCache.setDebugStatus(logId, false);
    logCache.setErrorStatus(logId, false);
    this.displayDebugLogs(debugLogs);
  }
}

// Create singleton instance
const logRenderer = new LogRenderer();