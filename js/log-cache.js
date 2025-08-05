// Log Cache Management
// This file handles caching of log data, debug status, and error status with size limits

class LogCache {
  constructor() {
    this.debugStatusCache = new Map();
    this.errorStatusCache = new Map();
    this.maxCacheSize = 1000; // Maximum number of entries per cache
    this.cleanupThreshold = 800; // When to start cleanup
  }

  /**
   * Gets debug message status from cache
   * @param {string} logId - Log ID
   * @returns {boolean|undefined} Debug status or undefined if not cached
   */
  getDebugStatus(logId) {
    return this.debugStatusCache.get(logId);
  }

  /**
   * Sets debug message status in cache
   * @param {string} logId - Log ID
   * @param {boolean} hasDebugMessages - Whether log has debug messages
   */
  setDebugStatus(logId, hasDebugMessages) {
    this._ensureCacheSize(this.debugStatusCache);
    this.debugStatusCache.set(logId, hasDebugMessages);
  }

  /**
   * Gets error status from cache
   * @param {string} logId - Log ID
   * @returns {boolean|undefined} Error status or undefined if not cached
   */
  getErrorStatus(logId) {
    return this.errorStatusCache.get(logId);
  }

  /**
   * Sets error status in cache
   * @param {string} logId - Log ID
   * @param {boolean} hasErrors - Whether log has errors
   */
  setErrorStatus(logId, hasErrors) {
    this._ensureCacheSize(this.errorStatusCache);
    this.errorStatusCache.set(logId, hasErrors);
  }

  /**
   * Checks if log has cached debug status
   * @param {string} logId - Log ID
   * @returns {boolean} True if cached
   */
  hasDebugStatus(logId) {
    return this.debugStatusCache.has(logId);
  }

  /**
   * Checks if log has cached error status
   * @param {string} logId - Log ID
   * @returns {boolean} True if cached
   */
  hasErrorStatus(logId) {
    return this.errorStatusCache.has(logId);
  }

  /**
   * Gets cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    return {
      debugCacheSize: this.debugStatusCache.size,
      errorCacheSize: this.errorStatusCache.size,
      maxCacheSize: this.maxCacheSize,
      cleanupThreshold: this.cleanupThreshold
    };
  }

  /**
   * Clears all caches
   */
  clearAll() {
    this.debugStatusCache.clear();
    this.errorStatusCache.clear();
  }

  /**
   * Clears cache for specific log
   * @param {string} logId - Log ID to clear
   */
  clearLog(logId) {
    this.debugStatusCache.delete(logId);
    this.errorStatusCache.delete(logId);
  }

  /**
   * Ensures cache doesn't exceed size limits
   * @private
   * @param {Map} cache - Cache to check
   */
  _ensureCacheSize(cache) {
    if (cache.size >= this.maxCacheSize) {
      this._cleanupCache(cache);
    }
  }

  /**
   * Removes oldest entries from cache
   * @private
   * @param {Map} cache - Cache to cleanup
   */
  _cleanupCache(cache) {
    const entriesArray = Array.from(cache.entries());
    const entriesToKeep = entriesArray.slice(-this.cleanupThreshold);
    
    cache.clear();
    entriesToKeep.forEach(([key, value]) => {
      cache.set(key, value);
    });
  }

  /**
   * Gets uncached logs from a list
   * @param {Array} logs - Array of log objects
   * @returns {Array} Logs that don't have cached status and aren't cleared
   */
  getUncachedLogs(logs) {
    return logs.filter(log => 
      (!this.hasDebugStatus(log.Id) || !this.hasErrorStatus(log.Id)) &&
      !isLogCleared(log.Id)
    );
  }

  /**
   * Bulk update cache for multiple logs
   * @param {Array} updates - Array of {logId, hasDebugMessages, hasErrors}
   */
  bulkUpdate(updates) {
    updates.forEach(({ logId, hasDebugMessages, hasErrors }) => {
      if (hasDebugMessages !== undefined) {
        this.setDebugStatus(logId, hasDebugMessages);
      }
      if (hasErrors !== undefined) {
        this.setErrorStatus(logId, hasErrors);
      }
    });
  }
}

// Create singleton instance  
const logCache = new LogCache();

// Legacy compatibility - maintain access to cache Maps for existing code
let logDebugStatusCache = logCache.debugStatusCache;
let logErrorStatusCache = logCache.errorStatusCache;