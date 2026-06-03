// Log Content Parsing and Error Extraction
// This file handles parsing debug log content, extracting errors, and formatting limits

// Global variables to track current error filters
let currentErrorFilters = { showFatal: true, showException: false }; // Default to showing Fatal only
let currentErrorData = null; // Store current error data for re-rendering

function addLineNumbers(messageContent) {
  if (!messageContent || typeof messageContent !== 'string') {
    return messageContent;
  }

  const lines = messageContent.split('\n');
  const maxLineLength = String(lines.length).length;

  const numberedLines = lines.map((line, index) => {
    const lineNumber = String(index + 1).padStart(maxLineLength, ' ');

    // Content is already HTML-escaped and highlighted by the caller
    // (applyDebugLogHighlighting / extractAndParseSalesforceObjects); wrap, don't re-escape.
    return `<span class="line-number">${lineNumber}</span><span class="line-content">${line || ''}</span>`;
  });

  return numberedLines.join('\n');
}

function parseDebugLogContent(content) {
  try {
    const debugMessages = extractUserDebugBlocks(content);

    // Extract error information
    const errorData = extractErrorsFromDebugLog(content);

    // Extract the governor-limits section.
    // Anchor on the LAST CUMULATIVE_LIMIT_USAGE block (the final transaction's totals),
    // collect each LIMIT_USAGE_FOR_NS namespace within it, and show the (default)
    // namespace (falling back to the first namespace if there is no default).
    const lines = content.split('\n');
    let limitsSection = '';

    // Find the opening of the last CUMULATIVE_LIMIT_USAGE block.
    // (The _END line also contains "|CUMULATIVE_LIMIT_USAGE", so exclude it explicitly.)
    let blockStart = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('|CUMULATIVE_LIMIT_USAGE') && !lines[i].includes('CUMULATIVE_LIMIT_USAGE_END')) {
        blockStart = i;
        break;
      }
    }

    if (blockStart >= 0) {
      // Group the block's lines by namespace, until its END (or end of log if truncated).
      const sections = [];
      let current = null;
      for (let i = blockStart + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('CUMULATIVE_LIMIT_USAGE_END')) break;

        const namespaceMatch = line.match(/LIMIT_USAGE_FOR_NS\|([^|]+)\|/);
        if (namespaceMatch) {
          current = { namespace: namespaceMatch[1], details: [] };
          sections.push(current);
        } else if (current && line.trim() && !/^\d{2}:\d{2}:\d{2}\./.test(line)) {
          // Indented detail line (not a timestamped event) belongs to the current namespace.
          current.details.push(line);
        }
      }

      // Prefer the (default) namespace; fall back to the first one present.
      const chosen = sections.find(s => s.namespace === '(default)') || sections[0];
      if (chosen) {
        limitsSection = `LIMIT_USAGE_FOR_NS|${chosen.namespace}|\n` + chosen.details.join('\n');
      }
    }

    return {
      debugMessages: debugMessages,
      errors: errorData,
      limits: limitsSection.trim()
    };
  } catch (error) {
    // Fallback: show info via toast
    showToast('Failed to copy. Log content is available in the view.', 5000);
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
    // Store error data for re-rendering when filter changes
    currentErrorData = parsedContent.errors;

    // Smart filter initialization: adjust filters based on what exists
    if (!parsedContent.errors.hasFatalErrors && parsedContent.errors.hasExceptions) {
      // Only exceptions exist, show them
      currentErrorFilters = { showFatal: false, showException: true };
    } else if (parsedContent.errors.hasFatalErrors && !parsedContent.errors.hasExceptions) {
      // Only fatal errors exist, show them
      currentErrorFilters = { showFatal: true, showException: false };
    } else {
      // Both exist, use current filter state (defaults to Fatal only)
      // currentErrorFilters stays as is
    }

    const formattedErrors = formatErrorsForDisplay(parsedContent.errors, currentErrorFilters);
    errorContent.innerHTML = formattedErrors;

    // Wire up filter checkbox event listeners
    wireUpErrorFilterListeners();
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

/**
 * Wires up event listeners for error filter checkboxes
 */
function wireUpErrorFilterListeners() {
  // Use event delegation on the error content container
  const errorContent = document.getElementById('errorContent');
  if (!errorContent) return;

  // Remove existing listener to avoid duplicates
  errorContent.removeEventListener('change', handleFilterCheckboxChange);

  // Add change listener for checkboxes
  errorContent.addEventListener('change', handleFilterCheckboxChange);
}

/**
 * Handles filter checkbox change events
 * @param {Event} event - Change event
 */
function handleFilterCheckboxChange(event) {
  const checkbox = event.target;
  if (!checkbox || checkbox.type !== 'checkbox') return;

  const filter = checkbox.getAttribute('data-filter');
  if (!filter) return;

  // Update current filters based on checkbox state
  if (filter === 'fatal') {
    currentErrorFilters.showFatal = checkbox.checked;
  } else if (filter === 'exception') {
    currentErrorFilters.showException = checkbox.checked;
  }

  // Re-render error display with new filters
  if (currentErrorData) {
    const errorContent = document.getElementById('errorContent');
    if (errorContent) {
      const formattedErrors = formatErrorsForDisplay(currentErrorData, currentErrorFilters);
      errorContent.innerHTML = formattedErrors;

      // Re-wire listeners after re-rendering
      wireUpErrorFilterListeners();
    }
  }
}