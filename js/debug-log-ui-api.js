/**
 * Debug Log Manager UI - API Methods
 * Extends DebugLogManagerUI prototype with API interaction methods.
 */

DebugLogManagerUI.prototype.toolingQuery = async function (query) {
    const response = await chrome.runtime.sendMessage({
        type: 'EXECUTE_TOOLING_QUERY',
        query,
        sfHost: this.sfHost
    });
    if (!response || !response.success) {
        throw new Error(response?.error || 'Query failed');
    }
    return response.data;
};

DebugLogManagerUI.prototype.toolingCreate = async function (sobjectType, data) {
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
};

DebugLogManagerUI.prototype.toolingUpdate = async function (sobjectType, recordId, data) {
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
};

DebugLogManagerUI.prototype.toolingDelete = async function (sobjectType, recordId) {
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
};

// Deletes all ApexLogs of one user (the background loops until none are left).
// Returns { deleted, failed, errors, deletedIds }.
DebugLogManagerUI.prototype.deleteApexLogs = async function (userId) {
    const response = await chrome.runtime.sendMessage({
        type: 'DELETE_APEX_LOGS',
        userId,
        sfHost: this.sfHost
    });
    if (!response || !response.success) {
        throw new Error(response?.error || 'Delete failed');
    }
    return response.data;
};

// Returns { totalBytes, logCount, limitBytes } for the org's debug logs.
DebugLogManagerUI.prototype.getLogStorage = async function () {
    const response = await chrome.runtime.sendMessage({
        type: 'GET_LOG_STORAGE',
        sfHost: this.sfHost
    });
    if (!response || !response.success) {
        throw new Error(response?.error || 'Could not read log storage');
    }
    return response.data;
};

// Salesforce errors arrive as 'Tooling create failed: 400 - [{"message":"...","errorCode":"..."}]'.
// Returns just the Salesforce message so the user sees the real reason; other text is kept as it is.
DebugLogManagerUI.prototype.errorText = function (error) {
    const text = String(error?.message || error || '');
    const start = text.indexOf('[{');
    if (start !== -1) {
        try {
            const messages = JSON.parse(text.slice(start)).map(e => e.message).filter(Boolean);
            if (messages.length) return messages.join(' ');
        } catch (e) { /* not JSON */ }
    }
    return text;
};

DebugLogManagerUI.prototype.searchUsers = async function (searchTerm) {
    const response = await chrome.runtime.sendMessage({
        type: 'SEARCH_USERS',
        searchTerm,
        sfHost: this.sfHost
    });
    if (!response || !response.success) {
        throw new Error(response?.error || 'User search failed');
    }
    return response.data;
};
