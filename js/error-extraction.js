// Error Extraction Utilities
// This file contains functions for extracting and formatting error messages from Salesforce debug logs

/**
 * Extracts error information from debug log content
 * @param {string} content - Raw debug log content 
 * @returns {object} - Object containing parsed error information
 */
function extractErrorsFromDebugLog(content) {
  if (!content || typeof content !== 'string') {
    return {
      hasErrors: false,
      errors: [],
      errorSummary: null
    };
  }

  const errors = [];
  const lines = content.split('\n');
  
  // Find FATAL_ERROR entries
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Match FATAL_ERROR pattern: timestamp|FATAL_ERROR|error message
    const fatalErrorMatch = line.match(/^\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\)\|FATAL_ERROR\|(.*)/);
    
    if (fatalErrorMatch) {
      const firstErrorLine = fatalErrorMatch[1].trim();
      let fullErrorMessage = firstErrorLine;
      let stackTrace = [];
      
      // Collect all lines until the next timestamp entry
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        
        // Stop if we hit another log entry with timestamp and pipe
        if (nextLine.match(/^\d{2}:\d{2}:\d{2}\.\d+.*\|/)) {
          break;
        }
        
        // Add non-empty lines to the error message
        const cleanLine = nextLine.trim();
        if (cleanLine) {
          // Check if this is a stack trace line (Class.Method: line X, column Y, AnonymousBlock: line X, column Y)
          if (cleanLine.match(/^(Class\.|Trigger\.|AnonymousBlock:)/)) {
            stackTrace.push(cleanLine);
          } else {
            // Add to the main error message
            fullErrorMessage += '\n' + cleanLine;
          }
        }
        
        j++;
      }
      
      // Parse the first line of error to get basic info
      const errorDetails = parseErrorMessage(firstErrorLine);
      
      // Extract line and column information from stack trace
      let lineNumber = null;
      let columnNumber = null;
      let locationInfo = null;
      
      if (stackTrace.length > 0) {
        // Use the first stack trace entry as the primary location
        locationInfo = stackTrace.join('\n');
        
        // Extract line/column from the first stack trace entry
        const firstTrace = stackTrace[0];
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
            lineNumber = parseInt(match[1], 10);
            break;
          }
        }
        
        for (const pattern of columnPatterns) {
          const match = firstTrace.match(pattern);
          if (match) {
            columnNumber = parseInt(match[1], 10);
            break;
          }
        }
      }
      
      // Fallback: try to extract line number from the error message itself
      if (lineNumber === null) {
        const errorLineMatch = fullErrorMessage.match(/line\s+(\d+)/i);
        if (errorLineMatch) {
          lineNumber = parseInt(errorLineMatch[1], 10);
        }
      }
      
      errors.push({
        type: 'FATAL_ERROR',
        timestamp: extractTimestamp(line),
        rawMessage: fullErrorMessage,
        parsedMessage: errorDetails,
        location: locationInfo,
        stackTrace: stackTrace,
        lineNumber: lineNumber,
        columnNumber: columnNumber,
        line: i + 1
      });
    }
  }
  
  // Look for other error patterns (compilation errors, runtime exceptions, etc.)
  const additionalErrors = extractAdditionalErrors(lines);
  errors.push(...additionalErrors);
  
  return {
    hasErrors: errors.length > 0,
    errors: errors,
    errorSummary: createErrorSummary(errors)
  };
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
 * Formats errors for display in the UI
 * @param {object} errorData - Error data from extractErrorsFromDebugLog
 * @returns {string} - HTML formatted error display
 */
function formatErrorsForDisplay(errorData) {
  if (!errorData.hasErrors) {
    return '<div class="error-status-success">✅ No errors found in this debug log</div>';
  }
  
  let html = '<div class="error-section">';
  
  // Add error summary header showing all error types
  if (errorData.errorSummary) {
    const summary = errorData.errorSummary;
    html += '<div class="error-summary-header">';
    
    // Show count and types
    const errorTypeList = Object.keys(summary.errorTypes).map(type => {
      const count = summary.errorTypes[type];
      const displayName = getErrorTypeDisplayName(type);
      return count > 1 ? `${displayName} (${count})` : displayName;
    }).join(', ');
    
    html += `<div class="error-count">${summary.totalErrors} Error${summary.totalErrors > 1 ? 's' : ''}: ${errorTypeList}</div>`;
    html += '</div>';
  }
  
  // Add individual error details
  errorData.errors.forEach((error) => {
    html += '<div class="error-item-block">';
    
    // Error type header
    html += '<div class="error-type-header">';
    html += `<strong>${getErrorTypeDisplayName(error.type)}</strong>`;
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
    'COMPILE_ERROR': 'Compile Error',
    'VALIDATION_ERROR': 'Validation Error'
  };
  
  return displayNames[errorType] || errorType;
} 