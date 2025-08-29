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
      
      // Method 1: sforce.connection (Classic/VF pages)
      if (typeof window.sforce !== 'undefined' && window.sforce.connection) {
        try {
          sessionId = window.sforce.connection.getSessionId();
          instanceUrl = window.sforce.connection.getServerUrl().split('/services')[0];
          
          if (sessionId && instanceUrl) {
            return { sessionId, instanceUrl };
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
            
            return { sessionId, instanceUrl };
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
          
          if (sessionId && instanceUrl) {
            return { sessionId, instanceUrl };
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
            
            return { sessionId, instanceUrl };
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
        
        return { sessionId, instanceUrl };
      }

      const result = { sessionId, instanceUrl };
      
      if (!sessionId) {
        throw new Error('No session ID found using any method');
      }
      
      return result;

    } catch (error) {
      throw new Error(`Session extraction failed: ${error.message}`);
    }
  };


})();