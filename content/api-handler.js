// Prevent multiple declarations and instantiations
(function () {
  'use strict';

  // Check if already loaded
  if (window.SalesforceAPIHandler) {
    return;
  }

  // Salesforce domains the extension operates on (single source of truth).
  const SALESFORCE_DOMAINS = [
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

  // Exact host or a subdomain of it (a substring check would also accept e.g. myforce.com)
  const isSalesforceHost = (hostname) =>
    SALESFORCE_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));

  class SalesforceAPIHandler {
    constructor() {
      this.setupMessageListener();
    }

    // Salesforce API version constant. Keep it equal to API_VERSION in
    // background/api-client.js (content scripts cannot import modules).
    static get API_VERSION() {
      return 'v62.0';
    }

    setupMessageListener() {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const handledActions = ['TOOLING_QUERY', 'PING'];
        if (!handledActions.includes(message.action)) {
          return false; // Don't handle other message types
        }
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
  }

  // Store the class globally to prevent redeclaration
  window.SalesforceAPIHandler = SalesforceAPIHandler;

  // Initialize the handler only once on Salesforce pages
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;

  const isDomainMatch = isSalesforceHost(hostname);
  const isLightningPath = pathname.includes('/lightning/');

  if (isDomainMatch || isLightningPath) {
    // Prevent multiple instances
    if (!window.salesforceAPIHandlerInstance) {
      window.salesforceAPIHandlerInstance = new SalesforceAPIHandler();
    }
  }

})();