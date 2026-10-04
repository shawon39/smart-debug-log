// Log Loading and API Operations
// This file handles loading debug logs from various sources and managing log content

// Incremental fetches look back this far before the last fetch: a log is saved when its transaction
// ends, but StartTime is when it began, so a long transaction can appear after a later one was fetched
const FETCH_OVERLAP_MS = 10 * 60 * 1000;
const FETCH_PAGE_SIZE = 500;
const MAX_INCREMENTAL_LOGS = 2000;

class LogLoader {
  constructor() {
    this.batchSize = 3;
    this.MAX_CACHED_LOGS = 1000; // Prevent unlimited growth
    this.cacheGeneration = 0; // Changes on clearCache(); a load that started before does not write the cache

    // Cleanup old cache entries on initialization
    setTimeout(() => this.cleanupOldCaches(), 1000);
  }

  /**
   * Get org-specific storage keys
   */
  _getOrgId() {
    return currentSession?.organizationId || currentSession?.orgId || sfHost;
  }

  _getLastFetchTimeKey(logType = this._getLogTypeFilter()) {
    const orgId = this._getOrgId();
    return orgId ? `lastFetchTime_${orgId}_${logType}` : null;
  }

  _getCachedLogsKey(logType = this._getLogTypeFilter()) {
    const orgId = this._getOrgId();
    return orgId ? `cachedLogs_${orgId}_${logType}` : null;
  }

  /**
   * Loads debug logs using smart caching with timestamp-based incremental updates.
   * Throws when the logs cannot be loaded (no session, no token, API error); zero logs is not an error.
   * @returns {Promise<Object>} { logs } - all logs of the current log type, newest first
   */
  async loadDebugLogs() {
    if (!currentSession || !sfHost) {
      const targetHost = getHostFromUrl();
      await checkConnectionStatus(targetHost);
      if (!currentSession) {
        throw new Error('No valid session found');
      }
    }

    // The log type and cache in use when this load started (the filter can change while it runs)
    const logType = this._getLogTypeFilter();
    const generation = this.cacheGeneration;

    // Prefer incremental update using last fetch time
    const cachedLogs = this._getCachedLogs(logType);
    const lastFetchTime = this._getLastFetchTime(logType);

    let allLogs = [];
    let freshestLogsForTimestamp = [];

    if (cachedLogs && cachedLogs.length > 0 && lastFetchTime) {
      // Incremental: fetch logs since the last fetch (with an overlap window)
      const newLogs = await this._fetchNewLogs(new Date(lastFetchTime), logType);
      allLogs = this._mergeNewLogs(newLogs, cachedLogs);
      freshestLogsForTimestamp = newLogs;
    } else {
      // Bootstrap cache: get recent first, then all if needed
      const recentLogs = await this._fetchRecentLogs(100, logType);
      if (recentLogs.length < 100) {
        allLogs = recentLogs;
      } else {
        if (cachedLogs && cachedLogs.length > 0) {
          allLogs = this._mergeNewLogs(recentLogs, cachedLogs);
        } else {
          const allLogsFromServer = await this._fetchAllLogs(logType).catch(() => null);
          allLogs = allLogsFromServer || recentLogs;
        }
      }
      freshestLogsForTimestamp = recentLogs.slice(0, 50);
    }

    // Update cache with all logs (unless the cache was cleared while this load ran)
    if (generation === this.cacheGeneration) {
      this._updateCache(allLogs.slice(0, this.MAX_CACHED_LOGS), freshestLogsForTimestamp, logType);
    }

    return { logs: allLogs.slice(0, this.MAX_CACHED_LOGS) };
  }

  /**
   * Public method to get cached logs
   */
  getCachedLogs() {
    return this._getCachedLogs();
  }

  /**
   * Clear cache for current org (useful for manual refresh)
   */
  clearCache() {
    const cacheKey = this._getCachedLogsKey();
    const timeKey = this._getLastFetchTimeKey();

    if (cacheKey) localStorage.removeItem(cacheKey);
    if (timeKey) localStorage.removeItem(timeKey);
    this.cacheGeneration++;
  }

  /**
   * Cleanup old cache entries to prevent unlimited growth
   */
  cleanupOldCaches() {
    try {
      const keysToRemove = [];

      // Scan all localStorage keys
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('cachedLogs_') || key.startsWith('lastFetchTime_'))) {
          keysToRemove.push(key);
        }
      }

      // Keep only recent ones (limit to 10 orgs)
      if (keysToRemove.length > 20) { // 10 orgs * 2 keys each
        keysToRemove.slice(0, keysToRemove.length - 20).forEach(key => {
          localStorage.removeItem(key);
        });
      }

      // Remove expired logs from every org cache (Monitoring logs live 7 days, System logs 24 hours)
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cachedLogs_')) {
          try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const logs = JSON.parse(raw);
            if (!Array.isArray(logs)) continue;
            const now = Date.now();
            const freshLogs = logs.filter(log => {
              try {
                const t = new Date(log.StartTime).getTime();
                return isFinite(t) && (now - t) <= getLogRetentionMs(log);
              } catch (_) {
                return true; // keep if unsure
              }
            });
            if (freshLogs.length !== logs.length) {
              localStorage.setItem(key, JSON.stringify(freshLogs));
            }
          } catch (_) {
            // ignore parsing errors
          }
        }
      }
    } catch (error) {
      // Cleanup failed, continue
    }
  }

  /**
   * Get current log type filter value
   */
  _getLogTypeFilter() {
    const logTypeFilter = document.getElementById('logTypeFilter');
    return logTypeFilter ? logTypeFilter.value : 'SystemLog';
  }

  /**
   * Cache management helper methods
   */
  _getCachedLogs(logType) {
    const cacheKey = this._getCachedLogsKey(logType);
    if (!cacheKey) return null;

    try {
      const cached = localStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      return null;
    }
  }

  _getLastFetchTime(logType) {
    const timeKey = this._getLastFetchTimeKey(logType);
    if (!timeKey) return null;

    try {
      const timestamp = localStorage.getItem(timeKey);
      return timestamp ? timestamp : null;
    } catch (error) {
      return null;
    }
  }

  _updateCache(allLogs, newLogs, logType) {
    const cacheKey = this._getCachedLogsKey(logType);
    const timeKey = this._getLastFetchTimeKey(logType);

    if (!cacheKey || !timeKey) return;

    try {
      // Limit cache size to prevent unlimited growth
      const logsToCache = allLogs.slice(0, this.MAX_CACHED_LOGS);

      // Store cached logs
      localStorage.setItem(cacheKey, JSON.stringify(logsToCache));

      // Store latest fetch time (from newest log), never moving it back
      if (newLogs && newLogs.length > 0) {
        // Ensure we persist a raw string so _getLastFetchTime can return it directly
        const latestLog = newLogs[0]; // Logs are ordered by StartTime DESC
        const previous = localStorage.getItem(timeKey);
        if (!previous || new Date(latestLog.StartTime) > new Date(previous)) {
          localStorage.setItem(timeKey, latestLog.StartTime);
        }
      }
    } catch (error) {
      // Storage failed, continue without caching
    }
  }

  // Logs since lastFetchTime (minus the overlap window), newest first. Pages past FETCH_PAGE_SIZE
  // with an upper StartTime bound, up to MAX_INCREMENTAL_LOGS; duplicates are removed by Id.
  async _fetchNewLogs(lastFetchTime, logType) {
    // Format timestamp for SOQL query (Salesforce format)
    const isoString = new Date(lastFetchTime.getTime() - FETCH_OVERLAP_MS).toISOString();
    const logs = [];
    const seenIds = new Set();
    let upperBound = '';

    while (logs.length < MAX_INCREMENTAL_LOGS) {
      const query = `SELECT Id, LogUserId, StartTime, LogLength, Application, Operation, DurationMilliseconds, Location 
                   FROM ApexLog 
                   WHERE StartTime >= ${isoString}${upperBound} AND Location = '${logType}'
                   ORDER BY StartTime DESC
                   LIMIT ${FETCH_PAGE_SIZE}`;
      const page = await this._executeQuery(query);
      const unseen = page.filter(log => !seenIds.has(log.Id));
      unseen.forEach(log => {
        seenIds.add(log.Id);
        logs.push(log);
      });

      // Stop when the page was not full, or it only had logs we already have (many logs with one StartTime)
      if (page.length < FETCH_PAGE_SIZE || unseen.length === 0) break;
      upperBound = ` AND StartTime <= ${new Date(page[page.length - 1].StartTime).toISOString()}`;
    }

    return logs.slice(0, MAX_INCREMENTAL_LOGS);
  }

  async _fetchAllLogs(logType) {
    const query = `SELECT Id, LogUserId, StartTime, LogLength, Application, Operation, DurationMilliseconds, Location 
                   FROM ApexLog 
                   WHERE Location = '${logType}'
                   ORDER BY StartTime DESC
                   LIMIT 1000`;

    return await this._executeQuery(query);
  }

  async _fetchRecentLogs(limit, logType) {
    const query = `SELECT Id, LogUserId, StartTime, LogLength, Application, Operation, DurationMilliseconds, Location 
                   FROM ApexLog 
                   WHERE Location = '${logType}'
                   ORDER BY StartTime DESC 
                   LIMIT ${limit}`;

    return await this._executeQuery(query);
  }

  _mergeNewLogs(newLogs, cachedLogs) {
    if (!cachedLogs || cachedLogs.length === 0) return newLogs;

    // Create set of existing log IDs to avoid duplicates
    const existingIds = new Set(cachedLogs.map(log => log.Id));
    const uniqueNewLogs = newLogs.filter(log => !existingIds.has(log.Id));

    // Merge: new logs first, then cached logs; newest first (a late log can be older than cached ones)
    return [...uniqueNewLogs, ...cachedLogs]
      .sort((a, b) => new Date(b.StartTime) - new Date(a.StartTime));
  }

  async _executeQuery(query) {
    // The background service worker (OAuth token) first
    try {
      return await this._loadFromRuntime(query);
    } catch (backgroundError) {
      // Fallback: a logged-in tab of the same org
      const records = await this._loadFromTabs(query);
      if (records) return records;
      throw backgroundError;
    }
  }

  /**
   * Gets content for a specific log
   * @param {string} logId - Log ID
   * @param {string} targetHost - Target Salesforce host
   * @returns {Promise<string>} Log content
   */
  async getLogContent(logId, targetHost = null) {
    try {
      // Dashboards opened without ?host= use the detected org (global sfHost)
      const host = targetHost || getHostFromUrl() || sfHost;
      const response = await chrome.runtime.sendMessage({
        type: 'GET_LOG_CONTENT',
        logId: logId,
        orgId: currentSession.orgId,
        targetHost: host,
        sfHost: host // For org-aware token selection
      });

      if (!response.success) {
        const error = new Error(response.error || response.message || 'Failed to load log content');
        errorHandler.handleApiError(error, 'get_log_content', { logId });
        throw error;
      }

      // An empty log body is an empty string
      return response.data?.content ?? '';
    } catch (error) {
      if (error.message.includes('chrome.runtime.sendMessage')) {
        const chromeError = errorHandler.handleChromeError(error, 'sendMessage');
        throw new Error(chromeError.userMessage);
      }
      throw error;
    }
  }

  /**
   * Progressively checks debug status for uncached logs
   * @param {Array} logs - Array of log objects
   * @param {Function} updateCallback - Callback to update UI for individual logs
   */
  async checkDebugStatusProgressive(logs, updateCallback) {
    const uncachedLogs = logCache.getUncachedLogs(logs);

    if (uncachedLogs.length === 0) {
      return;
    }

    // Process logs in batches to avoid overwhelming the system
    for (let i = 0; i < uncachedLogs.length; i += this.batchSize) {
      const batch = uncachedLogs.slice(i, i + this.batchSize);

      // Process each log in the batch using Promise.all for proper async handling
      const batchPromises = batch.map(async (log) => {
        try {
          const content = await this.getLogContent(log.Id);
          // One parse gives all three icons
          const parsed = parseDebugLogContent(content);

          logCache.setDebugStatus(log.Id, parsed.debugMessages.length > 0);
          logCache.setErrorStatus(log.Id, parsed.errors.hasFatalErrors);
          logCache.setExceptionStatus(log.Id, parsed.errors.hasExceptions);

          // Update UI immediately for this specific log
          if (updateCallback) {
            updateCallback(log.Id);
          }
        } catch (error) {
          // Status unknown: nothing is cached, so the next load checks this log again
        }
      });

      // Wait for all promises in the batch to complete
      await Promise.all(batchPromises);

      // Add delay between batches
      if (i + this.batchSize < uncachedLogs.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  /**
   * Loads logs from direct tab communication (only tabs of the dashboard's org)
   * @private
   * @param {string} query - SOQL query
   * @returns {Promise<Array|null>} Logs or null if failed
   */
  async _loadFromTabs(query) {
    try {
      const targetHost = getHostFromUrl() || sfHost;
      const sessionData = {
        sessionId: currentSession.key || currentSession.sessionId,
        instanceUrl: null // Will be set by tab manager
      };

      const result = await tabManager.findWorkingTabForQuery(targetHost, sessionData, query);
      return result?.records || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Loads logs using runtime tooling query (background service worker, OAuth token)
   * @private
   * @param {string} query - SOQL query
   * @returns {Promise<Array>} Logs; throws with the reason (e.g. NO_OAUTH_TOKEN or the API error) if failed
   */
  async _loadFromRuntime(query) {
    const response = await chrome.runtime.sendMessage({
      type: 'EXECUTE_TOOLING_QUERY',
      query: query,
      sfHost: getHostFromUrl() || sfHost // For org-aware token selection (dashboards without ?host= use the detected org)
    });

    if (response && response.success && response.data && Array.isArray(response.data.records)) {
      return response.data.records;
    }
    throw new Error(response?.error || response?.message || 'Could not load debug logs.');
  }
}

// Create singleton instance
const logLoader = new LogLoader();