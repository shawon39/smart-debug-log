// Prevent multiple declarations and instantiations
(function() {
  'use strict';
  
  // Check if already loaded
  if (window.SalesforceAPIHandler) {
    return;
  }

  class SalesforceAPIHandler {
    constructor() {
      this.sessionId = null;
      this.instanceUrl = null;
      this.setupMessageListener();
    }

    // Salesforce API version constant
    static get API_VERSION() {
      return 'v62.0';
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

          case 'EXTRACT_USER_ID':
            const userIdResult = await this.extractUserIdFromPage();
            sendResponse({ success: true, userId: userIdResult });
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
    }

    isSalesforcePage() {
      const hostname = window.location.hostname;
      const pathname = window.location.pathname;
      
      // Check for all Salesforce domains
      const salesforceDomains = [
        'salesforce.com',
        'force.com', 
        'cloudforce.com',
        'salesforce.mil',
        'cloudforce.mil',
        'sfcrmproducts.cn',
        'visual.force.com',
        'lightning.force.com',
        'my.salesforce.com',
        'sandbox.my.salesforce.com',
        'develop.my.salesforce.com',
        'scratch.my.salesforce.com',
        'salesforce-setup.com'
      ];
      
      const isDomainMatch = salesforceDomains.some(domain => hostname.includes(domain));
      
      // Additional check for Lightning Experience paths
      const isLightningPath = pathname.includes('/lightning/');
      
      return isDomainMatch || isLightningPath;
    }

    extractSessionFromPage() {
      try {
        let sessionId = null;
        let instanceUrl = null;
        let userId = null;
        
        // Method 1: sforce.connection (Classic/VF pages)
        if (typeof window.sforce !== 'undefined' && window.sforce.connection) {
          try {
            sessionId = window.sforce.connection.getSessionId();
            instanceUrl = window.sforce.connection.getServerUrl().split('/services')[0];
            
            // Try to get user ID from sforce.connection
            if (window.sforce.connection.getUserId) {
              userId = window.sforce.connection.getUserId();
            }
            
            if (sessionId && instanceUrl) {
              return { sessionId, instanceUrl, userId };
            }
          } catch (e) {
            // Continue to next method
          }
        }
        
        // Method 2: $Api (Lightning Experience)
        if (typeof window.$Api !== 'undefined' && window.$Api.getSessionId) {
          try {
            sessionId = window.$Api.getSessionId();
            if (sessionId) {
              instanceUrl = `https://${window.location.hostname}`;
              
              // Try to get user ID from $Api
              if (window.$Api.getUserId) {
                userId = window.$Api.getUserId();
              }
              
              return { sessionId, instanceUrl, userId };
            }
          } catch (e) {
            // Continue to next method
          }
        }
        
        // Method 3: UserContext (Lightning Experience)
        if (typeof window.UserContext !== 'undefined') {
          try {
            if (window.UserContext.sessionId) {
              sessionId = window.UserContext.sessionId;
              instanceUrl = `https://${window.location.hostname}`;
            }
            
            // Extract user ID from UserContext
            if (window.UserContext.userId) {
              userId = window.UserContext.userId;
            }
            
            if (sessionId && instanceUrl) {
              return { sessionId, instanceUrl, userId };
            }
          } catch (e) {
            // Continue to next method
          }
        }
        
        // Method 4: Lightning ($A)
        if (typeof window.$A !== 'undefined' && window.$A.getToken) {
          try {
            sessionId = window.$A.getToken('c.ltng:session');
            if (sessionId) {
              instanceUrl = `https://${window.location.hostname}`;
              
              // Try to get user ID from Lightning context
              if (window.$A.get && window.$A.get('$SObjectType.User.Id')) {
                userId = window.$A.get('$SObjectType.User.Id');
              } else if (window.$A.getContext) {
                const context = window.$A.getContext();
                if (context && context.getGlobalValueProviders) {
                  const gvp = context.getGlobalValueProviders();
                  if (gvp && gvp['$CurrentUser'] && gvp['$CurrentUser'].getValue) {
                    const currentUser = gvp['$CurrentUser'].getValue();
                    if (currentUser && currentUser.Id) {
                      userId = currentUser.Id;
                    }
                  }
                }
              }
              
              return { sessionId, instanceUrl, userId };
            }
          } catch (e) {
            // Continue to next method
          }
        }
        
        // Method 5: Cookie-based extraction
        const sidCookie = document.cookie.split(';').find(cookie => cookie.trim().startsWith('sid='));
        if (sidCookie) {
          sessionId = sidCookie.split('=')[1];
          instanceUrl = `https://${window.location.hostname}`;
          
          // Try to extract user ID from session cookie if possible
          // Session format is typically: orgId!sessionId!...
          // But user ID extraction from cookie is limited
          
          return { sessionId, instanceUrl, userId };
        }

        // Method 6: Extract from page DOM/Scripts (fallback)
        try {
          // Look for user ID in page content (Lightning pages often have it)
          const scripts = document.querySelectorAll('script');
          for (const script of scripts) {
            const content = script.textContent || script.innerHTML;
            
            // Look for common patterns where user ID appears
            const userIdMatches = content.match(/"userId"\s*:\s*"([a-zA-Z0-9]{15,18})"/);
            if (userIdMatches) {
              userId = userIdMatches[1];
              break;
            }
            
            // Look for CurrentUser patterns
            const currentUserMatches = content.match(/"Id"\s*:\s*"([a-zA-Z0-9]{15,18})".*"Type"\s*:\s*"User"/);
            if (currentUserMatches) {
              userId = currentUserMatches[1];
              break;
            }
          }
        } catch (e) {
          // Continue
        }

        const result = { sessionId, instanceUrl, userId };
        
        if (!sessionId) {
          throw new Error('No session ID found using any method');
        }
        
        return result;

      } catch (error) {
        throw new Error(`Session extraction failed: ${error.message}`);
      }
    }

    async extractUserIdFromPage() {
      try {
        let userId = null;
        
        // Method 1: UserContext (most common in Lightning)
        if (typeof window.UserContext !== 'undefined' && window.UserContext.userId) {
          userId = window.UserContext.userId;
          return userId;
        }
        
        // Method 2: sforce.connection
        if (typeof window.sforce !== 'undefined' && window.sforce.connection && window.sforce.connection.getUserId) {
          try {
            userId = window.sforce.connection.getUserId();
            if (userId) {
              return userId;
            }
          } catch (e) {
            // Continue to next method
          }
        }
        
        // Method 3: $Api
        if (typeof window.$Api !== 'undefined' && window.$Api.getUserId) {
          try {
            userId = window.$Api.getUserId();
            if (userId) {
              return userId;
            }
          } catch (e) {
            // Continue to next method
          }
        }
        
        // Method 4: Lightning context ($A)
        if (typeof window.$A !== 'undefined') {
          try {
            // Try different Lightning methods
            if (window.$A.get) {
              // Try getting current user ID
              const currentUserId = window.$A.get('$SObjectType.User.Id');
              if (currentUserId) {
                userId = currentUserId;
                return userId;
              }
              
              // Try getting from global value provider
              const globalUserId = window.$A.get('$Global.CurrentUser.Id');
              if (globalUserId) {
                userId = globalUserId;
                return userId;
              }
            }
            
            // Try getting from context
            if (window.$A.getContext) {
              const context = window.$A.getContext();
              if (context && context.getGlobalValueProviders) {
                const gvp = context.getGlobalValueProviders();
                if (gvp && gvp['$CurrentUser'] && gvp['$CurrentUser'].getValue) {
                  const currentUser = gvp['$CurrentUser'].getValue();
                  if (currentUser && currentUser.Id) {
                    userId = currentUser.Id;
                    return userId;
                  }
                }
              }
            }
          } catch (e) {
            // Continue to next method
          }
        }
        
        // Method 5: Parse from page content/scripts
        try {
          const scripts = document.querySelectorAll('script');
          for (const script of scripts) {
            const content = script.textContent || script.innerHTML;
            
            // Look for user ID patterns in script content
            const patterns = [
              /"userId"\s*:\s*"([a-zA-Z0-9]{15,18})"/,
              /"Id"\s*:\s*"([a-zA-Z0-9]{15,18})"[^}]*"Type"\s*:\s*"User"/,
              /"currentUserId"\s*:\s*"([a-zA-Z0-9]{15,18})"/,
              /currentUser.*"Id"\s*:\s*"([a-zA-Z0-9]{15,18})"/,
              /User\.Id[^"]*"([a-zA-Z0-9]{15,18})"/
            ];
            
            for (const pattern of patterns) {
              const match = content.match(pattern);
              if (match && match[1]) {
                userId = match[1];
                return userId;
              }
            }
          }
        } catch (e) {
          // Continue to next method
        }
        
        // Method 6: Query current user via REST API as fallback
        try {
          const sessionData = this.extractSessionFromPage();
          if (sessionData && sessionData.sessionId && sessionData.instanceUrl) {
            const response = await fetch(`${sessionData.instanceUrl}/services/data/${SalesforceAPIHandler.API_VERSION}/query/?q=SELECT+Id+FROM+User+WHERE+Id+=+UserInfo.getUserId()`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${sessionData.sessionId}`,
                'Accept': 'application/json'
              }
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.records && data.records.length > 0) {
                userId = data.records[0].Id;
                return userId;
              }
            }
          }
        } catch (e) {
          // Continue
        }
        
        console.warn('Could not extract user ID from page');
        return null;
        
      } catch (error) {
        console.error('Error extracting user ID:', error);
        return null;
      }
    }
  }

  // Store the class globally to prevent redeclaration
  window.SalesforceAPIHandler = SalesforceAPIHandler;

  // Initialize the handler only once on Salesforce pages
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;
  
  const salesforceDomains = [
    'salesforce.com',
    'force.com', 
    'cloudforce.com',
    'salesforce.mil',
    'cloudforce.mil',
    'sfcrmproducts.cn',
    'visual.force.com',
    'lightning.force.com',
    'my.salesforce.com',
    'sandbox.my.salesforce.com',
    'develop.my.salesforce.com',
    'scratch.my.salesforce.com',
    'salesforce-setup.com'
  ];
  
  const isDomainMatch = salesforceDomains.some(domain => hostname.includes(domain));
  const isLightningPath = pathname.includes('/lightning/');
  
  if (isDomainMatch || isLightningPath) {
    // Prevent multiple instances
    if (!window.salesforceAPIHandlerInstance) {
      window.salesforceAPIHandlerInstance = new SalesforceAPIHandler();
    }
  }

})(); 