// Log Content Parsing and Error Extraction
// This file handles parsing debug log content, extracting errors, and formatting limits

// Global variables to track current error filters
let currentErrorFilters = { showFatal: true, showException: false }; // Default to showing Fatal only
let currentErrorData = null; // Store current error data for re-rendering
let currentLogTruncated = false; // Whether the shown log was cut by Salesforce
let lastParsedLog = null; // { content, result } of the last parsed log; the views re-use it

// Banner for logs that Salesforce cut because they were too big
function truncatedLogBannerHtml() {
  return `<div class="log-truncated-banner">${Icons.svg('triangleAlert', 14)}<span>This log was cut by Salesforce. Errors and limits may be incomplete.</span></div>`;
}

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
  // The list icons, the debug view and the raw view all ask for the same log: parse it once
  if (lastParsedLog && lastParsedLog.content === content) {
    return lastParsedLog.result;
  }

  try {
    const debugMessages = extractUserDebugBlocks(content);

    // Extract error information
    const errorData = extractErrorsFromDebugLog(content);

    // Extract the governor-limits section.
    // Anchor on the LAST CUMULATIVE_LIMIT_USAGE block (the final transaction's totals),
    // collect each LIMIT_USAGE_FOR_NS namespace within it, and show all of them,
    // the (default) namespace first.
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

      // The (default) namespace first, then managed package namespaces in log order
      const ordered = [
        ...sections.filter(s => s.namespace === '(default)'),
        ...sections.filter(s => s.namespace !== '(default)')
      ];
      limitsSection = ordered
        .map(section => `LIMIT_USAGE_FOR_NS|${section.namespace}|\n` + section.details.join('\n'))
        .join('\n');
    }

    const result = {
      debugMessages: debugMessages,
      errors: errorData,
      limits: limitsSection.trim(),
      truncated: isTruncatedLog(content)
    };
    lastParsedLog = { content, result };
    return result;
  } catch (error) {
    // Fallback: show info via toast
    showToast('Could not read this log. Try the raw view.', 5000);
    return {
      debugMessages: [],
      errors: { hasErrors: false, hasFatalErrors: false, hasExceptions: false, errors: [] },
      limits: '',
      truncated: false
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

// Messages worth formatting: toString values or JSON up to MAX_TOSTRING_MESSAGE_LENGTH, and longer ones up to
// MAX_JSON_MESSAGE_LENGTH that end with a JSON object or array (e.g. Console.log of many records)
function isStructuredMessage(message) {
  if (message.length <= MAX_TOSTRING_MESSAGE_LENGTH) return containsSalesforceObjects(message);
  if (message.length > MAX_JSON_MESSAGE_LENGTH) return false;
  const end = message.trimEnd();
  return end.endsWith('}') || end.endsWith(']');
}

function displayDebugContent(parsedContent) {
  const { debugContent, errorContent, limitsContent } = elements;
  currentLogTruncated = !!parsedContent.truncated;
  const truncatedBanner = currentLogTruncated ? truncatedLogBannerHtml() : '';

  // Display debug messages
  if (parsedContent.debugMessages && parsedContent.debugMessages.length > 0) {
    // Create individual blocks for each debug message
    const messageBlocks = parsedContent.debugMessages.map(({ level, message }, index) => {
      // Format records, classes, collections and JSON. The message is used as Salesforce wrote it: log bodies
      // are not HTML-escaped, so "&amp;" in a message is what the code debugged.
      let formattedMessage = null;
      if (isStructuredMessage(message)) {
        try {
          formattedMessage = extractAndParseSalesforceObjects(message);
        } catch (e) {
          formattedMessage = null;
        }
      }
      if (formattedMessage === null) {
        // Text (and anything that could not be formatted)
        formattedMessage = applyDebugLogHighlighting(tidyExceptionText(message));
      }

      // Add line numbers to the formatted message
      const messageWithLineNumbers = addLineNumbers(formattedMessage);

      // Show the logging level when it is not the default DEBUG (e.g. System.debug(LoggingLevel.ERROR, ...))
      const levelTag = level !== 'DEBUG' ? `<span class="debug-level-tag level-${escapeHtml(level.toLowerCase())}">${escapeHtml(level)}</span>` : '';

      return `<div class="debug-message-block" data-message-index="${index}">${levelTag}<pre class="debug-message-pre">${messageWithLineNumbers}</pre></div>`;
    }).join('');
    debugContent.innerHTML = truncatedBanner + messageBlocks;
  } else {
    debugContent.innerHTML = truncatedBanner + '<div class="info-message">No debug messages found in this log.</div>';
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
    errorContent.innerHTML = truncatedBanner + formattedErrors;

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
      errorContent.innerHTML = (currentLogTruncated ? truncatedLogBannerHtml() : '') + formattedErrors;

      // Re-wire listeners after re-rendering
      wireUpErrorFilterListeners();
    }
  }
}