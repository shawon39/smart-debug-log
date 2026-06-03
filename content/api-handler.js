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
        const handledActions = ['TOOLING_QUERY', 'TOOLING_CREATE', 'GET_LOG_BODY', 'PING', 'EXECUTE_ANONYMOUS'];
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


          case 'EXECUTE_ANONYMOUS':
            const executeResult = await this.executeAnonymous(message.code, message.session);
            sendResponse({ success: true, data: executeResult });
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

    isSalesforcePage() {
      const hostname = window.location.hostname;
      const pathname = window.location.pathname;

      // Check for all Salesforce domains
      const isDomainMatch = SALESFORCE_DOMAINS.some(domain => hostname.includes(domain));

      // Additional check for Lightning Experience paths
      const isLightningPath = pathname.includes('/lightning/');

      return isDomainMatch || isLightningPath;
    }
  }

  // Store the class globally to prevent redeclaration
  window.SalesforceAPIHandler = SalesforceAPIHandler;

  // Initialize the handler only once on Salesforce pages
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;

  const isDomainMatch = SALESFORCE_DOMAINS.some(domain => hostname.includes(domain));
  const isLightningPath = pathname.includes('/lightning/');

  if (isDomainMatch || isLightningPath) {
    // Prevent multiple instances
    if (!window.salesforceAPIHandlerInstance) {
      window.salesforceAPIHandlerInstance = new SalesforceAPIHandler();
    }
  }

})();