// Salesforce API Operations Extension
// This file extends the SalesforceAPIHandler with API operation methods

(function() {
  'use strict';
  
  // Ensure the handler class exists
  if (!window.SalesforceAPIHandler) {
    console.error('SalesforceAPIHandler not found. Load api-handler.js first.');
    return;
  }

  // Extend the SalesforceAPIHandler prototype with API operations
  const SalesforceAPIHandler = window.SalesforceAPIHandler;

  SalesforceAPIHandler.prototype.executeToolingQuery = async function(query, session) {
    if (!session) {
      throw new Error('No session data provided');
    }
    
    if (!session.sessionId) {
      throw new Error('No sessionId in session data. Available keys: ' + Object.keys(session).join(', '));
    }
    
    if (!session.instanceUrl) {
      throw new Error('No instanceUrl in session data. Available keys: ' + Object.keys(session).join(', '));
    }

    const url = `${session.instanceUrl}/services/data/${SalesforceAPIHandler.API_VERSION}/tooling/query/?q=${encodeURIComponent(query)}`;

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
        const fallbackUrl = `${pageSession.instanceUrl}/services/data/${SalesforceAPIHandler.API_VERSION}/tooling/query/?q=${encodeURIComponent(query)}`;
        
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
          // Continue to throw original error
        }
      }
      
      throw new Error(`Failed to fetch: ${fetchError.message}`);
    }
  };

  SalesforceAPIHandler.prototype.executeToolingCreate = async function(sobjectType, data, session) {
    if (!session) {
      throw new Error('No session data provided');
    }
    
    if (!session.sessionId) {
      throw new Error('No sessionId in session data. Available keys: ' + Object.keys(session).join(', '));
    }
    
    if (!session.instanceUrl) {
      throw new Error('No instanceUrl in session data. Available keys: ' + Object.keys(session).join(', '));
    }

    // Validate the instance URL for sandbox environments
    const instanceUrl = session.instanceUrl.replace(/\/$/, ''); // Remove trailing slash
    const url = `${instanceUrl}/services/data/${SalesforceAPIHandler.API_VERSION}/tooling/sobjects/${sobjectType}/`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.sessionId}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-SFDC-Session': session.sessionId
        },
        credentials: 'include',
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorObj;
        
        try {
          errorObj = JSON.parse(errorText);
        } catch (e) {
          errorObj = { message: errorText };
        }
        
        // Handle specific Salesforce error codes
        if (response.status === 400) {
          if (errorObj.message && errorObj.message.includes('DUPLICATE_VALUE')) {
            throw new Error(`DUPLICATES_DETECTED: ${sobjectType} with this name already exists`);
          } else if (errorObj.message && errorObj.message.includes('COMPILE')) {
            throw new Error(`COMPILE_ERROR: ${errorObj.message}`);
          }
        } else if (response.status === 401) {
          throw new Error(`INVALID_SESSION_ID: Authentication failed - ${errorObj.message || 'Session expired'}`);
        } else if (response.status === 403) {
          throw new Error(`INSUFFICIENT_ACCESS: ${errorObj.message || 'Insufficient permissions to deploy Apex classes'}`);
        }
        
        throw new Error(`Tooling API create failed (${SalesforceAPIHandler.API_VERSION}): ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      return result;
      
    } catch (fetchError) {
      throw new Error(`Failed to create: ${fetchError.message}`);
    }
  };

  SalesforceAPIHandler.prototype.getLogBody = async function(logId, session) {
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
        // Continue anyway - cross-domain session might still work
      }
    } catch (urlError) {
      // Continue
    }

    const url = `${session.instanceUrl}/services/data/${SalesforceAPIHandler.API_VERSION}/tooling/sobjects/ApexLog/${logId}/Body/`;

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
        const fallbackUrl = `${pageSession.instanceUrl}/services/data/${SalesforceAPIHandler.API_VERSION}/tooling/sobjects/ApexLog/${logId}/Body/`;
        
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
          // Continue to throw original error
        }
      }
      
      throw new Error(`Failed to fetch log body: ${fetchError.message}`);
    }
  };

})();