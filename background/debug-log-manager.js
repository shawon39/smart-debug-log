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
}

export default DebugLogManager; 