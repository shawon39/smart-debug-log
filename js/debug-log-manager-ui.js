// Debug Log Manager UI
// Handles Debug Levels, Trace Flags, and log management via Salesforce Tooling API

class DebugLogManagerUI {
  constructor() {
    this.currentSession = null;
    this.userId = null;
    this.sfHost = null; // Salesforce host for multi-org support
    this.debugLevels = [];
    this.traceFlags = [];
    this.currentTraceFlag = null;
    this.timerInterval = null;
    this.DEFAULT_DURATION_MINUTES = 60;
    // User selection
    this.selectedUserId = null;
    this.selectedUserName = null;
    this.useOtherUser = false;
    this.searchTimeout = null;
    // Debug Level Creator
    this.debugLevelCreator = null;
  }

  async initialize(session) {
    this.currentSession = session;
    // Extract sfHost from URL for multi-org support
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

  // API Methods
  async toolingQuery(query) {
    const response = await chrome.runtime.sendMessage({
      type: 'EXECUTE_TOOLING_QUERY',
      query,
      sfHost: this.sfHost
    });
    if (!response || !response.success) {
      throw new Error(response?.error || 'Query failed');
    }
    return response.data;
  }

  async toolingCreate(sobjectType, data) {
    const response = await chrome.runtime.sendMessage({
      type: 'TOOLING_CREATE',
      sobjectType,
      data,
      sfHost: this.sfHost
    });
    if (!response || !response.success) {
      throw new Error(response?.error || 'Create failed');
    }
    return response.data;
  }

  async toolingUpdate(sobjectType, recordId, data) {
    const response = await chrome.runtime.sendMessage({
      type: 'TOOLING_UPDATE',
      sobjectType,
      recordId,
      data,
      sfHost: this.sfHost
    });
    if (!response || !response.success) {
      throw new Error(response?.error || 'Update failed');
    }
    return response.data;
  }

  async toolingDelete(sobjectType, recordId) {
    const response = await chrome.runtime.sendMessage({
      type: 'TOOLING_DELETE',
      sobjectType,
      recordId,
      sfHost: this.sfHost
    });
    if (!response || !response.success) {
      throw new Error(response?.error || 'Delete failed');
    }
    return response.data;
  }

  // User Search Methods
  async searchUsers(searchTerm) {
    const response = await chrome.runtime.sendMessage({
      type: 'SEARCH_USERS',
      searchTerm,
      sfHost: this.sfHost
    });
    if (!response || !response.success) {
      throw new Error(response?.error || 'User search failed');
    }
    return response.data;
  }

  selectUser(userId, userName) {
    this.selectedUserId = userId;
    this.selectedUserName = userName;
    this.useOtherUser = true;
    
    // Update UI
    const selectedDisplay = document.getElementById('selectedUserDisplay');
    const selectedName = document.getElementById('selectedUserName');
    const searchResults = document.getElementById('userSearchResults');
    
    if (selectedDisplay && selectedName) {
      selectedName.textContent = userName;
      selectedDisplay.classList.remove('hidden');
    }
    
    if (searchResults) {
      searchResults.classList.add('hidden');
    }
    
    // Update trace flags for selected user
    this.refreshTraceFlagsForSelectedUser();
  }

  clearSelectedUser() {
    // Reset to current user
    this.selectedUserId = this.userId;
    this.selectedUserName = 'Current User';
    this.useOtherUser = false;
    
    // Update UI
    const selectedDisplay = document.getElementById('selectedUserDisplay');
    const searchInput = document.getElementById('userSearchInput');
    const currentUserRadio = document.getElementById('currentUserRadio');
    
    if (selectedDisplay) {
      selectedDisplay.classList.add('hidden');
    }
    
    if (searchInput) {
      searchInput.value = '';
    }
    
    if (currentUserRadio) {
      currentUserRadio.checked = true;
    }
    
    this.toggleUserSearchUI(false);
    this.refreshTraceFlagsForSelectedUser();
  }

  toggleUserSearchUI(showSearch) {
    const searchContainer = document.getElementById('userSearchContainer');
    if (searchContainer) {
      if (showSearch) {
        searchContainer.classList.remove('hidden');
      } else {
        searchContainer.classList.add('hidden');
      }
    }
  }

  renderUserSearchResults(users) {
    const container = document.getElementById('userSearchResults');
    if (!container) return;
    
    if (users.length === 0) {
      container.innerHTML = '<div class="user-search-empty">No users found</div>';
      container.classList.remove('hidden');
      return;
    }
    
    container.innerHTML = '';
    container.classList.remove('hidden');
    
    users.forEach(user => {
      const item = document.createElement('div');
      item.className = 'user-result-item';
      item.innerHTML = `
        <div class="user-result-name">${this.escapeHtml(user.Name)}</div>
        <div class="user-result-username">${this.escapeHtml(user.Username)}</div>
      `;
      item.addEventListener('click', () => this.selectUser(user.Id, user.Name));
      container.appendChild(item);
    });
  }

  async handleUserSearch() {
    const searchInput = document.getElementById('userSearchInput');
    const container = document.getElementById('userSearchResults');
    const searchTerm = searchInput?.value?.trim();
    
    if (!searchTerm || searchTerm.length < 2) {
      if (container) container.classList.add('hidden');
      return;
    }
    
    try {
      if (container) {
        container.innerHTML = '<div class="user-search-loading">Searching...</div>';
        container.classList.remove('hidden');
      }
      
      const users = await this.searchUsers(searchTerm);
      this.renderUserSearchResults(users);
    } catch (error) {
      console.error('User search error:', error);
      if (container) {
        container.innerHTML = `<div class="user-search-empty">Search failed: ${error.message}</div>`;
      }
    }
  }

  async refreshTraceFlagsForSelectedUser() {
    // Update current trace flag based on selected user
    await this.listTraceFlags();
    this.currentTraceFlag = this.traceFlags.find(tf => tf.TracedEntityId === this.selectedUserId);
    this.renderTraceFlags();
  }

  getTargetUserId() {
    return this.useOtherUser && this.selectedUserId ? this.selectedUserId : this.userId;
  }

  // Debug Levels Methods
  async listDebugLevels() {
    const query = `SELECT Id, DeveloperName, MasterLabel, ApexCode, Database, System, Workflow, Visualforce, Callout 
                   FROM DebugLevel ORDER BY MasterLabel`;
    const result = await this.toolingQuery(query);
    this.debugLevels = result.records || [];
    return this.debugLevels;
  }

  async getOrCreateDefaultDebugLevel() {
    // First try to find SFDC_DevConsole (the default one)
    const existing = this.debugLevels.find(d => d.DeveloperName === 'SFDC_DevConsole');
    if (existing) {
      return existing.Id;
    }
    
    // If no levels exist, return the first available
    if (this.debugLevels.length > 0) {
      return this.debugLevels[0].Id;
    }
    
    // Create a default debug level
    const data = {
      DeveloperName: 'ExtensionDebug',
      MasterLabel: 'Extension Debug',
      ApexCode: 'FINEST',
      ApexProfiling: 'INFO',
      Database: 'INFO',
      System: 'DEBUG',
      Workflow: 'INFO',
      Validation: 'INFO',
      Callout: 'INFO',
      Visualforce: 'INFO'
    };
    
    const created = await this.toolingCreate('DebugLevel', data);
    await this.listDebugLevels();
    return created.id;
  }

  // Trace Flags Methods
  async listTraceFlags() {
    const query = `SELECT Id, TracedEntityId, TracedEntity.Name, LogType, 
                   StartDate, ExpirationDate, DebugLevelId, DebugLevel.DeveloperName
                   FROM TraceFlag 
                   WHERE LogType = 'USER_DEBUG'
                   ORDER BY ExpirationDate DESC`;
    const result = await this.toolingQuery(query);
    this.traceFlags = result.records || [];
    
    // Find trace flag for the selected/target user
    const targetUserId = this.getTargetUserId();
    this.currentTraceFlag = this.traceFlags.find(tf => tf.TracedEntityId === targetUserId);
    
    return this.traceFlags;
  }

  async createOrExtendTraceFlag(debugLevelId, durationMinutes = 60) {
    const targetUserId = this.getTargetUserId();
    if (!targetUserId) {
      throw new Error('User ID not available');
    }
    
    // Check if target user already has an active trace flag
    const existingFlag = this.traceFlags.find(tf => tf.TracedEntityId === targetUserId);
    if (existingFlag) {
      // Extend existing trace flag instead of creating new one
      await this.extendTraceFlag(existingFlag.Id, durationMinutes);
      return { extended: true };
    }
    
    const now = new Date();
    const expiration = new Date(now.getTime() + durationMinutes * 60 * 1000);
    
    const data = {
      TracedEntityId: targetUserId,
      LogType: 'USER_DEBUG',
      DebugLevelId: debugLevelId,
      StartDate: now.toISOString(),
      ExpirationDate: expiration.toISOString()
    };
    
    try {
      const result = await this.toolingCreate('TraceFlag', data);
      await this.listTraceFlags();
      return result;
    } catch (error) {
      // Handle "already being traced" error
      if (error.message && error.message.includes('already being traced')) {
        // Refresh trace flags and try to extend
        await this.listTraceFlags();
        const refreshedFlag = this.traceFlags.find(tf => tf.TracedEntityId === targetUserId);
        if (refreshedFlag) {
          await this.extendTraceFlag(refreshedFlag.Id, durationMinutes);
          return { extended: true };
        }
      }
      throw error;
    }
  }

  async extendTraceFlag(traceFlagId, additionalMinutes = 60) {
    const traceFlag = this.traceFlags.find(tf => tf.Id === traceFlagId);
    if (!traceFlag) {
      throw new Error('Trace flag not found');
    }
    
    const currentExpiration = new Date(traceFlag.ExpirationDate);
    const now = new Date();
    
    // If already expired, extend from now
    const baseTime = currentExpiration > now ? currentExpiration : now;
    const newExpiration = new Date(baseTime.getTime() + additionalMinutes * 60 * 1000);
    
    await this.toolingUpdate('TraceFlag', traceFlagId, {
      ExpirationDate: newExpiration.toISOString()
    });
    
    await this.listTraceFlags();
  }

  async reduceTraceFlag(traceFlagId, reduceMinutes = 60) {
    const traceFlag = this.traceFlags.find(tf => tf.Id === traceFlagId);
    if (!traceFlag) {
      throw new Error('Trace flag not found');
    }
    
    const currentExpiration = new Date(traceFlag.ExpirationDate);
    const now = new Date();
    const remainingMs = currentExpiration - now;
    const reduceMs = reduceMinutes * 60 * 1000;
    
    // If reducing would result in ≤0 time, delete the trace flag instead
    if (remainingMs <= reduceMs) {
      await this.deleteTraceFlag(traceFlagId);
      return { disabled: true };
    }
    
    const newExpiration = new Date(currentExpiration.getTime() - reduceMs);
    
    await this.toolingUpdate('TraceFlag', traceFlagId, {
      ExpirationDate: newExpiration.toISOString()
    });
    
    await this.listTraceFlags();
    return { disabled: false };
  }

  async deleteTraceFlag(traceFlagId) {
    await this.toolingDelete('TraceFlag', traceFlagId);
    await this.listTraceFlags();
  }

  // Debug Logs Methods
  async deleteAllDebugLogs() {
    if (!this.userId) {
      throw new Error('User ID not available');
    }
    
    // Get all logs for current user
    const query = `SELECT Id FROM ApexLog WHERE LogUserId = '${this.userId}'`;
    const result = await this.toolingQuery(query);
    const logs = result.records || [];
    
    if (logs.length === 0) {
      return { deleted: 0 };
    }
    
    // Delete logs one by one (Tooling API doesn't support bulk delete well)
    let deleted = 0;
    let errors = [];
    
    for (const log of logs) {
      try {
        await this.toolingDelete('ApexLog', log.Id);
        deleted++;
      } catch (error) {
        errors.push(error.message);
      }
    }
    
    return { deleted, total: logs.length, errors };
  }

  // Timer Methods
  startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => this.renderTraceFlags(), 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // UI Rendering Methods
  renderDebugLevels() {
    const select = document.getElementById('debugLevelSelect');
    if (!select) return;
    
    // Clear existing options except the placeholder
    select.innerHTML = '<option value="">Select Debug Level...</option>';
    
    if (this.debugLevels.length === 0) {
      return;
    }
    
    this.debugLevels.forEach(level => {
      const option = document.createElement('option');
      option.value = level.Id;
      option.textContent = level.MasterLabel || level.DeveloperName;
      select.appendChild(option);
    });
    
    // Do not auto-select anything - leave it empty
  }

  renderTraceFlags() {
    const container = document.getElementById('traceFlagsList');
    if (!container) return;
    
    if (this.traceFlags.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div>No trace flags found</div>
        </div>
      `;
      return;
    }
    
    container.innerHTML = '';
    
    const targetUserId = this.getTargetUserId();
    
    this.traceFlags.forEach(tf => {
      const item = document.createElement('div');
      item.className = 'trace-flag-item';
      
      const isCurrentUser = tf.TracedEntityId === this.userId;
      const isSelectedUser = tf.TracedEntityId === targetUserId;
      
      // Highlight selected user (which may be current user or other user)
      if (isSelectedUser) {
        item.classList.add('current-user');
      }
      
      const expiration = new Date(tf.ExpirationDate);
      const now = new Date();
      const isExpired = expiration <= now;
      const expiresInMs = expiration - now;
      const expiresInMinutes = Math.max(0, Math.floor(expiresInMs / 60000));
      
      let expiresClass = '';
      let expiresText = '';
      let statusIndicator = '';
      
      if (isExpired) {
        expiresClass = 'expired';
        expiresText = 'Expired';
        statusIndicator = '<span class="trace-status-dot expired" title="Expired"></span>';
      } else if (expiresInMinutes >= 60) {
        // Show hours and minutes format
        const hours = Math.floor(expiresInMinutes / 60);
        const minutes = expiresInMinutes % 60;
        if (minutes === 0) {
          expiresText = `${hours} hour${hours !== 1 ? 's' : ''} left`;
        } else {
          expiresText = `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} min left`;
        }
        if (expiresInMinutes < 300) { // Less than 5 hours
          expiresClass = 'expiring-soon';
        }
        statusIndicator = '<span class="trace-status-dot active" title="Active"></span>';
      } else if (expiresInMinutes < 5) {
        expiresClass = 'expiring-soon';
        expiresText = `${expiresInMinutes} min left`;
        statusIndicator = '<span class="trace-status-dot active" title="Active"></span>';
      } else {
        expiresText = `${expiresInMinutes} min left`;
        statusIndicator = '<span class="trace-status-dot active" title="Active"></span>';
      }
      
      const userName = tf.TracedEntity?.Name || 'Unknown User';
      const debugLevelName = tf.DebugLevel?.DeveloperName || 'Unknown';
      
      // Badge: "You" for current user, "Selected" for other selected user
      let badge = '';
      if (isCurrentUser) {
        badge = '<span class="current-badge">You</span>';
      } else if (isSelectedUser && this.useOtherUser) {
        badge = '<span class="current-badge">Selected</span>';
      }
      
      item.innerHTML = `
        <div class="trace-flag-info">
          <div class="trace-flag-user">
            ${statusIndicator}
            ${this.escapeHtml(userName)}
            ${badge}
          </div>
          <div class="trace-flag-meta">
            <span class="trace-flag-level">${this.escapeHtml(debugLevelName)}</span>
            <span class="trace-flag-expires ${expiresClass}">${expiresText}</span>
          </div>
        </div>
        <div class="trace-flag-actions">
          <button class="button secondary extend-btn" data-id="${tf.Id}">Extend (+60min)</button>
          <button class="button secondary reduce-btn" data-id="${tf.Id}">Reduce (-60min)</button>
          <button class="button secondary delete-btn" data-id="${tf.Id}">Delete</button>
        </div>
      `;
      
      container.appendChild(item);
    });
    
    // Add event listeners for action buttons
    container.querySelectorAll('.extend-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleExtendTraceFlag(e.target.dataset.id));
    });
    
    container.querySelectorAll('.reduce-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleReduceTraceFlag(e.target.dataset.id));
    });
    
    container.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleDeleteTraceFlag(e.target.dataset.id));
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Event Handlers
  async handleEnableDebug() {
    const btn = document.getElementById('enableDebugBtn');
    const durationSelect = document.getElementById('debugDurationSelect');
    const originalText = btn.textContent;
    
    try {
      btn.disabled = true;
      btn.textContent = 'Creating...';
      
      // Get selected duration in minutes
      const durationMinutes = parseInt(durationSelect?.value || '60', 10);
      const durationHours = durationMinutes / 60;
      
      const debugLevelId = document.getElementById('debugLevelSelect').value;
      let result;
      
      if (!debugLevelId) {
        const defaultId = await this.getOrCreateDefaultDebugLevel();
        result = await this.createOrExtendTraceFlag(defaultId, durationMinutes);
      } else {
        result = await this.createOrExtendTraceFlag(debugLevelId, durationMinutes);
      }
      
      this.renderTraceFlags();
      this.startTimer();
      
      // Set log type to Monitoring after trace flag creation
      const logTypeFilter = document.getElementById('logTypeFilter');
      if (logTypeFilter) {
        logTypeFilter.value = 'Monitoring';
        // Save the preference
        if (typeof savePreferences === 'function') {
          await savePreferences();
        }
      }
      
      // Show appropriate message with user name and duration
      const userName = this.useOtherUser && this.selectedUserName ? this.selectedUserName : 'you';
      const durationText = durationHours === 1 ? '1 hour' : `${durationHours} hours`;
      
      if (result && result.extended) {
        this.showNotification(`Debug logging extended by ${durationText} for ${userName}`, 'success');
      } else {
        this.showNotification(`Debug logging enabled for ${durationText} for ${userName}`, 'success');
      }
      
    } catch (error) {
      console.error('Failed to enable debug:', error);
      
      // User-friendly error messages
      let message = 'Failed to enable debug logging.';
      if (error.message.includes('already being traced')) {
        message = 'Debug logging is already active. Use the Extend button to extend.';
      } else if (error.message.includes('Access token required')) {
        message = 'Please generate an access token first.';
      }
      
      this.showNotification(message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
  
  // Show notification toast
  showNotification(message, type = 'info') {
    // Remove existing notification
    const existing = document.querySelector('.debug-notification');
    if (existing) existing.remove();
    
    const notification = document.createElement('div');
    notification.className = `debug-notification ${type}`;
    notification.textContent = message;
    
    const modal = document.querySelector('.debug-log-manager-content');
    if (modal) {
      modal.insertBefore(notification, modal.firstChild);
      
      // Auto-remove after 4 seconds
      setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
      }, 4000);
    }
  }

  async handleExtendTraceFlag(traceFlagId) {
    try {
      await this.extendTraceFlag(traceFlagId || this.currentTraceFlag?.Id, this.DEFAULT_DURATION_MINUTES);
      this.renderTraceFlags();
      this.showNotification('Extended by 60 minutes', 'success');
    } catch (error) {
      console.error('Failed to extend trace flag:', error);
      this.showNotification('Failed to extend: ' + error.message, 'error');
    }
  }

  async handleReduceTraceFlag(traceFlagId) {
    if (!traceFlagId) return;
    
    try {
      const result = await this.reduceTraceFlag(traceFlagId, this.DEFAULT_DURATION_MINUTES);
      this.renderTraceFlags();
      
      if (result && result.disabled) {
        this.showNotification('Debug logging disabled (time reduced to 0)', 'info');
      } else {
        this.showNotification('Reduced by 60 minutes', 'success');
      }
    } catch (error) {
      console.error('Failed to reduce time:', error);
      this.showNotification('Failed to reduce: ' + error.message, 'error');
    }
  }

  async handleDeleteTraceFlag(traceFlagId) {
    if (!confirm('Are you sure you want to delete this trace flag?')) {
      return;
    }
    
    try {
      await this.deleteTraceFlag(traceFlagId);
      this.renderTraceFlags();
    } catch (error) {
      console.error('Failed to delete trace flag:', error);
      alert('Failed to delete: ' + error.message);
    }
  }

  async handleDisableDebug() {
    if (!this.currentTraceFlag) return;
    
    if (!confirm('Are you sure you want to disable debug logging?')) {
      return;
    }
    
    try {
      await this.deleteTraceFlag(this.currentTraceFlag.Id);
      this.renderTraceFlags();
    } catch (error) {
      console.error('Failed to disable debug:', error);
      alert('Failed to disable: ' + error.message);
    }
  }

  async handleDeleteAllLogs() {
    if (!confirm('Are you sure you want to delete ALL debug logs?\n\nThis action cannot be undone.')) {
      return;
    }
    
    const btn = document.getElementById('deleteAllLogsBtn');
    const originalText = btn.textContent;
    
    try {
      btn.disabled = true;
      btn.textContent = 'Deleting...';
      
      const result = await this.deleteAllDebugLogs();
      
      if (result.deleted > 0) {
        this.showNotification(`Deleted ${result.deleted} debug log(s)`, 'success');
        
        // Clear the log cache
        if (typeof logLoader !== 'undefined' && logLoader.clearCache) {
          logLoader.clearCache();
        }
        
        // Clear the logs list display
        const logsList = document.getElementById('logsList');
        if (logsList) {
          logsList.innerHTML = '';
        }
        
        // Show empty state
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
          emptyState.classList.remove('hidden');
        }
        
        // Update total count
        const totalLogsCount = document.getElementById('totalLogsCount');
        if (totalLogsCount) {
          totalLogsCount.textContent = '0';
        }
        
        // Refresh the main dashboard logs
        if (typeof loadDebugLogs === 'function') {
          await loadDebugLogs();
        }
      } else {
        this.showNotification('No debug logs found to delete', 'info');
      }
      
    } catch (error) {
      console.error('Failed to delete logs:', error);
      this.showNotification('Failed to delete logs: ' + error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // Modal Methods
  async openModal() {
    const modal = document.getElementById('debugLogManagerModal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    
    // Load user info if not already loaded
    if (!this.userId) {
      await this.loadUserInfo();
    }
    
    // Initialize Debug Level Creator if not already initialized
    if (!this.debugLevelCreator && window.DebugLevelCreator) {
      this.debugLevelCreator = new window.DebugLevelCreator(this);
      this.debugLevelCreator.setupEventListeners();
    }
    
    // Load data
    try {
      await this.listDebugLevels();
      await this.listTraceFlags();
      
      this.renderDebugLevels();
      this.renderTraceFlags();
      this.startTimer();
    } catch (error) {
      console.error('Failed to load debug log manager data:', error);
    }
  }

  closeModal() {
    const modal = document.getElementById('debugLogManagerModal');
    if (modal) {
      modal.style.display = 'none';
    }
    this.stopTimer();
  }

  setupModalEventListeners() {
    // Close modal button
    const closeBtn = document.getElementById('closeDebugLogManagerBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }

    // Close modal when clicking outside
    const modal = document.getElementById('debugLogManagerModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeModal();
        }
      });
    }

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('debugLogManagerModal');
        if (modal && modal.style.display === 'flex') {
          this.closeModal();
        }
      }
    });

    // Enable Debug button
    const enableBtn = document.getElementById('enableDebugBtn');
    enableBtn?.addEventListener('click', () => this.handleEnableDebug());
    
    // Delete All Logs button
    const deleteAllBtn = document.getElementById('deleteAllLogsBtn');
    deleteAllBtn?.addEventListener('click', () => this.handleDeleteAllLogs());

    // User selection event listeners
    const currentUserRadio = document.getElementById('currentUserRadio');
    const otherUserRadio = document.getElementById('otherUserRadio');
    
    if (currentUserRadio) {
      currentUserRadio.addEventListener('change', () => {
        if (currentUserRadio.checked) {
          this.clearSelectedUser();
        }
      });
    }
    
    if (otherUserRadio) {
      otherUserRadio.addEventListener('change', () => {
        if (otherUserRadio.checked) {
          this.toggleUserSearchUI(true);
          this.useOtherUser = true;
        }
      });
    }

    // User search input
    const userSearchInput = document.getElementById('userSearchInput');
    if (userSearchInput) {
      userSearchInput.addEventListener('input', () => {
        // Debounce search
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => this.handleUserSearch(), 300);
      });
      
      userSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleUserSearch();
        }
      });
    }

    const userSearchBtn = document.getElementById('userSearchBtn');
    if (userSearchBtn) {
      userSearchBtn.addEventListener('click', () => this.handleUserSearch());
    }

    const clearSelectedUserBtn = document.getElementById('clearSelectedUserBtn');
    if (clearSelectedUserBtn) {
      clearSelectedUserBtn.addEventListener('click', () => this.clearSelectedUser());
    }
  }
}

// Global instance
window.debugLogManagerUI = new DebugLogManagerUI();

