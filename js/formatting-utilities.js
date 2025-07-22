// Formatting Utilities
// This file contains functions for JSON highlighting, governor limits formatting, and main object extraction

// Simple JSON key highlighting only
function highlightJsonKeys(jsonString) {
  try {
    let highlighted = escapeHtml(jsonString);
    
    // Highlight JSON keys only - property names in quotes followed by colon
    // Pattern 1: Standard &quot; format followed by colon
    highlighted = highlighted.replace(/&quot;([^&"]*?)&quot;(\s*):/g, '<span class="json-key">&quot;$1&quot;</span>$2:');
    // Pattern 2: In case quotes aren't escaped as &quot;
    highlighted = highlighted.replace(/"([^"]*?)"(\s*):/g, '<span class="json-key">"$1"</span>$2:');
    
    // Highlight string values
    highlighted = highlighted.replace(/:\s*&quot;([^&"]*?)&quot;/g, ': <span class="json-string">&quot;$1&quot;</span>');
    highlighted = highlighted.replace(/:\s*"([^"]*?)"/g, ': <span class="json-string">"$1"</span>');
    
    // Highlight numbers
    highlighted = highlighted.replace(/:\s*(\d+\.?\d*)/g, ': <span class="json-number">$1</span>');
    
    // Highlight booleans and null
    highlighted = highlighted.replace(/:\s*(true|false|null)\b/g, ': <span class="json-boolean">$1</span>');
    
    return highlighted;
  } catch (error) {
    return escapeHtml(jsonString);
  }
}

function formatGovernorLimits(limitsText) {
  try {
    if (!limitsText || !limitsText.trim()) {
      return limitsText;
    }
    
    let formattedLimits = limitsText;
    
    // Format the main header (LIMIT_USAGE_FOR_NS)
    formattedLimits = formattedLimits.replace(
      /^(LIMIT_USAGE_FOR_NS.*?)$/gm, 
      `<div class="limit-header">$1</div>`
    );
    
    // Format category lines like "Number of SOQL queries: 0 out of 1000"
    formattedLimits = formattedLimits.replace(
      /^([A-Za-z\s]+):\s*(\d+)\s+(out of)\s+(\d+)(.*)$/gm,
      `<div style="margin: 1px 0;"><span class="limit-category">$1:</span> <span class="limit-used">$2</span> <span class="limit-separator">$3</span> <span class="limit-value">$4</span>$5</div>`
    );
    
    // Format percentage lines like "****** CLOSE TO LIMIT (85%)"
    formattedLimits = formattedLimits.replace(
      /(\*+)\s*(CLOSE TO LIMIT|OVER LIMIT)\s*\((\d+%)\)/g,
      '<div style="margin: 1px 0;"><span class="limit-separator">$1</span> <span class="limit-used">$2</span> <span class="limit-percentage">($3)</span></div>'
    );
    
    // Format OK status percentages
    formattedLimits = formattedLimits.replace(
      /\((\d+%)\)$/gm,
      '<span class="limit-percentage">($1)</span>'
    );
    
    // Format number ranges like "0 out of 1000" (fallback for any missed cases)
    formattedLimits = formattedLimits.replace(
      /(\d+)\s+(out of)\s+(\d+)/g,
      `<span class="limit-used">$1</span> <span class="limit-separator">$2</span> <span class="limit-value">$3</span>`
    );
    
    // Improved spacing between sections
    formattedLimits = formattedLimits.replace(/\n([A-Za-z])/g, '\n\n$1');
    
    // Wrap the entire content in a container with proper spacing
    formattedLimits = `<div style="font-family: Monaco, 'Courier New', monospace; font-size: 10px; line-height: 1.2; padding: 4px 0;">${formattedLimits}</div>`;
    
    return formattedLimits;
  } catch (error) {
    return limitsText;
  }
}

function extractAndParseSalesforceObjects(text) {
  if (!text) return escapeHtml(text);
  
  // Decode HTML entities first for better processing
  let decodedText = decodeHtmlEntities(text);
  
  // First, try to clean Salesforce API responses (JSON with attributes/metadata)
  try {
    const cleanedResponse = cleanSalesforceResponse(decodedText);
    if (cleanedResponse !== decodedText) {
      const highlightedJson = highlightJsonKeys(cleanedResponse);
      return highlightedJson;
    }
  } catch (error) {
    // Continue with original parsing if cleaning fails
  }
  
  // Check for multi-line Salesforce object pattern: ObjectName:\n"[...]"
  const multiLineMatch = decodedText.match(/^(\w+):\s*[\r\n]+\s*"(\[.*\])"$/s);
  if (multiLineMatch) {
    const [, objectName, content] = multiLineMatch;
    
    try {
      // Parse the content inside the quotes
      const parsed = {
        [objectName]: parseComplexContent(content.slice(1, -1)) // Remove [ and ]
      };
      const jsonString = JSON.stringify(parsed, null, 2);
      const highlightedJson = highlightJsonKeys(jsonString);
      return highlightedJson;
    } catch (error) {
      return escapeHtml(decodedText);
    }
  }
  
  // Convert literal \n sequences to spaces for single-line processing
  // But preserve actual newlines for JSON.serializePretty() output
  decodedText = decodedText
    .replace(/\\n/g, ' ');
  
  // Try to find where the Salesforce object data starts
  let objectPart = decodedText;
  let prefix = '';
  
  // First, try to find the rightmost parentheses group containing Salesforce objects
  const parenMatches = [];
  let parenRegex = /\([^)]*\w+:\{[^}]*=[^}]*\}[^)]*\)/g;
  let match;
  
  while ((match = parenRegex.exec(decodedText)) !== null) {
    parenMatches.push({
      content: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  // If we found parentheses groups with Salesforce objects, use the rightmost one
  if (parenMatches.length > 0) {
    const lastParenMatch = parenMatches[parenMatches.length - 1];
    prefix = decodedText.substring(0, lastParenMatch.start).trim();
    objectPart = lastParenMatch.content;
  } else {
    // Fallback to original pattern matching
    // Look for common patterns where object data starts
    const patterns = [
      // Pattern: "Full Account → Account:{Id=001..., Name=...}"
      /^([^→]*→\s*)(\w+:\{.*\})$/s,
      // Pattern: "Some text:(Account:{...}, Contact:{...})"
      /^([^(]*?)(\([^)]*\w+:\{.*\))$/s,
      // Pattern: "Some text Account:{...}"
      /^([^{]*?)(\w+:\{.*\})$/s,
      // Pattern: "Some text Account:[...]"
      /^([^{[\]]*?)(\w+:\[.*\])$/s,
      // Pattern: "Some text {"key":"value",...}"
      /^([^{[\]]*?)([\{\[].*[\}\]])$/s,
      // Pattern: Multi-line JSON from JSON.serializePretty
      /^([^{[\]]*?)([\{\[][\s\S]*[\}\]])$/,
      // Pattern: Quoted content "[key=value, ...]"
      /^([^"]*)("?\[.*\]"?)$/s,
      // Pattern: Direct object/array (no prefix)
      /^()([\{\[].*[\}\]])$/s,
      // Pattern: Direct Salesforce object (no prefix)
      /^()(\w+:\{.*\})$/s
    ];
    
    for (const pattern of patterns) {
      const match = decodedText.match(pattern);
      if (match) {
        prefix = match[1];
        objectPart = match[2];
        break;
      }
    }
  }
  
  try {
    let parsed;
    let jsonString;
    
    // Remove surrounding quotes if present
    if (objectPart.startsWith('"') && objectPart.endsWith('"')) {
      objectPart = objectPart.slice(1, -1);
    }
    
    // Check if it's already valid JSON (from JSON.serialize/serializePretty)
    if (objectPart.trim().startsWith('{') || objectPart.trim().startsWith('[')) {
      try {
        parsed = JSON.parse(objectPart);
        jsonString = JSON.stringify(parsed, null, 2);
      } catch (jsonError) {
        // If JSON parsing fails, try Salesforce notation parsing
        if (objectPart.trim().startsWith('[') && objectPart.trim().endsWith(']')) {
          // Handle quoted array content: [key=value, key=value]
          const arrayContent = objectPart.slice(1, -1); // Remove [ and ]
          parsed = parseComplexContent(arrayContent);
          jsonString = JSON.stringify(parsed, null, 2);
        } else {
          parsed = parseSalesforceObjectNotation(objectPart);
          jsonString = JSON.stringify(parsed, null, 2);
        }
      }
    } else {
      // Try to parse as Salesforce object notation
      parsed = parseSalesforceObjectNotation(objectPart);
      jsonString = JSON.stringify(parsed, null, 2);
    }
    
    const highlightedJson = highlightJsonKeys(jsonString);
    
    // Combine prefix (if any) with formatted JSON
    if (prefix.trim()) {
      const escapedPrefix = escapeHtml(prefix.trim());
      return `<span class="content-prefix">${escapedPrefix}</span>\n${highlightedJson}`;
    } else {
      return highlightedJson;
    }
  } catch (e) {
    // If all parsing fails, just escape the decoded text
    return escapeHtml(decodedText);
  }
} 