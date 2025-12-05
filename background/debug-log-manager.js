class DebugLogManager {
  constructor() {
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;
    this.isInitialized = true;
  }

  async downloadLogContent(logId, session) {
    try {
      const tabs = await chrome.tabs.query({});
      const salesforceTabs = tabs.filter(tab => 
        tab.url && (
          tab.url.includes('.salesforce.com') || 
          tab.url.includes('.force.com') ||
          tab.url.includes('.lightning.force.com') ||
          tab.url.includes('--c.visualforce.com') ||
          tab.url.includes('.my.salesforce.com')
        )
      );

      if (salesforceTabs.length === 0) {
        throw new Error('No Salesforce tabs available for log download');
      }

      for (const tab of salesforceTabs) {
        try {
          const isReady = await this.isContentScriptReady(tab.id);
          if (!isReady) {
            continue;
          }

          const tabUrl = new URL(tab.url);
          const instanceUrl = `https://${tabUrl.hostname}`;

          const sessionData = {
            sessionId: session.sessionId,
            instanceUrl: instanceUrl,
            orgId: session.orgId,
            domain: session.domain
          };

          const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'GET_LOG_BODY',
            logId: logId,
            session: sessionData
          });

          if (response && response.success) {
            return response.data;
          }
        } catch (error) {
          // Try next tab
        }
      }

      throw new Error('No working Salesforce tabs found');
    } catch (error) {
      throw error;
    }
  }

  async isContentScriptReady(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
      return response && response.success;
    } catch (error) {
      return false;
    }
  }

  async waitForContentScript(tabId, maxWaitTime = 5000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      if (await this.isContentScriptReady(tabId)) {
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return false;
  }



  async executeToolingCreate(session, sobjectType, data) {
    const tabs = await chrome.tabs.query({
      url: [
        "https://*.salesforce.com/*",
        "https://*.force.com/*", 
        "https://*.my.salesforce.com/*",
        "https://*.lightning.force.com/*"
      ]
    });

    if (tabs.length === 0) {
      throw new Error('No Salesforce tabs found. Please open a Salesforce page to enable API access.');
    }

    for (const tab of tabs) {
      try {
        let isScriptLoaded = false;
        try {
          const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'PING' });
          isScriptLoaded = pingResponse && pingResponse.success;
        } catch (e) {
          isScriptLoaded = false;
        }
        
        if (!isScriptLoaded) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: [
                'content/api-handler.js',
                'content/api-operations.js', 
                'content/session-extraction.js'
              ]
            });
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (injectionError) {
            continue;
          }
        }

        const isReady = await this.waitForContentScript(tab.id, 3000);
        if (!isReady) {
          continue;
        }

        let instanceUrl;
        if (tab.url) {
          const url = new URL(tab.url);
          instanceUrl = `${url.protocol}//${url.hostname}`;
        } else if (session.domain) {
          instanceUrl = `https://${session.domain}`;
        } else if (session.hostname) {
          instanceUrl = `https://${session.hostname}`;
        }

        const sessionToken = session.key || session.sessionId;
        const sessionData = {
          sessionId: sessionToken,
          instanceUrl: instanceUrl
        };

        // Validate session before attempting deployment
        if (!sessionToken || sessionToken.length < 20) {
          throw new Error('Invalid session token: too short or empty');
        }

        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'TOOLING_CREATE',
          sobjectType: sobjectType,
          data: data,
          session: sessionData
        });

        if (!response) {
          continue;
        }

        if (!response.success) {
          continue;
        }

        return response.data;

      } catch (error) {
        continue;
      }
    }

    throw new Error('Failed to execute create via content script: No working Salesforce tabs found.');
  }

  async executeToolingQuery(session, query) {
    const tabs = await chrome.tabs.query({
      url: [
        "https://*.salesforce.com/*",
        "https://*.force.com/*",
        "https://*.my.salesforce.com/*",
        "https://*.lightning.force.com/*"
      ]
    });

    if (tabs.length === 0) {
      throw new Error('No Salesforce tabs found. Please open a Salesforce page to enable API access.');
    }

    for (const tab of tabs) {
      try {
        let isScriptLoaded = false;
        try {
          const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'PING' });
          isScriptLoaded = pingResponse && pingResponse.success;
        } catch (e) {
          isScriptLoaded = false;
        }
        
        if (!isScriptLoaded) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: [
                'content/api-handler.js',
                'content/api-operations.js', 
                'content/session-extraction.js'
              ]
            });
            
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (injectionError) {
            continue;
          }
        }
        
        const isReady = await this.waitForContentScript(tab.id, 3000);
        
        if (!isReady) {
          continue;
        }

        let instanceUrl;
        if (tab.url) {
          const url = new URL(tab.url);
          instanceUrl = `${url.protocol}//${url.hostname}`;
        } else if (session.domain) {
          instanceUrl = `https://${session.domain}`;
        } else if (session.hostname) {
          instanceUrl = `https://${session.hostname}`;
        }

        const sessionToken = session.key || session.sessionId;

        const sessionData = {
          sessionId: sessionToken,
          instanceUrl: instanceUrl
        };

        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'TOOLING_QUERY',
          query: query,
          session: sessionData
        });

        if (!response) {
          continue;
        }

        if (!response.success) {
          continue;
        }

        return response.data;

      } catch (error) {
        continue;
      }
    }

    throw new Error('Failed to execute query via content script: No working Salesforce tabs found. Please refresh a Salesforce page and try again.');
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

  async getLogContent(logId) {
    try {
      const storageKey = `log-content-${logId}`;
      const result = await chrome.storage.local.get(storageKey);
      return result[storageKey] || null;
    } catch (error) {
      return null;
    }
  }
}

export default DebugLogManager; 