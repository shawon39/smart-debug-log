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
   * @returns {Promise<Array>} Array of debug logs
   */
  async loadDebugLogs() {
    if (!currentSession || !sfHost) {
      const targetHost = getHostFromUrl();
      await checkConnectionStatus(targetHost);
      if (!currentSession) {
        throw new Error('No valid session found');
      }
    }

    const query = `SELECT Id, LogUserId, StartTime, LogLength, Application, Operation, DurationMilliseconds 
                   FROM ApexLog 
                   ORDER BY StartTime DESC 
                   LIMIT ${parseInt(elements.logLimit.value)}`;

    // Try direct tab communication first
    const tabResult = await this._loadFromTabs(query);
    if (tabResult) {
      return tabResult;
    }

    // Try background service worker with recent logs
    const backgroundResult = await this._loadFromBackground();
    if (backgroundResult) {
      return backgroundResult;
    }

    // Try runtime message for tooling query
    const runtimeResult = await this._loadFromRuntime(query);
    if (runtimeResult) {
      return runtimeResult;
    }

    throw new Error('No logs found from any source');
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
   * @returns {Promise<Array|null>} Logs or null if failed
   */
  async _loadFromBackground() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_RECENT_LOGS',
        orgId: currentSession.orgId,
        limit: parseInt(elements.logLimit.value)
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