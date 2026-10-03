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

  // Runs the query with the session the dashboard passed in. There is no fallback to this
  // page's own session: that session can belong to another org, and the real error is
  // more useful than a different org's data.
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

    return response.json();
  };

})();