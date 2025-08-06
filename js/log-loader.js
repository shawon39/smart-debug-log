// Log Loading and API Operations
// This file handles loading debug logs from various sources and managing log content

class LogLoader {
  constructor() {
    this.batchSize = 3;
    this.maxConcurrentChecks = 3;
    this.checkTimeout = 5000;
  }

  /**
   * Loads debug logs from Salesforce
   * @param {number} offset - Number of logs to skip (for pagination)
   * @param {boolean} checkForMore - Whether to check if more logs exist (fetches limit+1)
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

    // Use limit dropdown for initial load, fixed increment for subsequent loads
    const limit = offset === 0 ? parseInt(elements.logLimit.value) : 10;
    
    // For initial load with checkForMore, fetch one extra log to check if more exist
    const fetchLimit = checkForMore && offset === 0 ? limit + 1 : limit;
    const query = `SELECT Id, LogUserId, StartTime, LogLength, Application, Operation, DurationMilliseconds 
                   FROM ApexLog 
                   ORDER BY StartTime DESC 
                   LIMIT ${fetchLimit} OFFSET ${offset}`;

    let result = null;

    // Try direct tab communication first
    const tabResult = await this._loadFromTabs(query);
    if (tabResult) {
      result = tabResult;
    } else {
      // Try background service worker with recent logs
      const backgroundResult = await this._loadFromBackground(offset, fetchLimit);
      if (backgroundResult) {
        result = backgroundResult;
      } else {
        // Try runtime message for tooling query
        const runtimeResult = await this._loadFromRuntime(query);
        if (runtimeResult) {
          result = runtimeResult;
        }
      }
    }

    if (!result) {
      throw new Error('No logs found from any source');
    }

    // If checkForMore is enabled and this is initial load, return structured response
    if (checkForMore && offset === 0) {
      const hasMore = result.length > limit;
      const logs = hasMore ? result.slice(0, limit) : result;
      return { logs, hasMore };
    }

    // For backward compatibility, return just the logs array
    return result;
  }

  /**
   * Loads more debug logs for pagination
   * @param {number} offset - Number of logs to skip
   * @returns {Promise<Array>} Array of additional debug logs
   */
  async loadMoreDebugLogs(offset) {
    return await this.loadDebugLogs(offset);
  }

  /**
   * Gets content for a specific log
   * @param {string} logId - Log ID
   * @param {string} targetHost - Target Salesforce host
   * @returns {Promise<string>} Log content
   */
  async getLogContent(logId, targetHost = null) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_LOG_CONTENT',
        logId: logId,
        orgId: currentSession.orgId,
        targetHost: targetHost || getHostFromUrl()
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
        session: currentSession
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