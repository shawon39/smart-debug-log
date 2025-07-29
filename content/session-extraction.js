// Session and User ID Extraction Extension
// This file extends the SalesforceAPIHandler with session extraction methods

(function() {
  'use strict';
  
  // Ensure the handler class exists
  if (!window.SalesforceAPIHandler) {
    console.error('SalesforceAPIHandler not found. Load api-handler.js first.');
    return;
  }

  // Extend the SalesforceAPIHandler prototype with session extraction methods
  const SalesforceAPIHandler = window.SalesforceAPIHandler;

  SalesforceAPIHandler.prototype.extractSessionFromPage = function() {
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
  };

  SalesforceAPIHandler.prototype.extractUserIdFromPage = async function() {
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
  };

})();