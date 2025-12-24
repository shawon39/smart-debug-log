/**
 * Debug Log Manager UI - Rendering and Event Handlers
 * Extends DebugLogManagerUI prototype with UI-related logic.
 */

DebugLogManagerUI.prototype.selectUser = function (userId, userName) {
    this.selectedUserId = userId;
    this.selectedUserName = userName;
    this.useOtherUser = true;

    const selectedDisplay = document.getElementById('selectedUserDisplay');
    const selectedName = document.getElementById('selectedUserName');
    const searchResults = document.getElementById('userSearchResults');

    if (selectedDisplay && selectedName) {
        selectedName.textContent = userName;
        selectedDisplay.classList.remove('hidden');
    }
    if (searchResults) searchResults.classList.add('hidden');
    this.refreshTraceFlagsForSelectedUser();
};

DebugLogManagerUI.prototype.clearSelectedUser = function () {
    this.selectedUserId = this.userId;
    this.selectedUserName = 'Current User';
    this.useOtherUser = false;

    const selectedDisplay = document.getElementById('selectedUserDisplay');
    const searchInput = document.getElementById('userSearchInput');
    const currentUserRadio = document.getElementById('currentUserRadio');

    if (selectedDisplay) selectedDisplay.classList.add('hidden');
    if (searchInput) searchInput.value = '';
    if (currentUserRadio) currentUserRadio.checked = true;

    this.toggleUserSearchUI(false);
    this.refreshTraceFlagsForSelectedUser();
};

DebugLogManagerUI.prototype.renderUserSearchResults = function (users) {
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
};

DebugLogManagerUI.prototype.handleUserSearch = async function () {
    const input = document.getElementById('userSearchInput'), container = document.getElementById('userSearchResults');
    const term = input?.value?.trim();

    if (!term || term.length < 2) {
        if (container) container.classList.add('hidden');
        return;
    }

    try {
        if (container) {
            container.innerHTML = '<div class="user-search-loading">Searching...</div>';
            container.classList.remove('hidden');
        }
        const users = await this.searchUsers(term);
        this.renderUserSearchResults(users);
    } catch (error) {
        console.error('User search error:', error);
        if (container) container.innerHTML = `<div class="user-search-empty">Search failed: ${error.message}</div>`;
    }
};

DebugLogManagerUI.prototype.toggleUserSearchUI = function (show) {
    const container = document.getElementById('userSearchContainer');
    if (container) container.classList.toggle('hidden', !show);
};

// Timer Methods
DebugLogManagerUI.prototype.startTimer = function () {
    this.stopTimer();
    this.timerInterval = setInterval(() => this.renderTraceFlags(), 1000);
};

DebugLogManagerUI.prototype.stopTimer = function () {
    if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
    }
};

// Status Indicator Methods
DebugLogManagerUI.prototype.startStatusIndicatorTimer = function () {
    this.stopStatusIndicatorTimer();
    this.statusIndicatorTimer = setInterval(() => this.updateStatusIndicator(), 1000);
};

DebugLogManagerUI.prototype.stopStatusIndicatorTimer = function () {
    if (this.statusIndicatorTimer) {
        clearInterval(this.statusIndicatorTimer);
        this.statusIndicatorTimer = null;
    }
};

DebugLogManagerUI.prototype.updateStatusIndicator = async function () {
    const indicator = document.getElementById('traceStatusIndicator');
    const dot = document.getElementById('traceStatusDot');
    const text = document.getElementById('traceStatusText');

    if (!indicator || !dot || !text) return;

    const targetUserId = this.userId;
    if (!targetUserId) {
        indicator.style.display = 'none';
        return;
    }

    const now = new Date();
    const scheduledTraceFlag = this.traceFlags.find(tf => {
        const startDate = new Date(tf.StartDate);
        return tf.TracedEntityId === targetUserId && startDate > now;
    });

    if (scheduledTraceFlag) {
        const startDate = new Date(scheduledTraceFlag.StartDate);
        const expiration = new Date(scheduledTraceFlag.ExpirationDate);
        const startsInMs = startDate - now;
        const startsInMinutes = Math.max(0, Math.floor(startsInMs / 60000));
        const debugLevelName = scheduledTraceFlag.DebugLevel?.DeveloperName || 'Unknown';

        const startTimeStr = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const endTimeStr = expiration.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

        let timeText = '';
        if (startsInMinutes >= 60) {
            const hours = Math.floor(startsInMinutes / 60);
            const minutes = startsInMinutes % 60;
            timeText = minutes === 0 ? `starts in ${hours}h` : `starts in ${hours}h ${minutes}m`;
        } else if (startsInMinutes === 0) {
            timeText = `starting now`;
        } else {
            timeText = `starts in ${startsInMinutes}m`;
        }
        timeText += ` <span class="schedule-range">(${startTimeStr} - ${endTimeStr})</span>`;

        indicator.className = 'trace-status-indicator scheduled';
        text.innerHTML = `Scheduled: ${timeText} • ${debugLevelName}`;
        indicator.style.display = 'inline-flex';
    } else {
        const activeTraceFlag = this.traceFlags.find(tf => {
            const startDate = new Date(tf.StartDate);
            const expiration = new Date(tf.ExpirationDate);
            return tf.TracedEntityId === targetUserId && startDate <= now && expiration > now;
        });

        if (activeTraceFlag) {
            const expiration = new Date(activeTraceFlag.ExpirationDate);
            const remainingMs = expiration - now;
            const remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));
            const debugLevelName = activeTraceFlag.DebugLevel?.DeveloperName || 'Unknown';

            let timeText = '';
            if (remainingMinutes >= 60) {
                const hours = Math.floor(remainingMinutes / 60);
                const minutes = remainingMinutes % 60;
                timeText = minutes === 0 ? `${hours}h left` : `${hours}h ${minutes}m left`;
            } else {
                timeText = `${remainingMinutes}m left`;
            }

            indicator.className = 'trace-status-indicator active';
            text.textContent = `Active: ${timeText} • ${debugLevelName}`;
            indicator.style.display = 'inline-flex';
        } else {
            const expiredTraceFlag = this.traceFlags.find(tf => {
                const expiration = new Date(tf.ExpirationDate);
                return tf.TracedEntityId === targetUserId && expiration <= now;
            });

            if (expiredTraceFlag) {
                const expiration = new Date(expiredTraceFlag.ExpirationDate);
                const expiredMs = now - expiration;
                const expiredMinutes = Math.floor(expiredMs / 60000);
                const debugLevelName = expiredTraceFlag.DebugLevel?.DeveloperName || 'Unknown';

                let expiredTimeText = '';
                if (expiredMinutes < 60) {
                    expiredTimeText = expiredMinutes <= 1 ? 'just now' : `${expiredMinutes}m ago`;
                } else if (expiredMinutes < 1440) {
                    expiredTimeText = `${Math.floor(expiredMinutes / 60)}h ago`;
                } else {
                    expiredTimeText = `${Math.floor(expiredMinutes / 1440)}d ago`;
                }

                indicator.className = 'trace-status-indicator expired';
                text.textContent = `Expired: ${expiredTimeText} • ${debugLevelName}`;
                indicator.style.display = 'inline-flex';
            } else {
                indicator.className = 'trace-status-indicator no-trace';
                text.textContent = 'No Active Trace';
                indicator.style.display = 'inline-flex';
            }
        }
    }
};

DebugLogManagerUI.prototype.refreshStatusIndicator = async function () {
    try {
        await this.listTraceFlags();
        await this.updateStatusIndicator();
        const targetUserId = this.userId;
        const now = new Date();
        const hasActiveTrace = this.traceFlags.some(tf => new Date(tf.ExpirationDate) > now && tf.TracedEntityId === targetUserId);
        const hasExpiredTrace = this.traceFlags.some(tf => new Date(tf.ExpirationDate) <= now && tf.TracedEntityId === targetUserId);

        if (hasActiveTrace || hasExpiredTrace) this.startStatusIndicatorTimer();
        else this.stopStatusIndicatorTimer();
    } catch (error) {
        console.error('Failed to refresh status indicator:', error);
        const indicator = document.getElementById('traceStatusIndicator');
        if (indicator) indicator.style.display = 'none';
    }
};

// UI Rendering Methods
DebugLogManagerUI.prototype.renderDebugLevels = function () {
    const select = document.getElementById('debugLevelSelect');
    if (!select) return;
    select.innerHTML = '<option value="">Select Debug Level...</option>';
    if (this.debugLevels.length === 0) return;
    this.debugLevels.forEach(level => {
        const option = document.createElement('option');
        option.value = level.Id;
        option.textContent = level.MasterLabel || level.DeveloperName;
        select.appendChild(option);
    });
};

DebugLogManagerUI.prototype.renderTraceFlags = function () {
    const container = document.getElementById('traceFlagsList');
    if (!container) return;

    if (this.traceFlags.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div>No trace flags found</div></div>';
        return;
    }

    container.innerHTML = '';
    const targetUserId = this.getTargetUserId();

    this.traceFlags.forEach(tf => {
        if (this.traceFlagsSearchTerm) {
            const userName = (tf.TracedEntity?.Name || '').toLowerCase();
            const debugLevelName = (tf.DebugLevel?.DeveloperName || '').toLowerCase();
            if (!userName.includes(this.traceFlagsSearchTerm) && !debugLevelName.includes(this.traceFlagsSearchTerm)) return;
        }

        const item = document.createElement('div');
        item.className = 'trace-flag-item';
        if (tf.TracedEntityId === targetUserId) item.classList.add('current-user');

        const startDate = new Date(tf.StartDate);
        const expiration = new Date(tf.ExpirationDate);
        const now = new Date();
        const isScheduled = startDate > now;
        const isExpired = expiration <= now;

        let expiresClass = '', expiresText = '', statusIndicator = '';

        if (isScheduled) {
            const startsInMinutes = Math.max(0, Math.floor((startDate - now) / 60000));
            expiresClass = 'scheduled';
            statusIndicator = '<span class="trace-status-dot scheduled" title="Scheduled"></span>';
            const dateRange = startDate.toLocaleDateString() === expiration.toLocaleDateString()
                ? `${startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${expiration.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : `${startDate.toLocaleString()} - ${expiration.toLocaleString()}`;

            if (startsInMinutes >= 60) expiresText = `Starts in ${Math.floor(startsInMinutes / 60)}h ${startsInMinutes % 60}m`;
            else expiresText = `Starts in ${startsInMinutes}m`;
            expiresText += ` <span class="schedule-range">(${dateRange})</span>`;
        } else if (isExpired) {
            expiresClass = 'expired'; expiresText = 'Expired';
            statusIndicator = '<span class="trace-status-dot expired" title="Expired"></span>';
        } else {
            const expiresInMinutes = Math.max(0, Math.floor((expiration - now) / 60000));
            expiresText = expiresInMinutes >= 60 ? `${Math.floor(expiresInMinutes / 60)}h ${expiresInMinutes % 60}m left` : `${expiresInMinutes}m left`;
            if (expiresInMinutes < 5) expiresClass = 'expiring-soon';
            statusIndicator = '<span class="trace-status-dot active" title="Active"></span>';
        }

        const isCurrentUser = tf.TracedEntityId === this.userId;
        const badge = isCurrentUser ? '<span class="current-badge">You</span>' : (tf.TracedEntityId === targetUserId && this.useOtherUser ? '<span class="current-badge">Selected</span>' : '');

        let actionButtons = isScheduled ? `<button class="button secondary delete-btn" data-id="${tf.Id}">Cancel</button>`
            : (isExpired ? `<button class="button primary reactivate-btn" data-id="${tf.Id}">Reactivate (45 min)</button><button class="button secondary delete-btn" data-id="${tf.Id}">Delete</button>`
                : `<button class="button secondary extend-btn" data-id="${tf.Id}">Extend (+45min)</button><button class="button secondary reduce-btn" data-id="${tf.Id}">Reduce (-45min)</button><button class="button secondary delete-btn" data-id="${tf.Id}">Delete</button>`);

        item.innerHTML = `
      <div class="trace-flag-info">
        <div class="trace-flag-user">${statusIndicator} ${this.escapeHtml(tf.TracedEntity?.Name || 'Unknown')} ${badge}</div>
        <div class="trace-flag-meta">
          <span class="trace-flag-level">${this.escapeHtml(tf.DebugLevel?.DeveloperName || 'Unknown')}</span>
          <span class="trace-flag-expires ${expiresClass}">${expiresText}</span>
        </div>
      </div>
      <div class="trace-flag-actions">${actionButtons}</div>`;
        container.appendChild(item);
    });

    container.querySelectorAll('.extend-btn').forEach(btn => btn.addEventListener('click', (e) => this.handleExtendTraceFlag(e.target.dataset.id)));
    container.querySelectorAll('.reduce-btn').forEach(btn => btn.addEventListener('click', (e) => this.handleReduceTraceFlag(e.target.dataset.id)));
    container.querySelectorAll('.reactivate-btn').forEach(btn => btn.addEventListener('click', (e) => this.handleReactivateTraceFlag(e.target.dataset.id)));
    container.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', (e) => this.handleDeleteTraceFlag(e.target.dataset.id)));
};

DebugLogManagerUI.prototype.escapeHtml = function (text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

DebugLogManagerUI.prototype.filterTraceFlags = function (searchTerm) {
    this.traceFlagsSearchTerm = searchTerm.toLowerCase().trim();
    this.renderTraceFlags();
};

// Mode Toggle Methods
DebugLogManagerUI.prototype.toggleExpirationMode = function (mode) {
    const durationControls = document.getElementById('durationControls');
    const customControls = document.getElementById('customControls');
    if (mode === 'duration') {
        durationControls.style.display = 'flex';
        customControls.style.display = 'none';
    } else if (mode === 'custom') {
        durationControls.style.display = 'none';
        customControls.style.display = 'flex';
        this.initializeCustomDateTime();
    }
};

DebugLogManagerUI.prototype.initializeCustomDateTime = function () {
    const sd = document.getElementById('customStartDate'), st = document.getElementById('customStartTime');
    const ed = document.getElementById('customEndDate'), et = document.getElementById('customEndTime');
    if (!sd || !st || !ed || !et) return;

    const now = new Date();
    const start = new Date(now); start.setSeconds(0); start.setMilliseconds(0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const fD = d => d.toISOString().split('T')[0];
    const fT = d => d.toTimeString().split(' ')[0].substring(0, 5);

    sd.value = fD(start); st.value = fT(start);
    ed.value = fD(end); et.value = fT(end);
    sd.min = fD(now); ed.min = fD(now);
};

DebugLogManagerUI.prototype.getCustomDateTimeRange = function () {
    const sd = document.getElementById('customStartDate'), st = document.getElementById('customStartTime');
    const ed = document.getElementById('customEndDate'), et = document.getElementById('customEndTime');
    if (!sd?.value || !st?.value || !ed?.value || !et?.value) throw new Error('Please fill in all fields');

    const start = new Date(`${sd.value}T${st.value}`), end = new Date(`${ed.value}T${et.value}`), now = new Date();
    if (end <= now) throw new Error('End time must be in the future');
    if (end <= start) throw new Error('End time must be after start time');
    if (end - start > 24 * 60 * 60 * 1000) throw new Error('Range cannot exceed 24 hours');
    return { startDate: start, endDate: end };
};

// Event Handlers
DebugLogManagerUI.prototype.handleEnableDebug = async function () {
    const isCustom = !document.getElementById('modeDuration')?.checked;
    const btn = document.getElementById(isCustom ? 'enableDebugBtnCustom' : 'enableDebugBtn');
    const dls = document.getElementById('debugLevelSelect');
    const originalText = btn.textContent;

    try {
        const debugLevelId = dls.value;
        if (!debugLevelId) {
            this.showNotification('Please select a Debug Level', 'error');
            dls.classList.add('validation-error'); dls.focus();
            setTimeout(() => dls.classList.remove('validation-error'), 3000);
            return;
        }

        let startDate = null, expirationDate, durationMinutes, durationText;
        if (isCustom) {
            const range = this.getCustomDateTimeRange();
            startDate = range.startDate; expirationDate = range.endDate;
            durationMinutes = Math.ceil((expirationDate - startDate) / 60000);
            durationText = `from ${startDate.toLocaleString()} to ${expirationDate.toLocaleString()}`;
        } else {
            durationMinutes = parseInt(document.getElementById('debugDurationSelect')?.value || '60', 10);
            durationText = `${durationMinutes / 60} hours`;
        }

        const targetUserId = this.getTargetUserId();
        const existing = this.traceFlags.find(tf => new Date(tf.ExpirationDate) > new Date() && tf.TracedEntityId === targetUserId);
        if (existing) {
            await this.showReplaceConfirmation(existing, debugLevelId, durationMinutes, expirationDate, startDate);
            return;
        }

        btn.disabled = true; btn.textContent = 'Creating...';
        const result = await this.createOrExtendTraceFlagWithExpiration(debugLevelId, durationMinutes, expirationDate, startDate);
        this.renderTraceFlags(); this.startTimer();

        const filter = document.getElementById('logTypeFilter');
        if (filter) { filter.value = 'Monitoring'; if (typeof savePreferences === 'function') await savePreferences(); }

        const userName = this.useOtherUser && this.selectedUserName ? this.selectedUserName : 'you';
        this.showNotification(`Debug logging ${result?.extended ? 'extended' : 'enabled'} for ${userName} ${durationText}`, 'success');
    } catch (error) {
        console.error('Failed to enable debug:', error);
        this.showNotification(error.message || 'Failed to enable debug logging', 'error');
    } finally { btn.disabled = false; btn.textContent = originalText; }
};

DebugLogManagerUI.prototype.showNotification = function (message, type = 'info') {
    const existing = document.querySelector('.debug-notification');
    if (existing) existing.remove();
    const n = document.createElement('div'); n.className = `debug-notification ${type}`; n.textContent = message;
    const content = document.querySelector('.debug-log-manager-content');
    if (content) {
        content.insertBefore(n, content.firstChild);
        setTimeout(() => { n.classList.add('fade-out'); setTimeout(() => n.remove(), 300); }, 4000);
    }
};

DebugLogManagerUI.prototype.showReplaceConfirmation = async function (existingFlag, newDebugLevelId, durationMinutes, customExpir = null, customStart = null) {
    const dialog = document.getElementById('replaceConfirmationDialog');
    if (!dialog) return;
    document.getElementById('confirmCurrentUser').textContent = existingFlag.TracedEntity?.Name || 'Unknown';
    document.getElementById('confirmCurrentDebugLevel').textContent = existingFlag.DebugLevel?.DeveloperName || 'Unknown';
    const remMin = Math.max(0, Math.floor((new Date(existingFlag.ExpirationDate) - new Date()) / 60000));
    document.getElementById('confirmTimeRemaining').textContent = remMin >= 60 ? `${Math.floor(remMin / 60)}h ${remMin % 60}m` : `${remMin}m`;
    dialog.classList.remove('hidden');

    return new Promise((resolve) => {
        const cb = document.getElementById('confirmReplaceBtn'), can = document.getElementById('confirmCancelBtn');
        const hC = async () => { cl(); await this.handleConfirmReplace(existingFlag.Id, newDebugLevelId, durationMinutes, customExpir, customStart); resolve(true); };
        const hCan = () => { cl(); resolve(false); };
        const cl = () => { dialog.classList.add('hidden'); cb.removeEventListener('click', hC); can.removeEventListener('click', hCan); };
        cb.addEventListener('click', hC); can.addEventListener('click', hCan);
    });
};

DebugLogManagerUI.prototype.handleConfirmReplace = async function (exid, nlid, dur, cE = null, cS = null) {
    const isC = !document.getElementById('modeDuration')?.checked;
    const btn = document.getElementById(isC ? 'enableDebugBtnCustom' : 'enableDebugBtn');
    const orig = btn.textContent;
    try {
        btn.disabled = true; btn.textContent = 'Replacing...';
        await this.deleteTraceFlag(exid);
        const start = cS || new Date(Date.now() + 5000), exp = cE || new Date(start.getTime() + dur * 60 * 1000);
        await this.createTraceFlagWithRetry({ TracedEntityId: this.getTargetUserId(), LogType: 'USER_DEBUG', DebugLevelId: nlid || await this.getOrCreateDefaultDebugLevel(), StartDate: start.toISOString(), ExpirationDate: exp.toISOString() });
        await this.listTraceFlags(); this.renderTraceFlags(); this.startTimer();
        const filter = document.getElementById('logTypeFilter');
        if (filter) { filter.value = 'Monitoring'; if (typeof savePreferences === 'function') await savePreferences(); }
        this.showNotification('Debug log replaced successfully', 'success');
    } catch (error) { console.error(error); this.showNotification('Failed to replace', 'error'); }
    finally { btn.disabled = false; btn.textContent = orig; }
};

DebugLogManagerUI.prototype.handleExtendTraceFlag = async function (tid) {
    try { await this.extendTraceFlag(tid || this.currentTraceFlag?.Id, this.DEFAULT_DURATION_MINUTES); this.renderTraceFlags(); this.showNotification('Extended by 45 minutes', 'success'); }
    catch (error) { this.showNotification('Failed: ' + error.message, 'error'); }
};

DebugLogManagerUI.prototype.handleReduceTraceFlag = async function (tid) {
    if (!tid) return;
    try { const res = await this.reduceTraceFlag(tid, this.DEFAULT_DURATION_MINUTES); this.renderTraceFlags(); this.showNotification(res?.disabled ? 'Disabled (time reduced to 0)' : 'Reduced by 45 minutes', 'info'); }
    catch (error) { this.showNotification('Failed: ' + error.message, 'error'); }
};

DebugLogManagerUI.prototype.handleReactivateTraceFlag = async function (tid) {
    if (!tid) return;
    try {
        const tf = this.traceFlags.find(x => x.Id === tid); if (!tf) return;
        if (this.traceFlags.find(x => x.Id !== tid && x.TracedEntityId === tf.TracedEntityId && new Date(x.ExpirationDate) > new Date())) {
            this.showNotification('User already has an active trace flag', 'error'); return;
        }
        await this.toolingDelete('TraceFlag', tid);
        const exp = new Date(Date.now() + this.DEFAULT_DURATION_MINUTES * 60 * 1000);
        await this.toolingCreate('TraceFlag', { TracedEntityId: tf.TracedEntityId, LogType: 'USER_DEBUG', DebugLevelId: tf.DebugLevelId, StartDate: new Date().toISOString(), ExpirationDate: exp.toISOString() });
        await this.listTraceFlags(); this.renderTraceFlags(); this.showNotification('Reactivated for 45 minutes', 'success');
    } catch (error) { this.showNotification('Failed: ' + error.message, 'error'); }
};

DebugLogManagerUI.prototype.handleDeleteTraceFlag = async function (tid) {
    if (confirm('Delete this trace flag?')) { try { await this.deleteTraceFlag(tid); this.renderTraceFlags(); } catch (e) { alert(e.message); } }
};

DebugLogManagerUI.prototype.handleDeleteAllLogs = async function () {
    if (!confirm('Delete ALL debug logs?')) return;
    const btn = document.getElementById('deleteAllLogsBtn'); const orig = btn.textContent;
    try {
        btn.disabled = true; btn.textContent = 'Deleting...';
        const res = await this.deleteAllDebugLogs();
        if (res.deleted > 0) {
            if (typeof logLoader !== 'undefined') logLoader.clearCache();
            if (res.logIds?.length) await chrome.runtime.sendMessage({ type: 'DELETE_LOGS_BY_IDS', logIds: res.logIds, sfHost: this.sfHost });
            const list = document.getElementById('logsList'), empty = document.getElementById('emptyState'), count = document.getElementById('totalLogsCount');
            if (list) list.innerHTML = ''; if (empty) empty.classList.remove('hidden'); if (count) count.textContent = '0';
            if (typeof loadDebugLogs === 'function') await loadDebugLogs();
            this.showNotification(`Deleted ${res.deleted} logs`, 'success');
        } else this.showNotification('No logs found', 'info');
    } catch (e) { this.showNotification('Failed: ' + e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = orig; }
};

DebugLogManagerUI.prototype.openModal = async function () {
    const m = document.getElementById('debugLogManagerModal'); if (!m) return;
    m.style.display = 'flex';
    if (!this.userId) await this.loadUserInfo();
    if (!this.debugLevelCreator && window.DebugLevelCreator) { this.debugLevelCreator = new window.DebugLevelCreator(this); this.debugLevelCreator.setupEventListeners(); }
    try { await this.listDebugLevels(); await this.listTraceFlags(); this.renderDebugLevels(); this.renderTraceFlags(); this.startTimer(); }
    catch (e) { console.error(e); }
};

DebugLogManagerUI.prototype.closeModal = function () {
    const m = document.getElementById('debugLogManagerModal'); if (m) m.style.display = 'none';
    this.stopTimer();
};

DebugLogManagerUI.prototype.setupModalEventListeners = function () {
    document.getElementById('closeDebugLogManagerBtn')?.addEventListener('click', () => this.closeModal());
    const m = document.getElementById('debugLogManagerModal');
    if (m) m.addEventListener('click', (e) => { if (e.target === m) this.closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeModal(); });

    document.getElementById('enableDebugBtn')?.addEventListener('click', () => this.handleEnableDebug());
    document.getElementById('enableDebugBtnCustom')?.addEventListener('click', () => this.handleEnableDebug());

    const mD = document.getElementById('modeDuration'), mC = document.getElementById('modeCustom');
    mD?.addEventListener('change', () => mD.checked && this.toggleExpirationMode('duration'));
    mC?.addEventListener('change', () => mC.checked && this.toggleExpirationMode('custom'));

    this.initializeCustomDateTime();
    document.getElementById('deleteAllLogsBtn')?.addEventListener('click', () => this.handleDeleteAllLogs());

    const curR = document.getElementById('currentUserRadio'), othR = document.getElementById('otherUserRadio');
    curR?.addEventListener('change', () => curR.checked && this.clearSelectedUser());
    othR?.addEventListener('change', () => othR.checked && (this.toggleUserSearchUI(true), this.useOtherUser = true));

    const uIn = document.getElementById('userSearchInput');
    if (uIn) {
        uIn.addEventListener('input', () => { clearTimeout(this.searchTimeout); this.searchTimeout = setTimeout(() => this.handleUserSearch(), 300); });
        uIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.handleUserSearch(); } });
    }
    document.getElementById('userSearchBtn')?.addEventListener('click', () => this.handleUserSearch());
    document.getElementById('clearSelectedUserBtn')?.addEventListener('click', () => this.clearSelectedUser());
    document.getElementById('traceFlagsSearchInput')?.addEventListener('input', (e) => this.filterTraceFlags(e.target.value));
};
