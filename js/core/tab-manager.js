// Tab Management
// This file handles tab querying, prioritization, and content script injection

class TabManager {
  constructor() {
    this.contentScriptFiles = [
      'content/api-handler.js',
      'content/api-operations.js'
    ];
  }

  /**
   * Gets the Salesforce tabs of the target host's org: tabs on the target host first, then the others
   * by last use. Tabs of other orgs and extension pages are never used.
   * @param {string} targetHost - The dashboard's org host
   * @returns {Promise<Array>} Ordered array of tabs
   */
  async getOrderedSalesforceTabs(targetHost = null) {
    if (!targetHost) return [];
    const tabs = await chrome.tabs.query({});
    const hostOf = (tab) => new URL(tab.url).hostname.toLowerCase();

    return tabs
      .filter(tab => isSalesforceUrl(tab.url) && isSameOrgHost(hostOf(tab), targetHost))
      .sort((a, b) => (Number(hostOf(b) === targetHost.toLowerCase()) - Number(hostOf(a) === targetHost.toLowerCase())) ||
        ((b.lastAccessed || 0) - (a.lastAccessed || 0)));
  }

  /**
   * Ensures content script is loaded on a tab
   * @param {number} tabId - Tab ID to inject scripts into
   * @returns {Promise<boolean>} True if scripts are ready, false otherwise
   */
  async ensureContentScriptLoaded(tabId) {
    try {
      // Check if script is already loaded
      const pingResponse = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
      if (pingResponse && pingResponse.success) {
        return true;
      }
    } catch (e) {
      // Script not loaded, continue to injection
    }

    try {
      // Inject content scripts
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: this.contentScriptFiles
      });
      
      // Wait for scripts to initialize
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Verify script is ready
      const finalPingResponse = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
      return finalPingResponse && finalPingResponse.success;
    } catch (injectionError) {
      return false;
    }
  }

  /**
   * Gets instance URL from tab
   * @param {Object} tab - Chrome tab object
   * @param {string} fallbackHost - Fallback host if tab URL is not available
   * @returns {string} Instance URL
   */
  getInstanceUrl(tab, fallbackHost = null) {
    if (tab.url) {
      const url = new URL(tab.url);
      return `${url.protocol}//${url.hostname}`;
    } else if (fallbackHost) {
      return `https://${fallbackHost}`;
    }
    return null;
  }

  /**
   * Finds the first working Salesforce tab for API operations
   * @param {string} targetHost - Preferred host
   * @param {Object} sessionData - Session data for API calls
   * @param {string} query - SOQL query to execute
   * @returns {Promise<Object|null>} Query result or null if no working tab found
   */
  async findWorkingTabForQuery(targetHost, sessionData, query) {
    const orderedTabs = await this.getOrderedSalesforceTabs(targetHost);

    for (const tab of orderedTabs) {
      try {
        const isReady = await this.ensureContentScriptLoaded(tab.id);
        if (!isReady) {
          continue;
        }

        const instanceUrl = this.getInstanceUrl(tab, targetHost);
        if (!instanceUrl) {
          continue;
        }

        const tabSessionData = {
          ...sessionData,
          instanceUrl: instanceUrl
        };

        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'TOOLING_QUERY',
          query: query,
          session: tabSessionData
        });

        if (response && response.success && response.data) {
          return response.data;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }
}

// Create singleton instance
const tabManager = new TabManager();