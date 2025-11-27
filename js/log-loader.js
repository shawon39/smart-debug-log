// Log Loading and API Operations
// This file handles loading debug logs from various sources and managing log content

class LogLoader {
  constructor() {
    this.batchSize = 3;
    this.maxConcurrentChecks = 3;
    this.checkTimeout = 5000;
    this.MAX_CACHED_LOGS = 1000; // Prevent unlimited growth
    
    // Cleanup old cache entries on initialization
    setTimeout(() => this.cleanupOldCaches(), 1000);
  }

  /**
   * Get org-specific storage keys
   */
  _getOrgId() {
    return currentSession?.organizationId || currentSession?.orgId || sfHost;
  }

  _getLastFetchTimeKey() {
    const orgId = this._getOrgId();
    const logType = this._getLogTypeFilter();
    return orgId ? `lastFetchTime_${orgId}_${logType}` : null;
  }

  _getCachedLogsKey() {
    const orgId = this._getOrgId();
    const logType = this._getLogTypeFilter();
    return orgId ? `cachedLogs_${orgId}_${logType}` : null;
  }

  /**
   * Loads debug logs using smart caching with timestamp-based incremental updates
   * @param {number} offset - Number of logs to skip (for pagination - used with cached data)
   * @param {boolean} checkForMore - Whether to check if more logs exist 
   * @returns {Promise<Array|Object>} Array of debug logs, or object with {logs, hasMore} if checkForMore is true
   */
  async loadDebugLogs(offset = 0, checkForMore = false) {
    if (!currentSession || !sfHost) {
      const targetHost = getHostFromUrl();
      await checkConnectionStatus(targetHost);
      if (!currentSession) {
        throw new Error('No valid session found');
      }
    }

    // For pagination (offset > 0), use cached data only
    if (offset > 0) {
      return this._getFromCache(offset, checkForMore);
    }

    // For initial load (offset = 0), prefer incremental update using last fetch time
    const cachedLogs = this._getCachedLogs();
    const lastFetchTime = this._getLastFetchTime();

    let allLogs = [];
    let freshestLogsForTimestamp = [];

    if (cachedLogs && cachedLogs.length > 0 && lastFetchTime) {
      // Incremental: fetch only logs newer than last fetch
      const newLogs = await this._fetchNewLogs(new Date(lastFetchTime));
      const safeNewLogs = Array.isArray(newLogs) ? newLogs : [];
      allLogs = this._mergeNewLogs(safeNewLogs, cachedLogs);
      freshestLogsForTimestamp = safeNewLogs;
    } else {
      // Bootstrap cache: get recent first, then all if needed
      const recentLogs = await this._fetchRecentLogs(100);
      if (!recentLogs || recentLogs.length === 0) {
        throw new Error('No logs found from any source');
      }
      if (recentLogs.length < 100) {
        allLogs = recentLogs;
      } else {
        if (cachedLogs && cachedLogs.length > 0) {
          allLogs = this._mergeNewLogs(recentLogs, cachedLogs);
        } else {
          const allLogsFromServer = await this._fetchAllLogs();
          allLogs = allLogsFromServer || recentLogs;
        }
      }
      freshestLogsForTimestamp = recentLogs.slice(0, 50);
    }

    // Update cache with all logs
    this._updateCache(allLogs.slice(0, this.MAX_CACHED_LOGS), freshestLogsForTimestamp);

    // For initial load, we don't need to paginate here since log-display.js handles it
    // Just return a success indicator that logs are cached
    return { logs: allLogs, hasMore: false, cached: true };
  }

  /**
   * Loads more debug logs for pagination (uses cached data)
   * @param {number} offset - Number of logs to skip
   * @returns {Promise<Array>} Array of additional debug logs
   */
  async loadMoreDebugLogs(offset) {
    return await this._getFromCache(offset, false);
  }

  /**
   * Public method to get cached logs (used by pagination)
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
  }

  /**
   * Clear cache for current org and all log types (used when log type changes)
   */
  clearAllLogTypeCaches() {
    const orgId = this._getOrgId();
    if (!orgId) return;
    
    const logTypes = ['SystemLog', 'Monitoring'];
    logTypes.forEach(logType => {
      const cacheKey = `cachedLogs_${orgId}_${logType}`;
      const timeKey = `lastFetchTime_${orgId}_${logType}`;
      localStorage.removeItem(cacheKey);
      localStorage.removeItem(timeKey);
    });
  }

  /**
   * Force refresh - clear cache and reload from server
   */
  async forceRefresh() {
    this.clearCache();
    return await this.loadDebugLogs(0, true);
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

      // Remove expired logs (>24h) from every org cache
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cachedLogs_')) {
          try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const logs = JSON.parse(raw);
            if (!Array.isArray(logs)) continue;
            const now = Date.now();
            const twentyFourHoursMs = 24 * 60 * 60 * 1000;
            const freshLogs = logs.filter(log => {
              try {
                const t = new Date(log.StartTime).getTime();
                return isFinite(t) && (now - t) <= twentyFourHoursMs;
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
  _getCachedLogs() {
    const cacheKey = this._getCachedLogsKey();
    if (!cacheKey) return null;
    
    try {
      const cached = localStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      return null;
    }
  }

  _getLastFetchTime() {
    const timeKey = this._getLastFetchTimeKey();
    if (!timeKey) return null;
    
    try {
      const timestamp = localStorage.getItem(timeKey);
      return timestamp ? timestamp : null;
    } catch (error) {
      return null;
    }
  }

  _updateCache(allLogs, newLogs) {
    const cacheKey = this._getCachedLogsKey();
    const timeKey = this._getLastFetchTimeKey();
    
    if (!cacheKey || !timeKey) return;

    try {
      // Limit cache size to prevent unlimited growth
      const logsToCache = allLogs.slice(0, this.MAX_CACHED_LOGS);

      // Store cached logs
      localStorage.setItem(cacheKey, JSON.stringify(logsToCache));

      // Store latest fetch time (from newest log)
      if (newLogs && newLogs.length > 0) {
        // Ensure we persist a raw string so _getLastFetchTime can return it directly
        const latestLog = newLogs[0]; // Logs are ordered by StartTime DESC
        localStorage.setItem(timeKey, latestLog.StartTime);
      }
    } catch (error) {
      // Storage failed, continue without caching
    }
  }

  async _fetchNewLogs(lastFetchTime) {
    if (!lastFetchTime) return null;

    // Format timestamp for SOQL query (Salesforce format)
    const isoString = lastFetchTime.toISOString();
    const logType = this._getLogTypeFilter();
    const query = `SELECT Id, LogUserId, StartTime, LogLength, Application, Operation, DurationMilliseconds, Location 
                   FROM ApexLog 
                   WHERE StartTime > ${isoString} AND Location = '${logType}'
                   ORDER BY StartTime DESC`;

    return await this._executeQuery(query);
  }

  async _fetchAllLogs() {
    const logType = this._getLogTypeFilter();
    const query = `SELECT Id, LogUserId, StartTime, LogLength, Application, Operation, DurationMilliseconds, Location 
                   FROM ApexLog 
                   WHERE Location = '${logType}'
                   ORDER BY StartTime DESC`;

    return await this._executeQuery(query);
  }

  async _fetchRecentLogs(limit = 50) {
    const logType = this._getLogTypeFilter();
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
    
    // Merge: new logs first, then cached logs
    return [...uniqueNewLogs, ...cachedLogs];
  }

  _paginateResults(allLogs, offset, checkForMore) {
    const limit = offset === 0 ? parseInt(elements.logLimit?.value || 25) : 10;
    
    if (checkForMore && offset === 0) {
      const hasMore = allLogs.length > limit;
      const logs = allLogs.slice(0, limit);
      return { logs, hasMore };
    }
    
    return allLogs.slice(offset, offset + limit);
  }

  _getFromCache(offset, checkForMore) {
    const cachedLogs = this._getCachedLogs();
    if (!cachedLogs) {
      return checkForMore ? { logs: [], hasMore: false } : [];
    }
    
    return this._paginateResults(cachedLogs, offset, checkForMore);
  }

  async _executeQuery(query) {
    // Try direct tab communication first
    let result = await this._loadFromTabs(query);
    if (result) return result;

    // Try background service worker
    result = await this._loadFromBackground(0, 999999); // Large limit for "fetch all"
    if (result) return result;

    // Try runtime message
    result = await this._loadFromRuntime(query);
    if (result) return result;

    return null;
  }

  /**
   * Gets content for a specific log
   * @param {string} logId - Log ID
   * @param {string} targetHost - Target Salesforce host
   * @returns {Promise<string>} Log content
   */
  async getLogContent(logId, targetHost = null) {
    try {
      const sfHost = targetHost || getHostFromUrl();
      const response = await chrome.runtime.sendMessage({
        type: 'GET_LOG_CONTENT',
        logId: logId,
        orgId: currentSession.orgId,
        targetHost: sfHost,
        sfHost: sfHost // For org-aware token selection
      });

      if (!response.success) {
        const error = new Error(response.error || response.message || 'Failed to load log content');
        errorHandler.handleApiError(error, 'get_log_content', { logId });
        throw error;
      }

      return response.data.content || response.data;
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
      
      // Process each log in the batch independently
      batch.forEach(async (log) => {
        try {
          const content = await this.getLogContent(log.Id);
          const hasDebugMsgs = hasDebugMessages(content);
          const hasErrorMsgs = hasErrors(content);
          
          logCache.setDebugStatus(log.Id, hasDebugMsgs);
          logCache.setErrorStatus(log.Id, hasErrorMsgs);
          
          // Update UI immediately for this specific log
          if (updateCallback) {
            updateCallback(log.Id);
          }
        } catch (error) {
          // If there's an error, assume no debug messages
          logCache.setDebugStatus(log.Id, false);
          logCache.setErrorStatus(log.Id, false);
          
          if (updateCallback) {
            updateCallback(log.Id);
          }
        }
      });
      
      // Add delay between batches
      if (i + this.batchSize < uncachedLogs.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  /**
   * Checks debug status for a limited number of logs (legacy method)
   * @param {Array} logs - Array of log objects
   */
  async checkDebugStatusLimited(logs) {
    const uncachedLogs = logCache.getUncachedLogs(logs);
    
    if (uncachedLogs.length === 0) {
      return;
    }

    const logsToCheck = uncachedLogs.slice(0, this.maxConcurrentChecks);
    
    const checkPromises = logsToCheck.map(async (log) => {
      try {
        const content = await this.getLogContent(log.Id);
        const hasDebugMsgs = hasDebugMessages(content);
        const hasErrorMsgs = hasErrors(content);
        
        logCache.setDebugStatus(log.Id, hasDebugMsgs);
        logCache.setErrorStatus(log.Id, hasErrorMsgs);
      } catch (error) {
        logCache.setDebugStatus(log.Id, false);
        logCache.setErrorStatus(log.Id, false);
      }
    });

    try {
      await Promise.race([
        Promise.all(checkPromises),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), this.checkTimeout))
      ]);
    } catch (error) {
      // Some checks failed or timed out, but that's okay
    }
  }

  /**
   * Loads logs from direct tab communication
   * @private
   * @param {string} query - SOQL query
   * @returns {Promise<Array|null>} Logs or null if failed
   */
  async _loadFromTabs(query) {
    try {
      const targetHost = getHostFromUrl();
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
   * Loads logs from background service worker
   * @private
   * @param {number} offset - Number of logs to skip (for pagination)
   * @param {number} limit - Number of logs to fetch
   * @returns {Promise<Array|null>} Logs or null if failed
   */
  async _loadFromBackground(offset = 0, limit = 10) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_RECENT_LOGS',
        orgId: currentSession.orgId,
        limit: limit,
        offset: offset
      });

      if (response.success && response.data && response.data.length > 0) {
        return response.data;
      }
    } catch (error) {
      // Failed
    }
    
    return null;
  }

  /**
   * Loads logs using runtime tooling query
   * @private
   * @param {string} query - SOQL query
   * @returns {Promise<Array|null>} Logs or null if failed
   */
  async _loadFromRuntime(query) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EXECUTE_TOOLING_QUERY',
        query: query,
        session: currentSession,
        sfHost: getHostFromUrl() // For org-aware token selection
      });

      if (response.success && response.data && response.data.records) {
        return response.data.records;
      }
    } catch (error) {
      // Failed
    }
    
    return null;
  }
}

// Create singleton instance
const logLoader = new LogLoader();