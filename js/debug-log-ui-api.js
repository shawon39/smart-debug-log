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
