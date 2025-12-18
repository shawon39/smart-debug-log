// Unified Error Handling System
// This file provides centralized error handling and logging for the extension

class ErrorHandler {
  constructor() {
    this.errorLog = [];
    this.maxErrorLogSize = 100;
    this.debug = false; // Set to true for debugging
  }

  /**
   * Logs an error with context
   * @param {Error|string} error - Error object or message
   * @param {string} context - Context where error occurred
   * @param {Object} metadata - Additional metadata
   */
  logError(error, context = 'unknown', metadata = {}) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      context: context,
      message: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : null,
      metadata: metadata
    };

    this.errorLog.push(errorEntry);
    
    // Keep error log size manageable
    if (this.errorLog.length > this.maxErrorLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxErrorLogSize);
    }

    // Log to console in debug mode
    if (this.debug) {
      console.error(`[${context}]`, error, metadata);
    }

    return errorEntry;
  }

  /**
   * Handles Salesforce API errors specifically
   * @param {Error} error - API error
   * @param {string} operation - API operation that failed
   * @param {Object} requestData - Request data for context
   * @returns {Object} Structured error info
   */
  handleApiError(error, operation, requestData = {}) {
    const errorInfo = {
      type: 'api_error',
      operation: operation,
      isRetryable: false,
      userMessage: 'An error occurred while communicating with Salesforce.',
      technicalMessage: error.message
    };

    // Categorize common API errors
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      errorInfo.type = 'auth_error';
      errorInfo.userMessage = 'Authentication failed. Please refresh Salesforce and try again.';
      errorInfo.isRetryable = true;
    } else if (error.message.includes('404') || error.message.includes('not found')) {
      errorInfo.type = 'not_found_error';
      errorInfo.userMessage = 'The requested resource was not found or may have expired.';
    } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
      errorInfo.type = 'permission_error';
      errorInfo.userMessage = 'You do not have permission to access this resource.';
    } else if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
      errorInfo.type = 'timeout_error';
      errorInfo.userMessage = 'The request timed out. Please try again.';
      errorInfo.isRetryable = true;
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      errorInfo.type = 'network_error';
      errorInfo.userMessage = 'Network error. Please check your connection and try again.';
      errorInfo.isRetryable = true;
    }

    this.logError(error, `api_${operation}`, { requestData, errorInfo });
    return errorInfo;
  }

  /**
   * Handles Chrome extension API errors
   * @param {Error} error - Chrome API error
   * @param {string} api - Chrome API that failed
   * @returns {Object} Structured error info
   */
  handleChromeError(error, api) {
    const errorInfo = {
      type: 'chrome_error',
      api: api,
      userMessage: 'Browser extension error occurred.',
      technicalMessage: error.message
    };

    if (error.message.includes('tab') || error.message.includes('Tab')) {
      errorInfo.userMessage = 'Unable to communicate with Salesforce tab. Please refresh the page.';
    } else if (error.message.includes('script') || error.message.includes('Script')) {
      errorInfo.userMessage = 'Failed to load extension scripts. Please refresh the page.';
    } else if (error.message.includes('storage') || error.message.includes('Storage')) {
      errorInfo.userMessage = 'Extension storage error. Some features may not work properly.';
    }

    this.logError(error, `chrome_${api}`, { errorInfo });
    return errorInfo;
  }
}

// Create singleton instance
const errorHandler = new ErrorHandler();