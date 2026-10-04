// Log Rendering and UI Updates  
// This file handles rendering logs in the UI and managing visual states

class LogRenderer {
  constructor() {
    this.selectedLogId = null;
    this.searchTerm = '';
    this.searchDebounceTimer = null;
    this.logContentCache = new Map(); // Searchable text of log bodies (lower case), for log search
    this.logContentCacheSize = 0; // Total characters in logContentCache
    this.LOG_CONTENT_CACHE_MAX_SIZE = 50 * 1024 * 1024; // About 50 MB of log text
    this.SEARCH_MIN_CHARS = 2; // Minimum characters required to search
    this.SEARCH_CONCURRENCY = 3; // Log bodies downloaded at the same time while searching
    this.searchSequence = 0; // Increases with each search; results of older searches are ignored
    this.defaultEmptyState = null; // Title and text of the empty state in dashboard.html
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
   * @param {Error} [error] - Why the logs could not be loaded; without it the normal "no logs" text is shown
   */
  showEmptyState(error = null) {
    const { logsLoading, emptyState, logsList } = elements;
    logsLoading.classList.add('hidden');
    emptyState.classList.remove('hidden');
    logsList.innerHTML = '';

    const title = emptyState.querySelector('h4');
    const text = emptyState.querySelector('p');
    if (!this.defaultEmptyState) {
      this.defaultEmptyState = { title: title?.textContent || '', text: text?.textContent || '' };
    }
    const reason = error ? this.describeLoadError(error) : this.defaultEmptyState;
    if (title) title.textContent = reason.title;
    if (text) text.textContent = reason.text;
    emptyState.classList.toggle('is-error', !!error);
  }

  /**
   * Short explanation of why logs could not be loaded
   * @param {Error} error - Load error
   * @returns {{title: string, text: string}}
   */
  describeLoadError(error) {
    const message = String(error?.message || error || '');
    if (message.includes('NO_OAUTH_TOKEN')) {
      return { title: 'Access token needed', text: 'Use Generate Token above.' };
    }
    if (message === 'No valid session found') {
      return { title: 'Not connected', text: 'Log in to this org in a browser tab, or click Generate Token above. Then refresh.' };
    }
    return { title: 'Could not load logs', text: message.length > 300 ? `${message.slice(0, 300)}...` : (message || 'Please try again.') };
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

    // Event delegation: one click listener on the list (added once) handles all
    // items, so appended logs don't need per-item listeners or re-querying.
    if (logsList && !logsList.dataset.delegated) {
      logsList.dataset.delegated = 'true';
      logsList.addEventListener('click', (e) => {
        const item = e.target.closest('.log-item');
        if (item) this.selectDebugLog(item.getAttribute('data-log-id'));
      });
    }

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
      selectedLogIdElement.textContent = 'Loading...';
      selectedLogIdElement.title = '';
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

      // The user may have picked another log while this one was loading
      if (this.selectedLogId !== logId) return;

      // Extract and display user email
      if (selectedLogIdElement) {
        // Only the value is shown (the header is narrow); the tooltip says what it is
        const userEmail = extractUserEmailFromLog(content);
        selectedLogIdElement.textContent = userEmail || logId;
        selectedLogIdElement.title = userEmail ? `Log user: ${userEmail}` : `Log ID: ${logId}`;
      }

      if (!content) {
        debugContent.innerHTML = '<div class="info-message">This log is empty.</div>';
        if (errorContent) errorContent.innerHTML = '<div class="info-message">This log is empty.</div>';
        if (limitsContent) limitsContent.innerHTML = '';
        logCache.setDebugStatus(logId, false);
        logCache.setErrorStatus(logId, false);
        logCache.setExceptionStatus(logId, false);
        this.updateLogIndicator(logId);
        return;
      }

      // Store raw response data
      currentRawResponse = content;

      // Cache debug, error, and exception status for this log
      // (one parse; the debug and raw views below re-use it)
      const parsed = parseDebugLogContent(content);
      logCache.setDebugStatus(logId, parsed.debugMessages.length > 0);
      logCache.setErrorStatus(logId, parsed.errors.hasFatalErrors);
      logCache.setExceptionStatus(logId, parsed.errors.hasExceptions);

      // Show the new indicators on this log (re-rendering the list would also re-run the log search)
      this.updateLogIndicator(logId);

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
      if (this.selectedLogId !== logId) return;

      // Fallback to Log ID on error
      if (selectedLogIdElement) {
        selectedLogIdElement.textContent = logId;
        selectedLogIdElement.title = `Log ID: ${logId}`;
      }
      this._handleLogDetailsError(error);
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
      indicatorsHtml += `<span class="has-error-indicator" title="Contains fatal errors">${Icons.svg('octagonX', 13)}</span>`;
    }
    if (exceptionStatus) {
      indicatorsHtml += `<span class="has-exception-indicator" title="Contains exceptions">${Icons.svg('zap', 13)}</span>`;
    }
    if (debugStatus) {
      indicatorsHtml += `<span class="has-debug-indicator" title="Contains debug messages">${Icons.svg('messageCode', 13)}</span>`;
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

      // Check minimum character requirement to prevent performance issues
      if (searchTerm.length < this.SEARCH_MIN_CHARS) {
        // Show hint that minimum characters are required
        if (searchResults) {
          searchResults.textContent = `Type at least ${this.SEARCH_MIN_CHARS} characters`;
        }
        // Clear any existing matches
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

    const sequence = ++this.searchSequence;
    const term = searchTerm.toLowerCase();
    this.searchTerm = term;
    const searchResults = document.getElementById('logSearchResults');

    // Show searching indicator
    if (searchResults) {
      searchResults.textContent = 'Searching...';
    }

    // Search the listed logs, downloading at most SEARCH_CONCURRENCY bodies at a time
    const logsToSearch = [...debugLogs];
    const matches = new Map();
    let next = 0;
    const searchNextLog = async () => {
      while (next < logsToSearch.length && sequence === this.searchSequence) {
        const log = logsToSearch[next++];
        matches.set(log.Id, await this.logContainsSearchTerm(log.Id, term));
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.SEARCH_CONCURRENCY, logsToSearch.length) }, searchNextLog));

    // A newer search (or clearing the search) replaced this one
    if (sequence !== this.searchSequence) return;

    // Apply results to UI
    let matchCount = 0;
    document.querySelectorAll('.log-item').forEach(element => {
      const hasMatch = matches.get(element.getAttribute('data-log-id')) === true;
      element.classList.toggle('search-match', hasMatch);
      if (hasMatch) matchCount++;
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
   * Checks if a log contains the search term in its searchable content
   * Uses smart filtering to search relevant log content while excluding noise
   * @param {string} logId - Log ID to check
   * @param {string} searchTerm - Search term (already lowercased)
   * @returns {Promise<boolean>} True if log contains search term
   */
  async logContainsSearchTerm(logId, searchTerm) {
    try {
      // Try to get the searchable text from cache first
      let searchableContent = this.logContentCache.get(logId);

      // If not cached, fetch the log and keep its smart-filtered, lower-case text (whole log)
      if (searchableContent === undefined) {
        const content = await logLoader.getLogContent(logId);
        searchableContent = extractSearchableContent(content).toLowerCase();
        this._cacheSearchableContent(logId, searchableContent);
      }

      // Perform case-insensitive search
      return searchableContent.includes(searchTerm);

    } catch (error) {
      // If we can't get content, treat as no match
      return false;
    }
  }

  /**
   * Keeps searchable log text, dropping the oldest entries when the cache gets bigger than its size limit
   * @private
   */
  _cacheSearchableContent(logId, text) {
    if (text.length > this.LOG_CONTENT_CACHE_MAX_SIZE) return;
    const previous = this.logContentCache.get(logId);
    if (previous !== undefined) {
      this.logContentCache.delete(logId);
      this.logContentCacheSize -= previous.length;
    }
    this.logContentCache.set(logId, text);
    this.logContentCacheSize += text.length;
    for (const [key, value] of this.logContentCache) {
      if (this.logContentCacheSize <= this.LOG_CONTENT_CACHE_MAX_SIZE) break;
      this.logContentCache.delete(key);
      this.logContentCacheSize -= value.length;
    }
  }

  /**
   * Clears the search highlighting
   */
  clearSearch() {
    this.searchTerm = '';
    this.searchSequence++; // Results of a search still running are ignored

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
    // Salesforce keeps Monitoring logs for 7 days and System logs for 24 hours
    const isLikelyExpired = (now - logTime) > getLogRetentionMs(log);
    const retentionText = log.Location === 'Monitoring' ? '7 days' : '24 hours';

    const expiredClass = isLikelyExpired ? 'log-item-expired' : '';
    const expiredIndicator = isLikelyExpired ? `<span class="expired-indicator" title="This log may have expired (older than ${retentionText})">${Icons.svg('clock', 13)}</span>` : '';

    // Check if this log is unread
    const isUnread = !isLogRead(log.Id);
    const unreadIndicator = isUnread ? '<span class="unread-indicator" title="Unread log"></span>' : '';

    // Check cache for indicators
    const debugStatus = logCache.getDebugStatus(log.Id);
    const hasDebugIndicator = (debugStatus === true) ? `<span class="has-debug-indicator" title="Contains debug messages">${Icons.svg('messageCode', 13)}</span>` : '';

    const errorStatus = logCache.getErrorStatus(log.Id);
    const hasErrorIndicator = (errorStatus === true) ? `<span class="has-error-indicator" title="Contains fatal errors">${Icons.svg('octagonX', 13)}</span>` : '';

    const exceptionStatus = logCache.getExceptionStatus(log.Id);
    const hasExceptionIndicator = (exceptionStatus === true) ? `<span class="has-exception-indicator" title="Contains exceptions">${Icons.svg('zap', 13)}</span>` : '';

    return `
    <div class="log-item ${this.selectedLogId === log.Id ? 'selected' : ''} ${expiredClass}" data-log-id="${log.Id}">
      <div class="log-header">
        <span class="log-operation" title="${escapeHtml(log.Operation || 'Unknown')}">${escapeHtml(log.Operation || 'Unknown')}</span>
        <div class="log-time">
          ${expiredIndicator}${hasErrorIndicator}${hasExceptionIndicator}${hasDebugIndicator}
          ${formatDateTimeWithHighlight(log.StartTime)}
        </div>
      </div>
      <div class="log-details">
        <span class="log-id"><span class="log-id-text">${escapeHtml(log.Id)}</span>${unreadIndicator}</span>
        <span class="log-duration">${log.DurationMilliseconds || 0} ms</span>
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
   */
  _handleLogDetailsError(error) {
    const { debugContent, errorContent, limitsContent } = elements;

    const escapedMessage = escapeHtml(error.message || '');
    let errorMessage = 'Failed to load debug log content.';

    if (error.message && error.message.includes('not found or expired')) {
      errorMessage = `
        <div class="error-message-block">
          <strong>Debug Log Expired</strong><br>
          This debug log is no longer available. Salesforce keeps monitoring logs for 7 days and system logs for 24 hours, and logs can also be deleted.<br>
          <small>Try generating a new debug log to view recent execution details.</small>
        </div>
      `;
    } else if (escapedMessage) {
      errorMessage = `<div class="error-message">Error: ${escapedMessage}</div>`;
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

    // Nothing is cached for this log: its status is unknown, so it is checked again later
  }
}

// Create singleton instance
const logRenderer = new LogRenderer();