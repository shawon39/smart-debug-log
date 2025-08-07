// Log Cache Management
// This file handles caching of log data, debug status, and error status with size limits

class LogCache {
  constructor() {
    this.debugStatusCache = new Map();
    this.errorStatusCache = new Map();
    this.maxCacheSize = 1000; // Maximum number of entries per cache
    this.cleanupThreshold = 800; // When to start cleanup
    this._loadedOrgId = null;
  }

  /**
   * Ensure caches are loaded for current org from persistent storage
   * @private
   */
  _ensureOrgLoaded() {
    const orgId = this._getOrgId();
    if (orgId && this._loadedOrgId !== orgId) {
      this._loadStatusesFromStorage();
    }
  }

  /**
   * Get current org id for namespacing storage
   * @private
   */
  _getOrgId() {
    try {
      // These globals are provided elsewhere in the app
      // eslint-disable-next-line no-undef
      const orgId = (typeof currentSession !== 'undefined' && currentSession && (currentSession.organizationId || currentSession.orgId))
        // eslint-disable-next-line no-undef
        || (typeof sfHost !== 'undefined' && sfHost)
        || null;
      return orgId;
    } catch (e) {
      return null;
    }
  }

  /**
   * Storage key for statuses for current org
   * @private
   */
  _getStatusStorageKey() {
    const orgId = this._getOrgId();
    return orgId ? `logStatus_${orgId}` : null;
  }

  /**
   * Load statuses from localStorage into in-memory caches for current org
   * @private
   */
  _loadStatusesFromStorage() {
    const key = this._getStatusStorageKey();
    if (!key) return;
    try {
      const json = localStorage.getItem(key);
      this.debugStatusCache.clear();
      this.errorStatusCache.clear();
      if (json) {
        const data = JSON.parse(json);
        if (Array.isArray(data)) {
          // Legacy unsupported format; ignore
        } else if (data && typeof data === 'object') {
          // Drop entries older than 24h to keep cache lean
          const now = Date.now();
          const twentyFourHoursMs = 24 * 60 * 60 * 1000;
          Object.entries(data).forEach(([logId, status]) => {
            if (!logId || !status || typeof status !== 'object') return;
            const updatedAt = typeof status.updatedAt === 'number' ? status.updatedAt : now;
            if ((now - updatedAt) > twentyFourHoursMs) return;
            if (typeof status.hasDebug === 'boolean') {
              this.debugStatusCache.set(logId, status.hasDebug);
            }
            if (typeof status.hasError === 'boolean') {
              this.errorStatusCache.set(logId, status.hasError);
            }
          });
        }
      }
      this._loadedOrgId = this._getOrgId();
    } catch (e) {
      // ignore
      this._loadedOrgId = this._getOrgId();
    }
  }

  /**
   * Save in-memory caches to localStorage for current org
   * @private
   */
  _saveStatusesToStorage() {
    const key = this._getStatusStorageKey();
    if (!key) return;
    try {
      const now = Date.now();
      const result = {};
      // Merge both caches into a single object keyed by logId
      this.debugStatusCache.forEach((hasDebug, logId) => {
        if (!result[logId]) result[logId] = { updatedAt: now };
        result[logId].hasDebug = hasDebug;
      });
      this.errorStatusCache.forEach((hasError, logId) => {
        if (!result[logId]) result[logId] = { updatedAt: now };
        result[logId].hasError = hasError;
      });
      // Prune entries older than 24h just before saving
      const twentyFourHoursMs = 24 * 60 * 60 * 1000;
      const pruned = {};
      Object.entries(result).forEach(([logId, status]) => {
        const ts = typeof status.updatedAt === 'number' ? status.updatedAt : now;
        if ((now - ts) <= twentyFourHoursMs) {
          pruned[logId] = status;
        }
      });
      localStorage.setItem(key, JSON.stringify(pruned));
      this._loadedOrgId = this._getOrgId();
    } catch (e) {
      // ignore
    }
  }

  /**
   * Gets debug message status from cache
   * @param {string} logId - Log ID
   * @returns {boolean|undefined} Debug status or undefined if not cached
   */
  getDebugStatus(logId) {
    this._ensureOrgLoaded();
    return this.debugStatusCache.get(logId);
  }

  /**
   * Sets debug message status in cache
   * @param {string} logId - Log ID
   * @param {boolean} hasDebugMessages - Whether log has debug messages
   */
  setDebugStatus(logId, hasDebugMessages) {
    this._ensureOrgLoaded();
    this._ensureCacheSize(this.debugStatusCache);
    this.debugStatusCache.set(logId, hasDebugMessages);
    this._saveStatusesToStorage();
  }

  /**
   * Gets error status from cache
   * @param {string} logId - Log ID
   * @returns {boolean|undefined} Error status or undefined if not cached
   */
  getErrorStatus(logId) {
    this._ensureOrgLoaded();
    return this.errorStatusCache.get(logId);
  }

  /**
   * Sets error status in cache
   * @param {string} logId - Log ID
   * @param {boolean} hasErrors - Whether log has errors
   */
  setErrorStatus(logId, hasErrors) {
    this._ensureOrgLoaded();
    this._ensureCacheSize(this.errorStatusCache);
    this.errorStatusCache.set(logId, hasErrors);
    this._saveStatusesToStorage();
  }

  /**
   * Checks if log has cached debug status
   * @param {string} logId - Log ID
   * @returns {boolean} True if cached
   */
  hasDebugStatus(logId) {
    this._ensureOrgLoaded();
    return this.debugStatusCache.has(logId);
  }

  /**
   * Checks if log has cached error status
   * @param {string} logId - Log ID
   * @returns {boolean} True if cached
   */
  hasErrorStatus(logId) {
    this._ensureOrgLoaded();
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
    this._ensureOrgLoaded();
    this.debugStatusCache.clear();
    this.errorStatusCache.clear();
    this._saveStatusesToStorage();
  }

  /**
   * Clears cache for specific log
   * @param {string} logId - Log ID to clear
   */
  clearLog(logId) {
    this._ensureOrgLoaded();
    this.debugStatusCache.delete(logId);
    this.errorStatusCache.delete(logId);
    this._saveStatusesToStorage();
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
    this._ensureOrgLoaded();
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
    this._ensureOrgLoaded();
    updates.forEach(({ logId, hasDebugMessages, hasErrors }) => {
      if (hasDebugMessages !== undefined) {
        this.setDebugStatus(logId, hasDebugMessages);
      }
      if (hasErrors !== undefined) {
        this.setErrorStatus(logId, hasErrors);
      }
    });
    this._saveStatusesToStorage();
  }
}

// Create singleton instance  
const logCache = new LogCache();

// Legacy compatibility - maintain access to cache Maps for existing code
let logDebugStatusCache = logCache.debugStatusCache;
let logErrorStatusCache = logCache.errorStatusCache;