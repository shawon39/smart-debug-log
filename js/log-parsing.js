// Log Content Parsing and Error Extraction
// This file handles parsing debug log content, extracting errors, and formatting limits

function addLineNumbers(messageContent) {
  if (!messageContent || typeof messageContent !== 'string') {
    return messageContent;
  }
  
  const lines = messageContent.split('\n');
  const maxLineLength = String(lines.length).length;
  
  const numberedLines = lines.map((line, index) => {
    const lineNumber = String(index + 1).padStart(maxLineLength, ' ');
    // Handle empty lines gracefully - preserve them but add line numbers
    return `<span class="line-number">${lineNumber}</span><span class="line-content">${line || ''}</span>`;
  });
  
  return numberedLines.join('\n');
}

function parseDebugLogContent(content) {
  try {
    const debugMessages = extractUserDebugBlocks(content);
    
    // Extract error information
    const errorData = extractErrorsFromDebugLog(content);
          
    // Extract limits section
    const lines = content.split('\n');
    let limitsSection = '';
    let inLimitsSection = false;
    let lastLimitsStartIndex = -1;
    
    // First pass: find the LAST LIMIT_USAGE_FOR_NS section
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('LIMIT_USAGE_FOR_NS')) {
        lastLimitsStartIndex = i;
        break;
      }
    }

    // Extract the LAST LIMIT_USAGE_FOR_NS section
    if (lastLimitsStartIndex >= 0) {
      for (let i = lastLimitsStartIndex; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.includes('LIMIT_USAGE_FOR_NS')) {
          inLimitsSection = true;
          // Extract the namespace from the line
          const namespaceMatch = line.match(/LIMIT_USAGE_FOR_NS\|([^|]+)\|/);
          const namespace = namespaceMatch ? namespaceMatch[1] : 'unknown';
          limitsSection = `LIMIT_USAGE_FOR_NS|${namespace}|\n`;
          continue;
        }
        
        if (inLimitsSection) {
          // Stop collecting when we hit another section (any line with |) or empty line followed by another section
          if (line.includes('|') && !line.match(/^\s+/)) {
            break;
          }
          
          // Stop collecting when we hit CUMULATIVE_LIMIT_USAGE_END
          if (line.includes('CUMULATIVE_LIMIT_USAGE_END')) {
            break;
          }
          
          limitsSection += line + '\n';
        }
      }
    }
    
    return {
      debugMessages: debugMessages,
      errors: errorData,
      limits: limitsSection.trim()
    };
  } catch (error) {
    return {
      debugMessages: [],
      errors: { hasErrors: false, errors: [], errorSummary: null },
      limits: ''
    };
  }
}

function extractUserEmailFromLog(content) {
  try {
    if (!content || typeof content !== 'string') {
      return null;
    }
    
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.includes('|USER_INFO|')) {
        const parts = line.split('|');
        if (parts.length >= 5) {
          const email = parts[4];
          if (email && email.includes('@')) {
            return email;
          }
        }
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

function displayDebugContent(parsedContent) {
  const { debugContent, errorContent, limitsContent } = elements;
  
  // Display debug messages
  if (parsedContent.debugMessages && parsedContent.debugMessages.length > 0) {
    // Create individual blocks for each debug message
    const messageBlocks = parsedContent.debugMessages.map((message, index) => {
      let formattedMessage = message;
      
      // Decode HTML entities first
      formattedMessage = decodeHtmlEntities(formattedMessage);
      
      // Check if this looks like Salesforce object notation and try to format it
      if (containsSalesforceObjects(formattedMessage)) {
        try {
          // Extract and parse the Salesforce object part
          const result = extractAndParseSalesforceObjects(formattedMessage);
          formattedMessage = result;
        } catch (e) {
          // If parsing fails, apply debug log highlighting
          formattedMessage = applyDebugLogHighlighting(formattedMessage);
        }
      } else {
        // For simple text messages, apply debug log highlighting
        formattedMessage = applyDebugLogHighlighting(formattedMessage);
      }
      
      // Add line numbers to the formatted message
      const messageWithLineNumbers = addLineNumbers(formattedMessage);
      
      return `<div class="debug-message-block" data-message-index="${index}"><pre class="debug-message-pre">${messageWithLineNumbers}</pre></div>`;
    }).join('');
    debugContent.innerHTML = messageBlocks;
  } else {
    debugContent.innerHTML = '<div class="info-message">No DEBUG messages found in this log.</div>';
  }
  
  // Display error analysis
  if (errorContent && parsedContent.errors) {
    const formattedErrors = formatErrorsForDisplay(parsedContent.errors);
    errorContent.innerHTML = formattedErrors;
  }
  
  // Display limits with enhanced formatting
  if (parsedContent.limits) {
    const formattedLimits = formatGovernorLimits(parsedContent.limits);
    if (limitsContent) {
      limitsContent.innerHTML = formattedLimits;
    }
  } else {
    if (limitsContent) {
      limitsContent.innerHTML = '<div class="info-message">No CUMULATIVE_LIMIT_USAGE information found in this log.</div>';
    }
  }
}