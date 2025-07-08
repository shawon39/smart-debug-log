class DebugLogManager {
  constructor() {
    this.sessions = new Map();
    this.pollIntervals = new Map();
    this.lastLogTimes = new Map();
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;
    
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name.startsWith('debug-poll-')) {
        const orgId = alarm.name.replace('debug-poll-', '');
        this.pollDebugLogs(orgId);
      }
    });

    this.isInitialized = true;
  }

  async startMonitoring(orgId, session, options = {}) {
    const {
      pollInterval = 30,
      logLimit = 15,
      notifyOnNew = true,
      autoDownload = false,
      filterUsers = [],
      logTypes = ['USER_DEBUG']
    } = options;

    try {
      const infrastructureReady = await this.ensureDebugInfrastructure(session);
      if (!infrastructureReady) {
        // Continue anyway
      }
    } catch (error) {
      // Continue anyway
    }

    this.sessions.set(orgId, {
      ...session,
      options: {
        pollInterval,
        logLimit,
        notifyOnNew,
        autoDownload,
        filterUsers,
        logTypes
      },
      isMonitoring: true,
      startTime: Date.now()
    });

    await this.initializeLastLogTime(orgId, session);

    await chrome.alarms.create(`debug-poll-${orgId}`, {
      delayInMinutes: 0.5,
      periodInMinutes: pollInterval / 60
    });
    
    return {
      success: true,
      message: `Monitoring started for org ${orgId}`,
      pollInterval
    };
  }

  async stopMonitoring(orgId) {
    await chrome.alarms.clear(`debug-poll-${orgId}`);

    this.sessions.delete(orgId);
    this.lastLogTimes.delete(orgId);
    
    return {
      success: true,
      message: `Monitoring stopped for org ${orgId}`
    };
  }

  getMonitoringStatus() {
    const status = [];
    
    for (const [orgId, session] of this.sessions.entries()) {
      status.push({
        orgId,
        hostname: session.hostname,
        isMonitoring: session.isMonitoring,
        startTime: session.startTime,
        pollInterval: session.options.pollInterval,
        logLimit: session.options.logLimit,
        lastPoll: this.lastLogTimes.get(orgId)?.lastPoll,
        logCount: this.lastLogTimes.get(orgId)?.logCount || 0
      });
    }

    return status;
  }

  async initializeLastLogTime(orgId, session) {
    try {
      const query = `SELECT Id, LogUserId, StartTime FROM ApexLog ORDER BY StartTime DESC LIMIT 1`;
      const result = await this.executeToolingQuery(session, query);
      
      if (result.records && result.records.length > 0) {
        const lastLog = result.records[0];
        this.lastLogTimes.set(orgId, {
          lastLogTime: lastLog.StartTime,
          lastLogId: lastLog.Id,
          lastPoll: Date.now(),
          logCount: 0
        });
      } else {
        this.lastLogTimes.set(orgId, {
          lastLogTime: new Date().toISOString(),
          lastLogId: null,
          lastPoll: Date.now(),
          logCount: 0
        });
      }
    } catch (error) {
      this.lastLogTimes.set(orgId, {
        lastLogTime: new Date().toISOString(),
        lastLogId: null,
        lastPoll: Date.now(),
        logCount: 0
      });
    }
  }

  async pollDebugLogs(orgId) {
    const session = this.sessions.get(orgId);
    if (!session || !session.isMonitoring) {
      return;
    }

    const lastLogInfo = this.lastLogTimes.get(orgId);
    if (!lastLogInfo) {
      return;
    }

    try {
      const logLimit = session.options.logLimit || 15;
      const query = `SELECT Id, LogUserId, StartTime, LogLength, Application, Operation, DurationMilliseconds 
                     FROM ApexLog 
                     WHERE StartTime > ${lastLogInfo.lastLogTime}
                     ORDER BY StartTime DESC 
                     LIMIT ${logLimit}`;

      const result = await this.executeToolingQuery(session, query);
      
      if (result && result.records && result.records.length > 0) {
        await this.processNewLogs(orgId, result.records, session);
        
        const mostRecentLog = result.records[0];
        lastLogInfo.lastLogTime = mostRecentLog.StartTime;
        lastLogInfo.lastLogId = mostRecentLog.Id;
        lastLogInfo.logCount += result.records.length;
      }

      lastLogInfo.lastPoll = Date.now();

    } catch (error) {
      // Will retry on next alarm
    }
  }

  async processNewLogs(orgId, logs, session) {
    const sessionOptions = session.options;
    
    for (const log of logs) {
      if (sessionOptions.filterUsers.length > 0 && 
          !sessionOptions.filterUsers.includes(log.LogUserId)) {
        continue;
      }

      if (sessionOptions.notifyOnNew) {
        await this.sendLogNotification(orgId, log, session);
      }

      if (sessionOptions.autoDownload) {
        try {
          await this.downloadLogContent(log.Id, session);
        } catch (downloadError) {
          // Continue
        }
      }

      await this.storeLogMetadata(orgId, log);
    }
  }

  async sendLogNotification(orgId, log, session) {
    try {
      const notificationId = `debug-log-${log.Id}`;
      
      await chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-48.png'),
        title: 'New Debug Log',
        message: `Org: ${orgId}\nOperation: ${log.Operation || 'Unknown'}\nLength: ${log.LogLength || 0} bytes`,
        priority: 1
      });
    } catch (error) {
      // Failed
    }
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

  async storeLogMetadata(orgId, log) {
    try {
      const key = `log-${orgId}-${log.Id}`;
      await chrome.storage.local.set({
        [key]: {
          ...log,
          orgId,
          storedAt: Date.now()
        }
      });
    } catch (error) {
      // Failed
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

  async ensureDebugInfrastructure(session) {
    try {
      const existingTraceFlagQuery = `SELECT Id, TracedEntityId, DebugLevelId, LogType, StartDate, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${session.userId}' AND ExpirationDate > TODAY ORDER BY CreatedDate DESC LIMIT 1`;
      
      try {
        const existingTraceFlags = await this.executeToolingQuery(session, existingTraceFlagQuery);
        if (existingTraceFlags && existingTraceFlags.length > 0) {
          return true;
        }
      } catch (error) {
        // Continue
      }

      let debugLevelId = null;
      try {
        const debugLevelQuery = "SELECT Id FROM DebugLevel WHERE DeveloperName = 'SFDC_DevConsole' LIMIT 1";
        const debugLevels = await this.executeToolingQuery(session, debugLevelQuery);
        
        if (debugLevels && debugLevels.length > 0) {
          debugLevelId = debugLevels[0].Id;
        }
      } catch (error) {
        // Continue
      }

      if (!debugLevelId) {
        const debugLevelData = {
          DeveloperName: 'SFDC_DevConsole',
          MasterLabel: 'SFDC_DevConsole',
          Apex_Code: 'DEBUG',
          Apex_Profiling: 'INFO',
          Callout: 'INFO',
          Database: 'INFO',
          System: 'DEBUG',
          Validation: 'INFO',
          Visualforce: 'INFO',
          Workflow: 'INFO'
        };

        try {
          const createResult = await this.executeToolingCreate(session, 'DebugLevel', debugLevelData);
          if (createResult && createResult.success) {
            debugLevelId = createResult.id;
          } else {
            throw new Error('Failed to create DebugLevel');
          }
        } catch (error) {
          return false;
        }
      }

      if (debugLevelId) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const traceFlagData = {
          TracedEntityId: session.userId,
          DebugLevelId: debugLevelId,
          LogType: 'USER_DEBUG',
          StartDate: new Date().toISOString(),
          ExpirationDate: tomorrow.toISOString()
        };

        try {
          const createResult = await this.executeToolingCreate(session, 'TraceFlag', traceFlagData);
          if (createResult && createResult.success) {
            return true;
          } else {
            throw new Error('Failed to create TraceFlag');
          }
        } catch (error) {
          return false;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
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
              files: ['content/salesforce-api.js']
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
              files: ['content/salesforce-api.js']
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