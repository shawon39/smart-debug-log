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
    // Number each search so a slow, older response cannot replace newer results.
    const searchId = this.userSearchId = (this.userSearchId || 0) + 1;

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
        if (searchId !== this.userSearchId) return;
        this.renderUserSearchResults(users);
    } catch (error) {
        if (searchId !== this.userSearchId) return;
        console.error('User search error:', error);
        if (container) {
            const message = document.createElement('div');
            message.className = 'user-search-empty';
            message.textContent = `Search failed: ${error.message}`;
            container.innerHTML = '';
            container.appendChild(message);
        }
    }
};

DebugLogManagerUI.prototype.toggleUserSearchUI = function (show) {
    const container = document.getElementById('userSearchContainer');
    if (container) container.classList.toggle('hidden', !show);
};

// Timer Methods
DebugLogManagerUI.prototype.startTimer = function () {
    this.stopTimer();
    // Often enough that a flag which starts or expires gets its new buttons quickly
    this.timerInterval = setInterval(() => this.updateTraceFlagTimers(), 15000);
};

// Salesforce allows one trace flag at a time per traced entity and log type,
// so only flags of the same LogType conflict.
DebugLogManagerUI.prototype.checkTimeConflict = function (start, end, targetUserId, logType = 'USER_DEBUG', excludeId = null) {
    if (!this.traceFlags || !start || !end) return null;
    const startMs = start.getTime();
    const endMs = end.getTime();

    return this.traceFlags.find(tf => {
        if (tf.TracedEntityId !== targetUserId || tf.LogType !== logType || tf.Id === excludeId) return false;
        const tfStart = new Date(tf.StartDate).getTime();
        const tfEnd = new Date(tf.ExpirationDate).getTime();
        // Overlap if (start < tfEnd) AND (end > tfStart)
        return startMs < tfEnd && endMs > tfStart;
    });
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
    // The header shows the current user's USER_DEBUG flag (the one that creates Monitoring logs)
    const userFlags = this.traceFlags.filter(tf => tf.TracedEntityId === targetUserId && tf.LogType === 'USER_DEBUG');

    // 1. Check for Active
    const activeTraceFlag = userFlags.find(tf => {
        const startDate = new Date(tf.StartDate);
        const expiration = new Date(tf.ExpirationDate);
        return startDate <= now && expiration > now;
    });

    if (activeTraceFlag) {
        const expiration = new Date(activeTraceFlag.ExpirationDate);
        const remainingMs = expiration - now;
        const remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));
        const debugLevelName = activeTraceFlag.DebugLevel?.DeveloperName || 'Unknown';

        let timeText = formatDurationShort(remainingMinutes) + ' left';
        indicator.className = 'trace-status-indicator active';
        text.textContent = `Active: ${timeText} • ${debugLevelName}`;
        indicator.style.display = 'inline-flex';
        return;
    }

    // 2. Check for Scheduled
    const scheduledTraceFlag = userFlags
        .filter(tf => new Date(tf.StartDate) > now)
        .sort((a, b) => new Date(a.StartDate) - new Date(b.StartDate))[0];

    if (scheduledTraceFlag) {
        const startDate = new Date(scheduledTraceFlag.StartDate);
        const startsInMs = startDate - now;
        const startsInMinutes = Math.max(0, Math.floor(startsInMs / 60000));
        const debugLevelName = scheduledTraceFlag.DebugLevel?.DeveloperName || 'Unknown';

        let timeText = `starts in ${formatDurationShort(startsInMinutes)}`;

        indicator.className = 'trace-status-indicator scheduled';
        text.textContent = `Scheduled: ${timeText} • ${debugLevelName}`;
        indicator.style.display = 'inline-flex';
        return;
    }

    // 3. Check for recently expired
    const expiredTraceFlag = userFlags.find(tf => new Date(tf.ExpirationDate) <= now);

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
        indicator.style.display = 'none';
    }
};

DebugLogManagerUI.prototype.refreshStatusIndicator = async function () {
    if (!this.sfHost) {
        // No org in the dashboard URL: do not show another org's status
        const indicator = document.getElementById('traceStatusIndicator');
        if (indicator) indicator.style.display = 'none';
        return;
    }
    try {
        await this.listTraceFlags();
        await this.updateStatusIndicator();
        const targetUserId = this.userId;
        const now = new Date();
        const userFlags = this.traceFlags.filter(tf => tf.TracedEntityId === targetUserId && tf.LogType === 'USER_DEBUG');
        const hasActiveTrace = userFlags.some(tf => new Date(tf.ExpirationDate) > now);
        const hasExpiredTrace = userFlags.some(tf => new Date(tf.ExpirationDate) <= now);

        if (hasActiveTrace || hasExpiredTrace) this.startStatusIndicatorTimer();
        else this.stopStatusIndicatorTimer();
    } catch (error) {
        // Without a token there is nothing to show yet (the token banner explains it)
        if (!String(error?.message).includes('NO_OAUTH_TOKEN')) console.error('Failed to refresh status indicator:', error);
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
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">${Icons.svg('flag', 20)}</div><div>No trace flags found</div></div>`;
        return;
    }

    container.innerHTML = '';
    const targetUserId = this.getTargetUserId();
    const now = new Date();
    const stateOrder = { active: 0, scheduled: 1, expired: 2 };

    // 1. Sort trace flags: Active > Scheduled > Expired
    // Sub-sorting: Active by expiration (soonest first), Scheduled by start date (soonest first), Expired by expiration (most recent first)
    const sortedTraceFlags = [...this.traceFlags].sort((a, b) => {
        const aState = this.getTraceFlagState(a, now), bState = this.getTraceFlagState(b, now);
        if (aState !== bState) return stateOrder[aState] - stateOrder[bState];
        if (aState === 'active') return new Date(a.ExpirationDate) - new Date(b.ExpirationDate);
        if (aState === 'scheduled') return new Date(a.StartDate) - new Date(b.StartDate);
        return new Date(b.ExpirationDate) - new Date(a.ExpirationDate); // Both expired
    });

    sortedTraceFlags.forEach(tf => {
        const timing = this.getTraceFlagTiming(tf, now);
        const state = timing.state;

        // Apply Status Filter
        if (this.traceFlagsStatusFilter !== 'All' && this.traceFlagsStatusFilter.toLowerCase() !== state) return;

        // Apply Search Filter
        if (this.traceFlagsSearchTerm) {
            const userName = (tf.TracedEntity?.Name || '').toLowerCase();
            const debugLevelName = (tf.DebugLevel?.DeveloperName || '').toLowerCase();
            if (!userName.includes(this.traceFlagsSearchTerm) && !debugLevelName.includes(this.traceFlagsSearchTerm)) return;
        }

        // The row carries the flag id and state, so the timer can find it and see state changes
        const item = this.createElement('div', 'trace-flag-item');
        item.dataset.id = tf.Id;
        item.dataset.state = state;
        if (tf.TracedEntityId === targetUserId) item.classList.add('current-user');

        const dot = this.createElement('span', `trace-status-dot ${state}`);
        dot.title = state.charAt(0).toUpperCase() + state.slice(1);
        const user = this.createElement('div', 'trace-flag-user');
        user.append(dot, tf.TracedEntity?.Name || 'Unknown');
        if (tf.TracedEntityId === this.userId) user.append(this.createElement('span', 'current-badge', 'You'));
        else if (tf.TracedEntityId === targetUserId && this.useOtherUser) user.append(this.createElement('span', 'current-badge', 'Selected'));
        user.append(this.createElement('span', 'trace-flag-type', this.LOG_TYPE_LABELS[tf.LogType] || tf.LogType || 'Unknown'));

        const expires = this.createElement('span', `trace-flag-expires ${timing.className}`);
        expires.append(this.createElement('span', state === 'scheduled' ? 'trace-flag-countdown starts-in-prefix' : 'trace-flag-countdown', timing.text));
        if (timing.range) expires.append(' ', this.createElement('span', 'schedule-range', timing.range));

        const meta = this.createElement('div', 'trace-flag-meta');
        meta.append(this.createElement('span', 'trace-flag-level', tf.DebugLevel?.DeveloperName || 'Unknown'));
        if (tf.CreatedBy?.Name) meta.append(this.createElement('span', 'trace-flag-creator', `by ${tf.CreatedBy.Name}`));
        meta.append(expires);

        const info = this.createElement('div', 'trace-flag-info');
        info.append(user, meta);

        const actions = this.createElement('div', 'trace-flag-actions');
        this.getTraceFlagActions(tf, state).forEach(action => {
            // Compact button: short text or an icon, the full action as tooltip and accessible name
            const button = this.createElement('button', `button ${action.className}`);
            button.title = action.label;
            button.setAttribute('aria-label', action.label);
            if (action.icon) button.innerHTML = Icons.svg(action.icon, 13);
            else button.textContent = action.text;
            button.addEventListener('click', () => action.onClick(tf.Id));
            actions.append(button);
        });

        item.append(info, actions);
        container.appendChild(item);
    });
};

DebugLogManagerUI.prototype.LOG_TYPE_LABELS = { USER_DEBUG: 'User debug', DEVELOPER_LOG: 'Dev Console', CLASS_TRACING: 'Class/Trigger' };

DebugLogManagerUI.prototype.createElement = function (tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
};

// 'scheduled' (starts more than 5 s from now), 'expired' or 'active'
DebugLogManagerUI.prototype.getTraceFlagState = function (tf, now = new Date()) {
    if (new Date(tf.StartDate) > new Date(now.getTime() + 5000)) return 'scheduled';
    return new Date(tf.ExpirationDate) <= now ? 'expired' : 'active';
};

// Countdown text and CSS class of a trace flag row
DebugLogManagerUI.prototype.getTraceFlagTiming = function (tf, now = new Date()) {
    const state = this.getTraceFlagState(tf, now);
    if (state === 'scheduled') {
        const startsInMinutes = Math.max(0, Math.floor((new Date(tf.StartDate) - now) / 60000));
        return {
            state, className: 'scheduled', text: `Starts in ${formatDuration(startsInMinutes)}:`,
            range: `(${formatDateTimeNice(tf.StartDate)} - ${formatDateTimeNice(tf.ExpirationDate)})`
        };
    }
    if (state === 'expired') return { state, className: 'expired', text: 'Expired' };
    const expiresInMinutes = Math.max(0, Math.floor((new Date(tf.ExpirationDate) - now) / 60000));
    return { state, className: expiresInMinutes < 5 ? 'expiring-soon' : '', text: `${formatDurationShort(expiresInMinutes)} left` };
};

// Extend, Reduce and Reactivate use the duration chosen in the Duration list
DebugLogManagerUI.prototype.getSelectedDurationMinutes = function () {
    const minutes = parseInt(document.getElementById('debugDurationSelect')?.value, 10);
    return minutes > 0 ? minutes : this.DEFAULT_DURATION_MINUTES;
};

// The buttons of a row: { label (tooltip), className, onClick, and a short text or an icon }.
// Developer Console flags are kept up by the Developer Console itself, so they only get Delete.
DebugLogManagerUI.prototype.getTraceFlagActions = function (tf, state) {
    const duration = formatDuration(this.getSelectedDurationMinutes());
    const remove = {
        label: state === 'scheduled' ? 'Cancel' : 'Delete',
        className: 'secondary delete-btn',
        onClick: id => this.handleDeleteTraceFlag(id),
        icon: state === 'scheduled' ? 'x' : 'trash'
    };
    if (tf.LogType === 'DEVELOPER_LOG' || state === 'scheduled') return [remove];
    if (state === 'expired') {
        return [{ label: `Reactivate for ${duration}`, className: 'primary reactivate-btn', onClick: id => this.handleReactivateTraceFlag(id), text: `Reactivate ${duration}` }, remove];
    }
    return [
        { label: `Extend by ${duration}`, className: 'secondary extend-btn', onClick: id => this.handleExtendTraceFlag(id), text: `+${duration}` },
        { label: `Reduce by ${duration}`, className: 'secondary reduce-btn', onClick: id => this.handleReduceTraceFlag(id), text: `\u2212${duration}` },
        remove
    ];
};

DebugLogManagerUI.prototype.updateTraceFlagTimers = function () {
    const container = document.getElementById('traceFlagsList');
    if (!container || !this.traceFlags) return;
    const now = new Date();

    for (const item of container.querySelectorAll('.trace-flag-item')) {
        const tf = this.traceFlags.find(flag => flag.Id === item.dataset.id);
        if (!tf) continue;
        const timing = this.getTraceFlagTiming(tf, now);

        // A flag that has started or expired needs other buttons: draw the list again
        if (timing.state !== item.dataset.state) {
            this.renderTraceFlags();
            return;
        }

        const countdown = item.querySelector('.trace-flag-countdown');
        if (countdown && countdown.textContent !== timing.text) countdown.textContent = timing.text;
        const expiresSpan = item.querySelector('.trace-flag-expires');
        if (expiresSpan) expiresSpan.className = `trace-flag-expires ${timing.className}`;
    }
};

DebugLogManagerUI.prototype.escapeHtml = function (text) {
    // Delegate to the shared escapeHtml() in basic-utilities.js (single source of truth)
    return window.escapeHtml(text);
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

    // Local date (toISOString() is UTC, which gave the wrong day near midnight)
    const fD = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

        const targetUserId = this.getTargetUserId();
        if (!targetUserId) {
            this.showNotification(this.useOtherUser ? 'Search for a user and select them first' : 'User ID not available', 'error');
            return;
        }

        let startDate = null, expirationDate, durationMinutes, durationText;
        if (isCustom) {
            const range = this.getCustomDateTimeRange();
            startDate = range.startDate; expirationDate = range.endDate;
            durationMinutes = Math.ceil((expirationDate - startDate) / 60000);
            durationText = `from ${formatDateTimeNice(startDate)} to ${formatDateTimeNice(expirationDate)}`;
        } else {
            durationMinutes = parseInt(document.getElementById('debugDurationSelect')?.value || '60', 10);
            startDate = new Date();
            expirationDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
            durationText = `for ${formatDuration(durationMinutes)}`;
        }

        const conflict = this.checkTimeConflict(startDate || new Date(), expirationDate, targetUserId);

        if (conflict) {
            if (isCustom) {
                this.showNotification(`Time conflict: Already tracing from ${formatDateTimeNice(conflict.StartDate)} to ${formatDateTimeNice(conflict.ExpirationDate)}`, 'error');
                return;
            } else if (new Date(conflict.ExpirationDate) > new Date()) {
                // Duration mode: Show replacement prompt only if it conflicts with an active/future flag
                await this.showReplaceConfirmation(conflict, debugLevelId, durationMinutes, expirationDate, startDate);
                return;
            }
        }

        btn.disabled = true; btn.textContent = 'Creating...';
        const result = await this.createOrExtendTraceFlagWithExpiration(debugLevelId, durationMinutes, expirationDate, startDate);
        this.renderTraceFlags(); this.startTimer();

        const filter = document.getElementById('logTypeFilter');
        if (filter) { filter.value = 'Monitoring'; if (typeof savePreferences === 'function') await savePreferences(); }

        // Say what really happened: a new or reused (expired) flag, or a change to a flag that was still set
        const userName = this.useOtherUser && this.selectedUserName ? this.selectedUserName : 'you';
        const isScheduled = startDate > new Date(Date.now() + 5000);
        this.showNotification(result?.replaced
            ? `Updated the existing trace flag for ${userName}: it now runs ${durationText}`
            : `Debug logging ${isScheduled ? 'scheduled' : 'enabled'} for ${userName} ${durationText}`, 'success');
    } catch (error) {
        console.error('Failed to enable debug:', error);
        this.renderTraceFlags();
        this.showNotification(this.traceFlagErrorText(error) || 'Failed to enable debug logging', 'error');
    } finally { btn.disabled = false; btn.textContent = originalText; }
};

// Readable error for a failed trace flag change. Salesforce does not allow adding or changing
// trace flags while the org's debug logs use more than 1,000 MB: say that in plain words.
DebugLogManagerUI.prototype.traceFlagErrorText = function (error) {
    const text = this.errorText(error);
    if (/storage|1,?000\s*MB/i.test(text)) {
        return 'Salesforce does not allow new or changed trace flags while debug logs in this org use more than 1,000 MB. Delete old logs below, then try again.';
    }
    return text;
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

DebugLogManagerUI.prototype.showReplaceConfirmation = function (existingFlag, newDebugLevelId, durationMinutes, customExpir = null, customStart = null) {
    const dialog = document.getElementById('replaceConfirmationDialog');
    if (!dialog) return Promise.resolve(false);
    this.closeReplaceConfirmation();

    // Word the dialog by the flag's real state (a scheduled flag has no "time remaining")
    const now = new Date();
    const isScheduled = new Date(existingFlag.StartDate) > now;
    document.getElementById('confirmTitle').textContent = isScheduled ? 'Replace Scheduled Debug Log?' : 'Replace Active Debug Log?';
    document.getElementById('confirmMessage').textContent = isScheduled ? 'A scheduled debug log already exists:' : 'An active debug log already exists:';
    document.getElementById('confirmCurrentUser').textContent = existingFlag.TracedEntity?.Name || 'Unknown';
    document.getElementById('confirmCurrentDebugLevel').textContent = existingFlag.DebugLevel?.DeveloperName || 'Unknown';
    document.getElementById('confirmTimeLabel').textContent = isScheduled ? 'Starts In:' : 'Time Remaining:';
    const minutes = Math.max(0, Math.floor((new Date(isScheduled ? existingFlag.StartDate : existingFlag.ExpirationDate) - now) / 60000));
    document.getElementById('confirmTimeRemaining').textContent = formatDurationShort(minutes);
    dialog.classList.remove('hidden');

    return new Promise((resolve) => {
        // All listeners go when the dialog closes in any way (buttons, Escape, closing the modal),
        // so a later confirmation can never run this one again.
        const listeners = new AbortController();
        const close = () => { listeners.abort(); dialog.classList.add('hidden'); this.replaceDialog = null; };
        this.replaceDialog = { cancel: () => { close(); resolve(false); } };
        document.getElementById('confirmReplaceBtn').addEventListener('click', async () => {
            close();
            await this.handleConfirmReplace(existingFlag.Id, newDebugLevelId, durationMinutes, customExpir, customStart);
            resolve(true);
        }, { signal: listeners.signal });
        document.getElementById('confirmCancelBtn').addEventListener('click', () => this.replaceDialog?.cancel(), { signal: listeners.signal });
    });
};

// Closes the replace dialog, if open, as "No"
DebugLogManagerUI.prototype.closeReplaceConfirmation = function () {
    this.replaceDialog?.cancel();
};

DebugLogManagerUI.prototype.handleConfirmReplace = async function (exid, nlid, dur, cE = null, cS = null) {
    const isC = !document.getElementById('modeDuration')?.checked;
    const btn = document.getElementById(isC ? 'enableDebugBtnCustom' : 'enableDebugBtn');
    const orig = btn.textContent;
    try {
        btn.disabled = true; btn.textContent = 'Replacing...';
        const now = new Date();
        const start = cS || now;
        const exp = cE || new Date(start.getTime() + dur * 60 * 1000);
        // Change the existing flag in place: if Salesforce refuses, the old flag keeps working
        await this.replaceTraceFlag(exid, nlid, start, exp);
        this.renderTraceFlags(); this.startTimer();
        const filter = document.getElementById('logTypeFilter');
        if (filter) { filter.value = 'Monitoring'; if (typeof savePreferences === 'function') await savePreferences(); }
        this.showNotification('Debug log replaced successfully', 'success');
    } catch (error) {
        console.error(error);
        this.showNotification(`Could not replace the trace flag: ${this.traceFlagErrorText(error)}`, 'error');
    }
    finally { btn.disabled = false; btn.textContent = orig; }
};

DebugLogManagerUI.prototype.handleExtendTraceFlag = async function (tid) {
    const minutes = this.getSelectedDurationMinutes();
    try {
        const res = await this.extendTraceFlag(tid, minutes);
        this.renderTraceFlags();
        this.showNotification(res.capped
            ? `Extended until ${formatDateTimeNice(res.expiration)}. A trace flag can run for 24 hours at most.`
            : `Extended by ${formatDuration(minutes)}`, 'success');
    }
    catch (error) { this.showNotification('Failed: ' + this.traceFlagErrorText(error), 'error'); }
};

DebugLogManagerUI.prototype.handleReduceTraceFlag = async function (tid) {
    if (!tid) return;
    const minutes = this.getSelectedDurationMinutes();
    const tf = this.traceFlags.find(x => x.Id === tid);
    // Taking away more time than is left ends the flag now: ask first
    if (tf && new Date(tf.ExpirationDate) - Date.now() <= minutes * 60 * 1000
        && !confirm(`Less than ${formatDuration(minutes)} is left, so this stops the trace flag now. Continue?`)) return;
    try {
        const res = await this.reduceTraceFlag(tid, minutes);
        this.renderTraceFlags();
        this.showNotification(res?.disabled ? 'Trace flag stopped. Logging has ended.' : `Reduced by ${formatDuration(minutes)}`, 'info');
    }
    catch (error) { this.showNotification('Failed: ' + this.traceFlagErrorText(error), 'error'); }
};

DebugLogManagerUI.prototype.handleReactivateTraceFlag = async function (tid) {
    if (!tid) return;
    try {
        const tf = this.traceFlags.find(x => x.Id === tid); if (!tf) return;
        const minutes = this.getSelectedDurationMinutes();
        const start = new Date();
        const exp = new Date(start.getTime() + minutes * 60 * 1000);
        // Another active or scheduled flag of the same type in that time would be refused by Salesforce
        if (this.checkTimeConflict(start, exp, tf.TracedEntityId, tf.LogType, tid)) {
            this.showNotification('This user already has an active or scheduled trace flag in that time', 'error'); return;
        }
        // Change the expired flag in place instead of delete + create
        await this.replaceTraceFlag(tid, tf.DebugLevelId, start, exp);
        this.renderTraceFlags(); this.startTimer();
        this.showNotification(`Reactivated for ${formatDuration(minutes)}`, 'success');
    } catch (error) { this.showNotification('Failed: ' + this.traceFlagErrorText(error), 'error'); }
};

DebugLogManagerUI.prototype.handleDeleteTraceFlag = async function (tid) {
    if (confirm('Delete this trace flag?')) { try { await this.deleteTraceFlag(tid); this.renderTraceFlags(); } catch (e) { alert(e.message); } }
};

DebugLogManagerUI.prototype.handleDeleteAllLogs = async function () {
    if (!this.sfHost) { this.showNotification('No Salesforce org selected. Reopen the dashboard from a Salesforce tab.', 'error'); return; }
    const userId = this.getTargetUserId();
    if (!userId) { this.showNotification(this.useOtherUser ? 'Search for a user and select them first' : 'User ID not available', 'error'); return; }
    const userName = this.useOtherUser ? this.selectedUserName : 'your user';
    if (!confirm(`Delete all debug logs of ${userName} in ${this.sfHost}? This cannot be undone.`)) return;

    const btn = document.getElementById('deleteAllLogsBtn'); const orig = btn.innerHTML;
    try {
        btn.disabled = true; btn.innerHTML = `${Icons.svg('loader')}Deleting...`;
        const res = await this.deleteAllDebugLogs(userId);
        const deleted = res?.deleted || 0, failed = res?.failed || 0;
        if (deleted > 0) {
            // Reload from Salesforce so the list shows exactly the logs that are left
            if (typeof logLoader !== 'undefined') logLoader.clearCache();
            if (typeof loadDebugLogs === 'function') await loadDebugLogs();
        }
        if (failed > 0) {
            this.showNotification(`Deleted ${deleted}, failed ${failed}: ${this.errorText(res.errors?.[0] || 'Unknown error')}`, 'error');
        } else if (deleted > 0) {
            this.showNotification(`Deleted ${deleted} logs`, 'success');
        } else {
            this.showNotification('No logs to delete', 'info');
        }
        this.refreshLogStorage();
    } catch (e) { this.showNotification('Failed: ' + this.errorText(e), 'error'); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
};

// Shows how much of the org's debug log storage is used (Salesforce limit: 1,000 MB)
DebugLogManagerUI.prototype.refreshLogStorage = async function () {
    const meter = document.getElementById('logStorageMeter');
    if (!meter) return;
    try {
        const { totalBytes = 0, limitBytes = 1000 * 1024 * 1024 } = await this.getLogStorage();
        const toMb = bytes => {
            const mb = bytes / (1024 * 1024);
            return mb < 10 ? mb.toFixed(1) : Math.round(mb).toLocaleString('en-US');
        };
        const percent = limitBytes > 0 ? Math.min(100, (totalBytes / limitBytes) * 100) : 0;
        document.getElementById('logStorageText').textContent = `Org log storage: ${toMb(totalBytes)} MB of ${toMb(limitBytes)} MB`;
        document.getElementById('logStorageFill').style.width = `${percent}%`;
        meter.classList.toggle('warn', percent >= 80);
        document.getElementById('logStorageWarning').classList.toggle('hidden', percent < 80);
        meter.classList.remove('hidden');
    } catch (e) {
        console.error('Could not read log storage:', e);
        meter.classList.add('hidden');
    }
};

// `autoCleanupLogs` (default off) lets the background delete the logs of a temporary trace flag when it expires
DebugLogManagerUI.prototype.loadAutoCleanupSetting = async function () {
    const toggle = document.getElementById('autoCleanupToggle');
    if (!toggle) return;
    try {
        const { autoCleanupLogs } = await chrome.storage.local.get('autoCleanupLogs');
        toggle.checked = autoCleanupLogs === true;
    } catch (e) {
        console.error('Could not read the auto-delete setting:', e);
    }
};

DebugLogManagerUI.prototype.saveAutoCleanupSetting = async function (enabled) {
    try {
        await chrome.storage.local.set({ autoCleanupLogs: enabled === true });
    } catch (e) {
        this.showNotification('Could not save the setting: ' + e.message, 'error');
    }
};

DebugLogManagerUI.prototype.openModal = async function () {
    const m = document.getElementById('debugLogManagerModal'); if (!m) return;
    this._lastFocused = document.activeElement;
    m.style.display = 'flex';
    document.getElementById('closeDebugLogManagerBtn')?.focus();
    // Always work on the dashboard's org (URL ?host=, else the detected org), with or without a browser session
    this.sfHost = getHostFromUrl() || (typeof sfHost !== 'undefined' ? sfHost : null);
    if (!this.sfHost) {
        this.showNotification('No Salesforce org selected. Reopen the dashboard from a Salesforce tab.', 'error');
        return;
    }
    if (!this.userId) await this.loadUserInfo();
    if (!this.debugLevelCreator && window.DebugLevelCreator) { this.debugLevelCreator = new window.DebugLevelCreator(this); this.debugLevelCreator.setupEventListeners(); }
    this.loadAutoCleanupSetting();
    this.refreshLogStorage();
    try { await this.listDebugLevels(); await this.listTraceFlags(); this.renderDebugLevels(); this.renderTraceFlags(); this.startTimer(); }
    catch (e) { console.error(e); }
};

DebugLogManagerUI.prototype.closeModal = function () {
    const m = document.getElementById('debugLogManagerModal'); if (m) m.style.display = 'none';
    this.closeReplaceConfirmation();
    this.stopTimer();
    this._lastFocused?.focus?.();
};

DebugLogManagerUI.prototype.setupModalEventListeners = function () {
    document.getElementById('closeDebugLogManagerBtn')?.addEventListener('click', () => this.closeModal());
    const m = document.getElementById('debugLogManagerModal');
    if (m) m.addEventListener('click', (e) => { if (e.target === m) this.closeModal(); });
    document.addEventListener('keydown', (e) => {
        // Only when this modal is open: Escape first closes the replace dialog, then the modal
        if (e.key !== 'Escape' || m?.style.display !== 'flex') return;
        if (this.replaceDialog) this.closeReplaceConfirmation();
        else this.closeModal();
    });

    document.getElementById('enableDebugBtn')?.addEventListener('click', () => this.handleEnableDebug());
    document.getElementById('enableDebugBtnCustom')?.addEventListener('click', () => this.handleEnableDebug());

    const mD = document.getElementById('modeDuration'), mC = document.getElementById('modeCustom');
    mD?.addEventListener('change', () => mD.checked && this.toggleExpirationMode('duration'));
    mC?.addEventListener('change', () => mC.checked && this.toggleExpirationMode('custom'));

    this.initializeCustomDateTime();
    document.getElementById('deleteAllLogsBtn')?.addEventListener('click', () => this.handleDeleteAllLogs());
    document.getElementById('autoCleanupToggle')?.addEventListener('change', (e) => this.saveAutoCleanupSetting(e.target.checked));
    // Button labels (+45min, ...) follow the selected duration
    document.getElementById('debugDurationSelect')?.addEventListener('change', () => this.renderTraceFlags());

    const curR = document.getElementById('currentUserRadio'), othR = document.getElementById('otherUserRadio');
    curR?.addEventListener('change', () => curR.checked && this.clearSelectedUser());
    // Nobody is picked yet: actions ask for a user instead of quietly using the current user
    othR?.addEventListener('change', () => othR.checked && (this.toggleUserSearchUI(true), this.useOtherUser = true, this.selectedUserId = null, this.selectedUserName = null));

    const uIn = document.getElementById('userSearchInput');
    if (uIn) {
        uIn.addEventListener('input', () => { clearTimeout(this.searchTimeout); this.searchTimeout = setTimeout(() => this.handleUserSearch(), 300); });
        uIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.handleUserSearch(); } });
    }
    document.getElementById('userSearchBtn')?.addEventListener('click', () => this.handleUserSearch());
    document.getElementById('clearSelectedUserBtn')?.addEventListener('click', () => this.clearSelectedUser());
    document.getElementById('traceFlagsSearchInput')?.addEventListener('input', (e) => { this.traceFlagsSearchTerm = e.target.value.toLowerCase(); this.renderTraceFlags(); });
    document.getElementById('traceFlagsStatusFilter')?.addEventListener('change', (e) => { this.traceFlagsStatusFilter = e.target.value; this.renderTraceFlags(); });
};
