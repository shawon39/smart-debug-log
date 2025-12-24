/**
 * Debug Log Manager UI
 * Handles Debug Levels, Trace Flags, and log management via Salesforce Tooling API
 * Core class definition and initialization.
 */

class DebugLogManagerUI {
  constructor() {
    this.currentSession = null;
    this.userId = null;
    this.sfHost = null; // Salesforce host for multi-org support
    this.debugLevels = [];
    this.traceFlags = [];
    this.currentTraceFlag = null;
    this.timerInterval = null;
    this.statusIndicatorTimer = null; // Timer for status indicator updates
    this.DEFAULT_DURATION_MINUTES = 45;

    // User selection
    this.selectedUserId = null;
    this.selectedUserName = null;
    this.useOtherUser = false;
    this.searchTimeout = null;

    // Debug Level Creator
    this.debugLevelCreator = null;

    // Trace flags search
    this.traceFlagsSearchTerm = '';
  }

  async initialize(session) {
    this.currentSession = session;
    this.sfHost = this.extractSfHostFromUrl();
    await this.loadUserInfo();
    // Default to current user
    this.selectedUserId = this.userId;
    this.selectedUserName = 'Current User';
  }

  // Extract sfHost from URL parameter
  extractSfHostFromUrl() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('host') || null;
    } catch {
      return null;
    }
  }

  async loadUserInfo() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_USER_INFO',
        sfHost: this.sfHost
      });
      if (response && response.success) {
        this.userId = response.data.userId;
      }
    } catch (error) {
      console.error('Failed to load user info:', error);
    }
  }

  getTargetUserId() {
    return this.useOtherUser && this.selectedUserId ? this.selectedUserId : this.userId;
  }

  isDebugLevelDevConsole(debugLevelId) {
    const debugLevel = this.debugLevels.find(dl => dl.Id === debugLevelId);
    return debugLevel?.DeveloperName === 'SFDC_DevConsole';
  }

  async refreshTraceFlagsForSelectedUser() {
    await this.listTraceFlags();
    const targetUserId = this.getTargetUserId();
    this.currentTraceFlag = this.traceFlags.find(tf => tf.TracedEntityId === targetUserId);
    this.renderTraceFlags();
  }
}

// Global instance
window.debugLogManagerUI = new DebugLogManagerUI();
