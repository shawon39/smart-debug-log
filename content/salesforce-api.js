class SalesforceAPIHandler {
  constructor() {
    this.sessionId = null;
    this.instanceUrl = null;
    this.setupMessageListener();
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;
    });
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.action) {
        case 'TOOLING_QUERY':
          const queryResult = await this.executeToolingQuery(message.query, message.session);
          sendResponse({ success: true, data: queryResult });
          break;

        case 'TOOLING_CREATE':
          const createResult = await this.executeToolingCreate(message.sobjectType, message.data, message.session);
          sendResponse({ success: true, data: createResult });
          break;

        case 'GET_LOG_BODY':
          const logBody = await this.getLogBody(message.logId, message.session);
          sendResponse({ success: true, data: logBody });
          break;

        case 'PING':
          sendResponse({ success: true, message: 'Content script is active' });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action: ' + message.action });
      }
    } catch (error) {
      sendResponse({ 
        success: false, 
        error: error.message,
        details: error.toString()
      });
    }
  }

  async executeToolingQuery(query, session) {
    if (!session) {
      throw new Error('No session data provided');
    }
    
    if (!session.sessionId) {
      throw new Error('No sessionId in session data. Available keys: ' + Object.keys(session).join(', '));
    }
    
    if (!session.instanceUrl) {
      throw new Error('No instanceUrl in session data. Available keys: ' + Object.keys(session).join(', '));
    }

    const url = `${session.instanceUrl}/services/data/v58.0/tooling/query/?q=${encodeURIComponent(query)}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.sessionId}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include'
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tooling API query failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      return data;
    } catch (fetchError) {
      const pageSession = this.extractSessionFromPage();
      if (pageSession && pageSession.sessionId !== session.sessionId) {
        const fallbackUrl = `${pageSession.instanceUrl}/services/data/v58.0/tooling/query/?q=${encodeURIComponent(query)}`;
        
        try {
          const fallbackResponse = await fetch(fallbackUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${pageSession.sessionId}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            credentials: 'include'
          });

          if (fallbackResponse.ok) {
            const fallbackData = await fallbackResponse.json();
            return fallbackData;
          }
        } catch (fallbackError) {
          // Continue
        }
      }
      
      throw new Error(`Failed to fetch: ${fetchError.message}`);
    }
  }

  async executeToolingCreate(sobjectType, data, session) {
    if (!session) {
      throw new Error('No session data provided');
    }
    
    if (!session.sessionId) {
      throw new Error('No sessionId in session data. Available keys: ' + Object.keys(session).join(', '));
    }
    
    if (!session.instanceUrl) {
      throw new Error('No instanceUrl in session data. Available keys: ' + Object.keys(session).join(', '));
    }

    const url = `${session.instanceUrl}/services/data/v58.0/tooling/sobjects/${sobjectType}/`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.sessionId}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tooling API create failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      return result;
    } catch (fetchError) {
      throw new Error(`Failed to create: ${fetchError.message}`);
    }
  }

  async getLogBody(logId, session) {
    if (!session) {
      throw new Error('No session data provided');
    }
    
    if (!session.sessionId) {
      throw new Error('No sessionId in session data');
    }
    
    if (!session.instanceUrl) {
      throw new Error('No instanceUrl in session data');
    }

    try {
      const sessionUrl = new URL(session.instanceUrl);
      const currentPageUrl = new URL(window.location.href);
      
      if (sessionUrl.hostname !== currentPageUrl.hostname) {
        // Continue anyway
      }
    } catch (urlError) {
      // Continue
    }

    const url = `${session.instanceUrl}/services/data/v58.0/tooling/sobjects/ApexLog/${logId}/Body/`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.sessionId}`,
          'Accept': 'text/plain'
        },
        credentials: 'include'
      });

      if (!response.ok) {
        const errorText = await response.text();
        
        let errorMessage;
        if (response.status === 404) {
          errorMessage = `Debug log not found or expired. Log ID: ${logId}. Debug logs in Salesforce expire after 24 hours or may be deleted.`;
        } else if (response.status === 403) {
          errorMessage = `Access denied to debug log. You may not have permission to view this log or it may belong to another user.`;
        } else if (response.status === 401) {
          errorMessage = `Authentication failed. Your session may have expired. Please refresh the page and try again.`;
        } else {
          errorMessage = `Failed to fetch debug log: ${response.status} ${response.statusText}`;
          if (errorText) {
            errorMessage += ` - ${errorText}`;
          }
        }
        
        throw new Error(errorMessage);
      }

      const content = await response.text();
      return { content, logId };
    } catch (fetchError) {
      const pageSession = this.extractSessionFromPage();
      if (pageSession && pageSession.sessionId !== session.sessionId) {
        const fallbackUrl = `${pageSession.instanceUrl}/services/data/v58.0/tooling/sobjects/ApexLog/${logId}/Body/`;
        
        try {
          const fallbackResponse = await fetch(fallbackUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${pageSession.sessionId}`,
              'Accept': 'text/plain'
            },
            credentials: 'include'
          });

          if (fallbackResponse.ok) {
            const fallbackContent = await fallbackResponse.text();
            return { content: fallbackContent, logId };
          }
        } catch (fallbackError) {
          // Continue
        }
      }
      
      throw new Error(`Failed to fetch log body: ${fetchError.message}`);
    }
  }

  isSalesforcePage() {
    const hostname = window.location.hostname;
    return hostname.includes('salesforce.com') || 
           hostname.includes('force.com') || 
           hostname.includes('cloudforce.com');
  }

  extractSessionFromPage() {
    try {
      let sessionId = null;
      let instanceUrl = null;
      
      if (typeof window.sforce !== 'undefined' && window.sforce.connection) {
        try {
          sessionId = window.sforce.connection.getSessionId();
          instanceUrl = window.sforce.connection.getServerUrl().split('/services')[0];
          if (sessionId && instanceUrl) {
            return { sessionId, instanceUrl };
          }
        } catch (e) {
          // Continue
        }
      }
      
      if (typeof window.$Api !== 'undefined' && window.$Api.getSessionId) {
        try {
          sessionId = window.$Api.getSessionId();
          if (sessionId) {
            instanceUrl = `https://${window.location.hostname}`;
            return { sessionId, instanceUrl };
          }
        } catch (e) {
          // Continue
        }
      }
      
      if (typeof window.UserContext !== 'undefined' && window.UserContext.sessionId) {
        try {
          sessionId = window.UserContext.sessionId;
          instanceUrl = `https://${window.location.hostname}`;
          return { sessionId, instanceUrl };
        } catch (e) {
          // Continue
        }
      }
      
      if (typeof window.$A !== 'undefined' && window.$A.getToken) {
        try {
          sessionId = window.$A.getToken('c.ltng:session');
          if (sessionId) {
            instanceUrl = `https://${window.location.hostname}`;
            return { sessionId, instanceUrl };
          }
        } catch (e) {
          // Continue
        }
      }
      
      const sidCookie = document.cookie.split(';').find(cookie => cookie.trim().startsWith('sid='));
      if (sidCookie) {
        sessionId = sidCookie.split('=')[1];
        instanceUrl = `https://${window.location.hostname}`;
        return { sessionId, instanceUrl };
      }

      const result = { sessionId, instanceUrl };
      
      if (!sessionId) {
        throw new Error('No session ID found using any method');
      }
      
      return result;
    } catch (error) {
      throw error;
    }
  }
}

// Initialize the handler
if (window.location.hostname.includes('salesforce.com') || 
    window.location.hostname.includes('force.com') || 
    window.location.hostname.includes('cloudforce.com')) {
  new SalesforceAPIHandler();
} 