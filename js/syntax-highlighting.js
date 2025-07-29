// Syntax Highlighting for Debug Logs and JSON
// This file handles syntax highlighting for different content types

function applyDebugLogHighlighting(text) {
  // Check if text already contains actual HTML tags (not debug content like <init>)
  // Only match proper HTML tags with valid tag names, not arbitrary angle bracket content
  const hasExistingHTML = /<(span|div|p|br|strong|em|code|pre|a|img)\b[^>]*>/i.test(text) || 
                         /<\/\w+>/.test(text) ||
                         text.includes('SEARCH_HIGHLIGHT_START_') || 
                         text.includes('SEARCH_HIGHLIGHT_END_');
  
  if (hasExistingHTML) {
    // If text already has HTML tags or search markers, apply highlighting carefully
    return applyDebugLogSyntaxToHTML(text);
  } else {
    // Simple case: plain text, escape HTML and apply highlighting
    let highlighted = escapeHtml(text);
    return applyDebugLogPatterns(highlighted);
  }
}

function applyDebugLogSyntaxToHTML(htmlText) {
  // Handle search markers and HTML tags separately
  let result = htmlText;
  
  // First, protect search markers from processing
  const markers = [];
  result = result.replace(/(SEARCH_HIGHLIGHT_START_\d+_\d+_MARKER|SEARCH_HIGHLIGHT_END_\d+_\d+_MARKER)/g, (match, marker) => {
    const index = markers.length;
    markers.push(marker);
    return `PROTECTED_MARKER_${index}`;
  });
  
  // Split into HTML tags and text content, but only split on actual HTML tags
  const parts = result.split(/(<(?:span|div|p|br|strong|em|code|pre|a|img)\b[^>]*>|<\/\w+>)/i);
  
  const processedParts = parts.map(part => {
    // If this part is a real HTML tag, return as-is
    if (part.match(/^<(?:span|div|p|br|strong|em|code|pre|a|img)\b[^>]*>$|^<\/\w+>$/i)) {
      return part;
    }
    
    // Otherwise, it's text content - escape and apply debug log highlighting
    let highlighted = escapeHtml(part);
    return applyDebugLogPatterns(highlighted);
  });
  
  // Restore protected markers
  let finalResult = processedParts.join('');
  markers.forEach((marker, index) => {
    finalResult = finalResult.replace(`PROTECTED_MARKER_${index}`, marker);
  });
  
  return finalResult;
}

function applyDebugLogPatterns(text) {
  // Apply debug log specific highlighting patterns
  return text
    // Highlight timestamps
    .replace(/^(\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\))/gm, '<span class="debug-timestamp">$1</span>')
    // Highlight log levels and operations
    .replace(/\|(USER_INFO|EXECUTION_STARTED|CODE_UNIT_STARTED|USER_DEBUG|HEAP_ALLOCATE|SOQL_EXECUTE_BEGIN|SOQL_EXECUTE_END|METHOD_ENTRY|METHOD_EXIT|STATEMENT_EXECUTE|SYSTEM_MODE_ENTER|SYSTEM_MODE_EXIT|VARIABLE_SCOPE_BEGIN|VARIABLE_ASSIGNMENT|CUMULATIVE_LIMIT_USAGE|LIMIT_USAGE_FOR_NS|CODE_UNIT_FINISHED|EXECUTION_FINISHED)\|/g, 
      '|<span class="debug-operation">$1</span>|')
    // Highlight DEBUG level in USER_DEBUG
    .replace(/\|DEBUG\|/g, '|<span class="debug-level">DEBUG</span>|')
    // Highlight numbers in brackets like [1], [6], [8]
    .replace(/\[(\d+)\]/g, '[<span class="debug-number">$1</span>]')
    // Highlight byte allocations
    .replace(/(Bytes:)(\d+)/g, '$1<span class="debug-number">$2</span>')
    // Highlight query row counts
    .replace(/(Rows:)(\d+)/g, '$1<span class="debug-number">$2</span>')
    // Highlight "out of" limits
    .replace(/(\d+)\s+(out of)\s+(\d+)/g, '<span class="debug-number">$1</span> <span class="debug-text">$2</span> <span class="debug-number">$3</span>');
}

function applyJsonSyntaxHighlighting(text) {
  // Check if text already contains actual HTML tags (not content like <init>)
  const hasExistingHTML = /<(span|div|p|br|strong|em|code|pre|a|img)\b[^>]*>/i.test(text) || 
                         /<\/\w+>/.test(text) ||
                         text.includes('SEARCH_HIGHLIGHT_START_') || 
                         text.includes('SEARCH_HIGHLIGHT_END_');
  
  if (hasExistingHTML) {
    // If text already has HTML tags or search markers, apply highlighting carefully
    return applyJsonSyntaxToHTML(text);
  } else {
    // Simple case: plain text, escape HTML and apply highlighting
    let highlighted = text.replace(/&/g, '&amp;')
                         .replace(/</g, '&lt;')
                         .replace(/>/g, '&gt;');
    
    // Apply JSON syntax highlighting patterns
    highlighted = highlighted
      // Highlight JSON keys (strings followed by colon)
      .replace(/"([^"\\]|\\.)*"(\s*:)/g, '<span class="json-key">$&</span>')
      // Highlight JSON strings (not keys)
      .replace(/"([^"\\]|\\.)*"(?!\s*:)/g, '<span class="json-string">$&</span>')
      // Highlight numbers
      .replace(/\b-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, '<span class="json-number">$&</span>')
      // Highlight booleans
      .replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')
      // Highlight null
      .replace(/\bnull\b/g, '<span class="json-null">null</span>');
    
    return highlighted;
  }
}

function applyJsonSyntaxToHTML(htmlText) {
  // Handle search markers and HTML tags separately
  let result = htmlText;
  
  // First, protect search markers from processing
  const markers = [];
  result = result.replace(/(SEARCH_HIGHLIGHT_START_\d+_\d+_MARKER|SEARCH_HIGHLIGHT_END_\d+_\d+_MARKER)/g, (match, marker) => {
    const index = markers.length;
    markers.push(marker);
    return `PROTECTED_MARKER_${index}`;
  });
  
  // Split into HTML tags and text content, but only split on actual HTML tags
  const parts = result.split(/(<(?:span|div|p|br|strong|em|code|pre|a|img)\b[^>]*>|<\/\w+>)/i);
  
  const processedParts = parts.map(part => {
    // If this part is a real HTML tag, return as-is
    if (part.match(/^<(?:span|div|p|br|strong|em|code|pre|a|img)\b[^>]*>$|^<\/\w+>$/i)) {
      return part;
    }
    
    // Otherwise, it's text content - escape and apply JSON syntax highlighting
    let highlighted = part.replace(/&/g, '&amp;')
                         .replace(/</g, '&lt;')
                         .replace(/>/g, '&gt;');
    
    // Apply JSON syntax highlighting patterns
    highlighted = highlighted
      // Highlight JSON keys (strings followed by colon)
      .replace(/"([^"\\]|\\.)*"(\s*:)/g, '<span class="json-key">$&</span>')
      // Highlight JSON strings (not keys)
      .replace(/"([^"\\]|\\.)*"(?!\s*:)/g, '<span class="json-string">$&</span>')
      // Highlight numbers
      .replace(/\b-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, '<span class="json-number">$&</span>')
      // Highlight booleans
      .replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')
      // Highlight null
      .replace(/\bnull\b/g, '<span class="json-null">null</span>');
    
    return highlighted;
  });
  
  // Restore protected markers
  let finalResult = processedParts.join('');
  markers.forEach((marker, index) => {
    finalResult = finalResult.replace(`PROTECTED_MARKER_${index}`, marker);
  });
  
  return finalResult;
}