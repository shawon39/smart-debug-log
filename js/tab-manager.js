// Tab Management
// This file handles tab querying, prioritization, and content script injection

class TabManager {
  constructor() {
    this.contentScriptFiles = [
      'content/api-handler.js',
      'content/api-operations.js', 
      'content/session-extraction.js'
    ];
  }

  /**
   * Gets ordered list of Salesforce tabs prioritized by target host and activity
   * @param {string} targetHost - The preferred host to prioritize
   * @returns {Promise<Array>} Ordered array of tabs
   */
  async getOrderedSalesforceTabs(targetHost = null) {
    const salesforceTabs = await getSalesforceTabs();
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];
    
    const realSalesforceTabs = salesforceTabs.filter(tab => isRealSalesforceUrl(tab.url));
    const extensionTabs = salesforceTabs.filter(tab => !isRealSalesforceUrl(tab.url));
    
    const orderedTabs = [];
    
    // Priority 1: Target host tabs
    if (targetHost) {
      const targetHostTabs = realSalesforceTabs.filter(tab => {
        const tabUrl = new URL(tab.url);
        return tabUrl.hostname === targetHost || tab.url.includes(targetHost);
      });
      orderedTabs.push(...targetHostTabs);
    }
    
    // Priority 2: Active Salesforce tab (if not already included)
    if (activeTab && isRealSalesforceUrl(activeTab.url) && !orderedTabs.find(tab => tab.id === activeTab.id)) {
      orderedTabs.push(activeTab);
    }
    
    // Priority 3: Other real Salesforce tabs (by last accessed)
    const otherRealTabs = realSalesforceTabs
      .filter(tab => !orderedTabs.find(existingTab => existingTab.id === tab.id))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    
    orderedTabs.push(...otherRealTabs);
    
    // Priority 4: Extension tabs (by last accessed)
    const otherExtensionTabs = extensionTabs
      .filter(tab => !orderedTabs.find(existingTab => existingTab.id === tab.id))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    
    orderedTabs.push(...otherExtensionTabs);

    return orderedTabs;
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