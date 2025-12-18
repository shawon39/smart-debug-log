// Error Extraction Utilities
// This file contains functions for extracting and formatting error messages from Salesforce debug logs

/**
 * Checks if a line is a pipe-delimited log entry
 * @param {string} line - Line to check
 * @returns {boolean} - True if line is a pipe-delimited entry
 */
function isPipeLine(line) {
  return /^\d{2}:\d{2}:\d{2}\.\d+\s*\(\d+\)\|/.test(line);
}

/**
 * Extracts event type from a pipe-delimited log line
 * @param {string} line - Log line
 * @returns {string|null} - Event type or null
 */
function extractEventType(line) {
  const match = line.match(/^\d{2}:\d{2}:\d{2}\.\d+\s*\(\d+\)\|(\w+)\|/);
  return match ? match[1] : null;
}

/**
 * Extracts code unit name from CODE_UNIT_STARTED line
 * @param {string} line - Log line
 * @returns {string|null} - Code unit name or null
 */
function extractCodeUnitName(line) {
  // Extract name from CODE_UNIT_STARTED|[EXTERNAL]|...|TriggerName or ClassName.methodName
  const match = line.match(/CODE_UNIT_STARTED\|[^|]*\|[^|]*\|(.+)/);
  return match ? match[1].trim() : null;
}

/**
 * Extracts error information from debug log content
 * @param {string} content - Raw debug log content 
 * @returns {object} - Object containing parsed error information
 */
function extractErrorsFromDebugLog(content) {
  if (!content || typeof content !== 'string') {
    return {
      hasErrors: false,
      hasFatalErrors: false,
      hasExceptions: false,
      errors: [],
      errorSummary: null
    };
  }

  const errors = [];
  const lines = content.split('\n');
  const codeUnitStack = [];
  let collectingStackTrace = false;
  let currentError = null;
  
  // Single-pass parsing with CODE_UNIT tracking
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if this is a pipe-delimited log entry
    if (isPipeLine(line)) {
      const eventType = extractEventType(line);
      
      // Track CODE_UNIT context
      if (eventType === 'CODE_UNIT_STARTED') {
        const unitName = extractCodeUnitName(line);
        if (unitName) {
          codeUnitStack.push(unitName);
        }
      } else if (eventType === 'CODE_UNIT_FINISHED') {
        if (codeUnitStack.length > 0) {
          codeUnitStack.pop();
        }
      }
      
      // Handle FATAL_ERROR
      if (eventType === 'FATAL_ERROR') {
        const fatalErrorMatch = line.match(/^\d{2}:\d{2}:\d{2}\.\d+\s*\(\d+\)\|FATAL_ERROR\|(.*)/);
        if (fatalErrorMatch) {
          const firstErrorLine = fatalErrorMatch[1].trim();
          const errorDetails = parseErrorMessage(firstErrorLine);
          
          currentError = {
            type: 'FATAL_ERROR',
            isFatal: true,
            timestamp: extractTimestamp(line),
            rawMessage: firstErrorLine,
            parsedMessage: errorDetails,
            location: null,
            stackTrace: [],
            lineNumber: null,
            columnNumber: null,
            line: i + 1,
            codeUnitContext: codeUnitStack.length > 0 ? codeUnitStack[codeUnitStack.length - 1] : null
          };
          
          errors.push(currentError);
          collectingStackTrace = true;
        }
      }
      
      // Handle EXCEPTION_THROWN
      else if (eventType === 'EXCEPTION_THROWN') {
        const exceptionMatch = line.match(/^\d{2}:\d{2}:\d{2}\.\d+\s*\(\d+\)\|EXCEPTION_THROWN\|(.*)/);
        if (exceptionMatch) {
          let exceptionLine = exceptionMatch[1].trim();
          
          // Strip [lineNumber]| prefix if present (e.g., "[36]|System.AssertException...")
          exceptionLine = exceptionLine.replace(/^\[\d+\]\|/, '');
          
          const errorDetails = parseErrorMessage(exceptionLine);
          
          currentError = {
            type: 'EXCEPTION_THROWN',
            isFatal: false,
            timestamp: extractTimestamp(line),
            rawMessage: exceptionLine,
            parsedMessage: errorDetails,
            location: null,
            stackTrace: [],
            lineNumber: null,
            columnNumber: null,
            line: i + 1,
            codeUnitContext: codeUnitStack.length > 0 ? codeUnitStack[codeUnitStack.length - 1] : null
          };
          
          errors.push(currentError);
          collectingStackTrace = true;
        }
      }
      
      // Any other pipe line stops stack trace collection
      else {
        collectingStackTrace = false;
        currentError = null;
      }
    }
    
    // Collect stack trace lines (non-pipe lines after error)
    else if (collectingStackTrace && currentError) {
      const cleanLine = line.trim();
      if (cleanLine) {
        // Check if this is a stack trace line
        if (cleanLine.match(/^(Class\.|Trigger\.|AnonymousBlock:)/)) {
          currentError.stackTrace.push(cleanLine);
        } else {
          // Add to the main error message
          currentError.rawMessage += '\n' + cleanLine;
        }
      }
    }
  }
  
  // Extract line/column numbers from stack traces
  errors.forEach(error => {
    if (error.stackTrace && error.stackTrace.length > 0) {
      error.location = error.stackTrace.join('\n');
      
      const firstTrace = error.stackTrace[0];
      const linePatterns = [
        /line\s+(\d+)/i,
        /line:\s*(\d+)/i,
        /Line\s+(\d+)/i
      ];
      
      const columnPatterns = [
        /column\s+(\d+)/i,
        /column:\s*(\d+)/i
      ];
      
      for (const pattern of linePatterns) {
        const match = firstTrace.match(pattern);
        if (match) {
          error.lineNumber = parseInt(match[1], 10);
          break;
        }
      }
      
      for (const pattern of columnPatterns) {
        const match = firstTrace.match(pattern);
        if (match) {
          error.columnNumber = parseInt(match[1], 10);
          break;
        }
      }
    }
    
    // Fallback: try to extract line number from the error message itself
    if (error.lineNumber === null) {
      const errorLineMatch = error.rawMessage.match(/line\s+(\d+)/i);
      if (errorLineMatch) {
        error.lineNumber = parseInt(errorLineMatch[1], 10);
      }
    }
  });
  
  // Look for other error patterns (compilation errors, runtime exceptions, etc.)
  const additionalErrors = extractAdditionalErrors(lines);
  errors.push(...additionalErrors);
  
  // Apply smart deduplication with FATAL_ERROR priority
  const uniqueErrors = deduplicateErrors(errors);
  
  // Separate fatal errors from exceptions
  const fatalErrors = uniqueErrors.filter(e => e.isFatal);
  const exceptions = uniqueErrors.filter(e => !e.isFatal);
  
  return {
    hasErrors: uniqueErrors.length > 0,
    hasFatalErrors: fatalErrors.length > 0,
    hasExceptions: exceptions.length > 0,
    errors: uniqueErrors,
    errorSummary: createErrorSummary(uniqueErrors)
  };
}

/**
 * Creates a composite deduplication key for an error
 * @param {object} error - Error object
 * @returns {string} - Composite key
 */
function createErrorKey(error) {
  const exceptionType = error.parsedMessage?.exceptionType || 'Unknown';
  const message = error.parsedMessage?.message || '';
  const context = error.codeUnitContext || '';
  return `${exceptionType}|${message}|${context}`;
}

/**
 * Deduplicates errors with FATAL_ERROR taking priority over EXCEPTION_THROWN
 * @param {array} errors - Array of error objects
 * @returns {array} - Deduplicated array of errors
 */
function deduplicateErrors(errors) {
  const keyMap = new Map();
  
  for (const error of errors) {
    const key = createErrorKey(error);
    const existing = keyMap.get(key);
    
    if (!existing) {
      keyMap.set(key, error);
    } else if (error.type === 'FATAL_ERROR' && existing.type !== 'FATAL_ERROR') {
      // FATAL_ERROR takes priority over EXCEPTION_THROWN
      keyMap.set(key, error);
    }
    // Otherwise keep existing (first occurrence)
  }
  
  return Array.from(keyMap.values());
}

/**
 * Parses error message to extract exception type and message
 * @param {string} errorMessage - Raw error message
 * @returns {object} - Parsed error details
 */
function parseErrorMessage(errorMessage) {
  // Common Salesforce exception patterns
  const patterns = [
    // Standard exception: ExceptionType: Message
    /^(\w+(?:\.\w+)*Exception):\s*(.+)$/,
    // System exception: System.ExceptionType: Message  
    /^(System\.\w+(?:\.\w+)*Exception):\s*(.+)$/,
    // Custom exception patterns
    /^(\w+):\s*(.+)$/
  ];
  
  for (const pattern of patterns) {
    const match = errorMessage.match(pattern);
    if (match) {
      return {
        exceptionType: match[1],
        message: match[2].trim(),
        fullMessage: errorMessage
      };
    }
  }
  
  // If no pattern matches, return as generic error
  return {
    exceptionType: 'Error',
    message: errorMessage,
    fullMessage: errorMessage
  };
}

/**
 * Extracts additional error patterns from debug log lines
 * @param {array} lines - Array of log lines
 * @returns {array} - Array of additional errors found
 */
function extractAdditionalErrors(lines) {
  const errors = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for compilation errors
    const compileErrorMatch = line.match(/^\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\)\|.*COMPILE.*ERROR/i);
    if (compileErrorMatch) {
      errors.push({
        type: 'COMPILE_ERROR',
        isFatal: true,
        timestamp: extractTimestamp(line),
        rawMessage: line,
        parsedMessage: {
          exceptionType: 'CompileError',
          message: 'Compilation error occurred',
          fullMessage: line
        },
        location: null,
        line: i + 1
      });
    }
    
    // Look for validation errors
    const validationErrorMatch = line.match(/^\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\)\|.*VALIDATION.*ERROR/i);
    if (validationErrorMatch) {
      errors.push({
        type: 'VALIDATION_ERROR',
        isFatal: true,
        timestamp: extractTimestamp(line),
        rawMessage: line,
        parsedMessage: {
          exceptionType: 'ValidationError',
          message: 'Validation error occurred',
          fullMessage: line
        },
        location: null,
        line: i + 1
      });
    }
  }
  
  return errors;
}

/**
 * Extracts timestamp from a debug log line
 * @param {string} line - Debug log line
 * @returns {string|null} - Extracted timestamp
 */
function extractTimestamp(line) {
  const timestampMatch = line.match(/^(\d{2}:\d{2}:\d{2}\.\d+)/);
  return timestampMatch ? timestampMatch[1] : null;
}

/**
 * Creates a summary of errors found
 * @param {array} errors - Array of error objects
 * @returns {object|null} - Error summary object
 */
function createErrorSummary(errors) {
  if (errors.length === 0) {
    return null;
  }
  
  const errorTypes = {};
  let mostRecentError = null;
  
  errors.forEach(error => {
    // Count error types
    const type = error.parsedMessage.exceptionType || error.type;
    errorTypes[type] = (errorTypes[type] || 0) + 1;
    
    // Track most recent error
    if (!mostRecentError || error.line > mostRecentError.line) {
      mostRecentError = error;
    }
  });
  
  return {
    totalErrors: errors.length,
    errorTypes: errorTypes,
    mostRecentError: mostRecentError,
    primaryErrorType: mostRecentError ? mostRecentError.parsedMessage.exceptionType : 'Unknown'
  };
}

/**
 * Generates filter checkbox controls for error display
 * @param {object} errorData - Error data from extractErrorsFromDebugLog
 * @param {object} activeFilters - Object with showFatal and showException booleans
 * @returns {string} - HTML for filter controls
 */
function generateFilterPills(errorData, activeFilters) {
  const hasFatal = errorData.hasFatalErrors;
  const hasException = errorData.hasExceptions;
  
  // If only one type exists, don't show filters
  if (!hasFatal || !hasException) {
    return '';
  }
  
  const fatalCount = errorData.errors.filter(e => e.isFatal).length;
  const exceptionCount = errorData.errors.filter(e => !e.isFatal).length;
  
  let html = '<div class="error-filter-pills">';
  
  html += `<label class="filter-checkbox">
    <input type="checkbox" data-filter="fatal" ${activeFilters.showFatal ? 'checked' : ''}>
    <span class="checkbox-label">Fatal Errors (${fatalCount})</span>
  </label>`;
  
  html += `<label class="filter-checkbox">
    <input type="checkbox" data-filter="exception" ${activeFilters.showException ? 'checked' : ''}>
    <span class="checkbox-label">Exception Thrown (${exceptionCount})</span>
  </label>`;
  
  html += '</div>';
  
  return html;
}

/**
 * Formats errors for display in the UI
 * @param {object} errorData - Error data from extractErrorsFromDebugLog
 * @param {object} filters - Object with showFatal and showException booleans (default: both true)
 * @returns {string} - HTML formatted error display
 */
function formatErrorsForDisplay(errorData, filters = { showFatal: true, showException: true }) {
  if (!errorData.hasErrors) {
    return '<div class="error-status-success">✅ No errors found in this debug log</div>';
  }
  
  // Smart filter adjustment: if only exceptions exist and fatal is selected, auto-show exceptions
  let adjustedFilters = { ...filters };
  if (!errorData.hasFatalErrors && errorData.hasExceptions) {
    // Only exceptions exist, make sure they're shown
    adjustedFilters.showException = true;
  }
  if (errorData.hasFatalErrors && !errorData.hasExceptions) {
    // Only fatal errors exist, make sure they're shown
    adjustedFilters.showFatal = true;
  }
  
  // Filter controls HTML
  const pillsHtml = generateFilterPills(errorData, adjustedFilters);
  
  // Filter errors based on selected checkboxes
  let filteredErrors = errorData.errors.filter(e => {
    if (e.isFatal && adjustedFilters.showFatal) return true;
    if (!e.isFatal && adjustedFilters.showException) return true;
    return false;
  });
  
  // If no errors match the filters, show appropriate message
  if (filteredErrors.length === 0) {
    let message = 'No errors match the selected filters';
    if (!adjustedFilters.showFatal && !adjustedFilters.showException) {
      message = 'Please select at least one filter to view errors';
    }
    return pillsHtml + `<div class="error-status-info">ℹ️ ${message}</div>`;
  }
  
  let html = pillsHtml + '<div class="error-section">';
  
  // Add individual error details
  filteredErrors.forEach((error, index) => {
    html += '<div class="error-item-block">';
    
    // Add error number badge for multiple errors with appropriate class
    if (filteredErrors.length > 1) {
      const badgeClass = error.isFatal ? 'error-number-badge' : 'error-number-badge exception-badge';
      html += `<span class="${badgeClass}">${index + 1}</span>`;
    }
    
    // Error type header
    html += '<div class="error-type-header">';
    html += `<strong>${getErrorTypeDisplayName(error.type)}</strong>`;
    
    // Show code unit context if available
    if (error.codeUnitContext) {
      html += ` <span class="code-unit-context">(in ${escapeHtml(error.codeUnitContext)})</span>`;
    }
    
    html += '</div>';
    
    // Full error message (preserve multi-line formatting)
    html += '<div class="error-message-text">';
    const formattedMessage = escapeHtml(error.rawMessage).replace(/\n/g, '<br>');
    html += formattedMessage;
    html += '</div>';
    
    // Stack trace information (if available)
    if (error.stackTrace && error.stackTrace.length > 0) {
      html += '<div class="error-stack-trace">';
      html += '<div class="stack-trace-header">Stack Trace:</div>';
      error.stackTrace.forEach(trace => {
        html += '<div class="stack-trace-line">';
        html += escapeHtml(trace);
        html += '</div>';
      });
      html += '</div>';
    } else if (error.location) {
      // Fallback to location info if no stack trace
      html += '<div class="error-location-line">';
      html += escapeHtml(error.location);
      html += '</div>';
    } else if (error.lineNumber !== null && error.lineNumber !== undefined && !isNaN(error.lineNumber)) {
      // Fallback to just line/column if location string not available
      let locationDisplay = `Line ${error.lineNumber}`;
      if (error.columnNumber !== null && error.columnNumber !== undefined && !isNaN(error.columnNumber)) {
        locationDisplay += `, Column ${error.columnNumber}`;
      }
      html += '<div class="error-location-line">';
      html += escapeHtml(locationDisplay);
      html += '</div>';
    }
    
    html += '</div>';
  });
  
  html += '</div>';
  return html;
}

/**
 * Gets user-friendly error type display names
 * @param {string} errorType - Technical error type
 * @returns {string} - User-friendly display name
 */
function getErrorTypeDisplayName(errorType) {
  const displayNames = {
    'System.QueryException': 'Query Error',
    'System.DmlException': 'DML Error', 
    'System.NullPointerException': 'Null Pointer Error',
    'System.ListException': 'List Access Error',
    'System.ArithmeticException': 'Math Error',
    'System.CalloutException': 'Callout Error',
    'System.LimitException': 'Governor Limit Error',
    'FATAL_ERROR': 'Fatal Error',
    'EXCEPTION_THROWN': 'Exception Thrown',
    'COMPILE_ERROR': 'Compile Error',
    'VALIDATION_ERROR': 'Validation Error'
  };
  
  return displayNames[errorType] || errorType;
} 