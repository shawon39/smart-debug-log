// Log Rendering and UI Updates  
// This file handles rendering logs in the UI and managing visual states

class LogRenderer {
  constructor() {
    this.selectedLogId = null;
    this.searchTerm = '';
    this.searchDebounceTimer = null;
    this.logContentCache = new Map(); // Cache for log contents during search
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
   * @param {boolean} append - Whether to append logs or replace them
   */
  displayDebugLogs(logs, append = false) {
    const { logsLoading, emptyState, logsList } = elements;
    logsLoading.classList.add('hidden');
    emptyState.classList.add('hidden');

    if (!logs || logs.length === 0) {
      if (!append) {
        this.showEmptyState();
      }
      return;
    }

    // Filter out cleared logs
    const visibleLogs = logs.filter(log => !isLogCleared(log.Id));
    
    if (visibleLogs.length === 0 && !append) {
      this.showEmptyState();
      return;
    }

    // Render logs
    const logsHtml = visibleLogs.map(log => this._renderLogItem(log)).join('');
    
    if (append) {
      // Remove existing "See more" button if it exists
      const existingSeeMoreBtn = document.getElementById('seeMoreLogsBtn');
      if (existingSeeMoreBtn) {
        existingSeeMoreBtn.remove();
      }
      
      // Append new logs
      logsList.insertAdjacentHTML('beforeend', logsHtml);
    } else {
      // Replace all logs
      logsList.innerHTML = logsHtml;
    }

    // Add "See more logs" button if there are potentially more logs
    this._addSeeMoreButton();

    // Add click event listeners to new log items
    document.querySelectorAll('.log-item').forEach(item => {
      if (!item.hasAttribute('data-listener-added')) {
        item.addEventListener('click', () => {
          const logId = item.getAttribute('data-log-id');
          this.selectDebugLog(logId);
        });
        item.setAttribute('data-listener-added', 'true');
      }
    });

    // Re-apply search highlighting if there's an active search
    if (this.searchTerm) {
      // Use setTimeout to ensure DOM is updated before searching
      setTimeout(() => this.searchInLogs(this.searchTerm), 50);
    }
  }

  /**
   * Appends more logs to the existing list
   * @param {Array} moreLogs - Additional logs to append
   */
  appendMoreLogs(moreLogs) {
    this.displayDebugLogs(moreLogs, true);
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
      selectedLogIdElement.textContent = `Loading user info...`;
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
      
      // Extract and display user email
      if (selectedLogIdElement) {
        const userEmail = extractUserEmailFromLog(content);
        selectedLogIdElement.textContent = userEmail ? `Log User: ${userEmail}` : `Log ID: ${logId}`;
      }
      
      // Store raw response data
      currentRawResponse = content;
      
      // Cache debug, error, and exception status for this log
      const hasDebugMsgs = hasDebugMessages(content);
      const hasFatalErrorMsgs = hasFatalErrors(content);
      const hasExceptionMsgs = hasExceptions(content);
      
      logCache.setDebugStatus(logId, hasDebugMsgs);
      logCache.setErrorStatus(logId, hasFatalErrorMsgs);
      logCache.setExceptionStatus(logId, hasExceptionMsgs);
      
      // Update the log display to show the new indicators
      this.displayDebugLogs(debugLogs);
      
      // Show toggle button and set up view controls
      const { toggleViewBtn } = elements;
      toggleViewBtn?.classList.remove('hidden');
      
      // Apply the view based on current state (isRawView)
      if (isRawView) {
        showRawResponse();
      } else {
        showDebugMessages();
      }

    } catch (error) {
      // Fallback to Log ID on error
      if (selectedLogIdElement) {
        selectedLogIdElement.textContent = `Log ID: ${logId}`;
      }
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
    const exceptionStatus = logCache.getExceptionStatus(logId) || false;
    
    // Remove existing indicators
    const existingDebugIndicator = logTimeElement.querySelector('.has-debug-indicator');
    if (existingDebugIndicator) {
      existingDebugIndicator.remove();
    }
    
    const existingErrorIndicator = logTimeElement.querySelector('.has-error-indicator');
    if (existingErrorIndicator) {
      existingErrorIndicator.remove();
    }
    
    const existingExceptionIndicator = logTimeElement.querySelector('.has-exception-indicator');
    if (existingExceptionIndicator) {
      existingExceptionIndicator.remove();
    }
    
    // Build indicators HTML (order: error, exception, debug)
    let indicatorsHtml = '';
    if (errorStatus) {
      indicatorsHtml += '<span class="has-error-indicator" title="Contains fatal errors">❗</span>';
    }
    if (exceptionStatus) {
      indicatorsHtml += '<span class="has-exception-indicator" title="Contains exceptions">⚠️</span>';
    }
    if (debugStatus) {
      indicatorsHtml += '<span class="has-debug-indicator" title="Contains debug messages">📋</span>';
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
   * Initializes the log search functionality
   */
  initializeSearch() {
    const searchInput = document.getElementById('logSearchInput');
    const searchResults = document.getElementById('logSearchResults');
    
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.trim();
      
      // Clear previous debounce timer
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }

      // If search is empty, clear all matches immediately
      if (!searchTerm) {
        this.clearSearch();
        return;
      }

      // Debounce search for 300ms
      this.searchDebounceTimer = setTimeout(async () => {
        await this.searchInLogs(searchTerm);
      }, 300);
    });
  }

  /**
   * Searches through debug logs for the given search term
   * @param {string} searchTerm - The term to search for
   */
  async searchInLogs(searchTerm) {
    if (!searchTerm || !debugLogs || debugLogs.length === 0) {
      this.clearSearch();
      return;
    }

    this.searchTerm = searchTerm.toLowerCase();
    const searchResults = document.getElementById('logSearchResults');

    // Show searching indicator
    if (searchResults) {
      searchResults.textContent = 'Searching...';
    }

    // Process all logs in parallel for much better performance
    const searchPromises = debugLogs.map(async (log) => {
      const logElement = document.querySelector(`[data-log-id="${log.Id}"]`);
      if (!logElement) return { logId: log.Id, hasMatch: false, element: null };

      try {
        const hasMatch = await this.logContainsSearchTerm(log.Id, this.searchTerm);
        return { logId: log.Id, hasMatch, element: logElement };
      } catch (error) {
        return { logId: log.Id, hasMatch: false, element: logElement };
      }
    });

    // Wait for all searches to complete
    const results = await Promise.all(searchPromises);

    // Apply results to UI
    let matchCount = 0;
    results.forEach(({ hasMatch, element }) => {
      if (!element) return;
      
      if (hasMatch) {
        element.classList.add('search-match');
        matchCount++;
      } else {
        element.classList.remove('search-match');
      }
    });

    // Update search results count
    if (searchResults) {
      if (matchCount === 0) {
        searchResults.textContent = 'No matches';
      } else if (matchCount === 1) {
        searchResults.textContent = '1 match';
      } else {
        searchResults.textContent = `${matchCount} matches`;
      }
    }
  }

  /**
   * Checks if a log contains the search term in its debug messages
   * @param {string} logId - Log ID to check
   * @param {string} searchTerm - Search term (already lowercased)
   * @returns {Promise<boolean>} True if log contains search term
   */
  async logContainsSearchTerm(logId, searchTerm) {
    try {
      // Try to get content from cache first
      let content = this.logContentCache.get(logId);
      
      // If not cached, fetch it
      if (!content) {
        content = await logLoader.getLogContent(logId);
        this.logContentCache.set(logId, content);
        
        // Limit cache size to prevent memory issues
        if (this.logContentCache.size > 50) {
          const firstKey = this.logContentCache.keys().next().value;
          this.logContentCache.delete(firstKey);
        }
      }

      // Extract debug messages
      const debugMessages = extractUserDebugBlocks(content);
      
      // Search through debug messages
      for (const message of debugMessages) {
        if (message.toLowerCase().includes(searchTerm)) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      // If we can't get content, treat as no match
      return false;
    }
  }

  /**
   * Clears the search highlighting
   */
  clearSearch() {
    this.searchTerm = '';
    
    // Remove all search-match classes
    document.querySelectorAll('.log-item.search-match').forEach(item => {
      item.classList.remove('search-match');
    });

    // Clear search results text
    const searchResults = document.getElementById('logSearchResults');
    if (searchResults) {
      searchResults.textContent = '';
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
    const hasErrorIndicator = (errorStatus === true) ? '<span class="has-error-indicator" title="Contains fatal errors">❗</span>' : '';
    
    const exceptionStatus = logCache.getExceptionStatus(log.Id);
    const hasExceptionIndicator = (exceptionStatus === true) ? '<span class="has-exception-indicator" title="Contains exceptions">⚠️</span>' : '';
    
    return `
    <div class="log-item ${this.selectedLogId === log.Id ? 'selected' : ''} ${expiredClass}" data-log-id="${log.Id}">
      <div class="log-header">
        <div class="log-id">${log.Id}${unreadIndicator}</div>
        <div class="log-time">
          ${expiredIndicator}${hasErrorIndicator}${hasExceptionIndicator}${hasDebugIndicator}
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
   * Adds the "See more logs" button to the logs list
   * @private
   */
  _addSeeMoreButton() {
    // Don't show the button if we don't have more logs or if we're already loading
    if (!hasMoreLogs || isLoadingMore) {
      return;
    }

    const existingBtn = document.getElementById('seeMoreLogsBtn');
    if (existingBtn) {
      existingBtn.remove();
    }

    const { logsList } = elements;
    const seeMoreBtn = document.createElement('div');
    seeMoreBtn.id = 'seeMoreLogsBtn';
    seeMoreBtn.className = 'see-more-logs-btn';
    seeMoreBtn.innerHTML = `
      <button class="button secondary" id="loadMoreBtn">
        <span class="button-text">See more logs</span>
        <span class="loading-spinner hidden">Loading...</span>
      </button>
    `;
    
    // Insert the button after the logs list
    logsList.parentNode.insertBefore(seeMoreBtn, logsList.nextSibling);
    
    // Add click event listener
    const loadMoreBtn = seeMoreBtn.querySelector('#loadMoreBtn');
    loadMoreBtn.addEventListener('click', async () => {
      if (typeof loadMoreLogs === 'function') {
        await loadMoreLogs();
      }
    });
  }

  /**
   * Updates the "See more logs" button state
   * @param {boolean} loading - Whether the button should show loading state
   */
  updateSeeMoreButtonState(loading) {
    const seeMoreBtn = document.getElementById('seeMoreLogsBtn');
    if (!seeMoreBtn) return;

    const loadMoreBtn = seeMoreBtn.querySelector('#loadMoreBtn');
    const buttonText = loadMoreBtn.querySelector('.button-text');
    const spinner = loadMoreBtn.querySelector('.loading-spinner');

    if (loading) {
      loadMoreBtn.disabled = true;
      buttonText.classList.add('hidden');
      spinner.classList.remove('hidden');
    } else {
      loadMoreBtn.disabled = false;
      buttonText.classList.remove('hidden');
      spinner.classList.add('hidden');
    }
  }

  /**
   * Removes the "See more logs" button
   */
  removeSeeMoreButton() {
    const existingBtn = document.getElementById('seeMoreLogsBtn');
    if (existingBtn) {
      existingBtn.remove();
    }
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
    logCache.setExceptionStatus(logId, false);
    this.displayDebugLogs(debugLogs);
  }
}

// Create singleton instance
const logRenderer = new LogRenderer();