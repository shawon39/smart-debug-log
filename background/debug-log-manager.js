class DebugLogManager {
  constructor() {
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;
    this.isInitialized = true;
  }

  async getRecentLogs(orgId, limit = 20) {
    try {
      const storageKey = `debug-logs-${orgId}`;
      const result = await chrome.storage.local.get(storageKey);
      const logs = result[storageKey] || [];

      return logs.slice(0, limit);
    } catch (error) {
      return [];
    }
  }

  async removeLogsByIds(orgId, logIds) {
    try {
      const storageKey = `debug-logs-${orgId}`;
      const result = await chrome.storage.local.get(storageKey);
      const logs = result[storageKey] || [];

      // Filter out deleted log IDs
      const logIdSet = new Set(logIds);
      const filteredLogs = logs.filter(log => !logIdSet.has(log.Id));

      // Update storage
      await chrome.storage.local.set({ [storageKey]: filteredLogs });

      return filteredLogs;
    } catch (error) {
      console.error('Failed to remove logs from cache:', error);
      return [];
    }
  }
}

export default DebugLogManager; 