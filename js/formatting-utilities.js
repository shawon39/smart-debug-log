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

    // Parse "LIMIT_USAGE_FOR_NS|ns|" headers and "Label: used out of max" rows
    let namespace = '';
    const rows = [];
    limitsText.split('\n').forEach(line => {
      const ns = line.match(/LIMIT_USAGE_FOR_NS\|([^|]+)\|/);
      if (ns) {
        namespace = ns[1];
        return;
      }
      const m = line.match(/^\s*([A-Za-z][A-Za-z ]*?):\s*(\d+)\s+out of\s+(\d+)/);
      if (m) {
        const label = m[1].replace(/^(Number of|Maximum)\s+/i, '');
        rows.push({ label: label.charAt(0).toUpperCase() + label.slice(1), used: Number(m[2]), max: Number(m[3]) });
      }
    });

    // Unknown format: show the text as-is rather than nothing
    if (rows.length === 0) {
      return `<pre class="limits-raw">${escapeHtml(limitsText)}</pre>`;
    }

    const rowsHtml = rows.map(({ label, used, max }) => {
      const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
      const level = pct >= 80 ? 'danger' : pct >= 50 ? 'warn' : 'ok';
      return `
        <div class="limit-row level-${level}${used === 0 ? ' is-zero' : ''}">
          <div class="limit-row-head">
            <span class="limit-name">${escapeHtml(label)}</span>
            <span class="limit-nums"><b>${used.toLocaleString()}</b> / ${max.toLocaleString()}</span>
          </div>
          <div class="limit-bar"><span style="width: ${pct.toFixed(1)}%"></span></div>
        </div>`;
    }).join('');

    const nsHtml = namespace ? `<div class="limits-ns">Governor limits <span>${escapeHtml(namespace)}</span></div>` : '';
    return `${nsHtml}<div class="limits-list">${rowsHtml}</div>`;
  } catch (error) {
    return `<pre class="limits-raw">${escapeHtml(limitsText)}</pre>`;
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

    // First, try to parse the entire objectPart as JSON (including potential quoted strings)
    let tryJsonFirst = false;
    let originalObjectPart = objectPart;

    // Check if it looks like JSON (starts with {, [, or ")
    if (objectPart.trim().startsWith('{') || objectPart.trim().startsWith('[') || objectPart.trim().startsWith('"')) {
      tryJsonFirst = true;
    }

    if (tryJsonFirst) {
      try {
        parsed = JSON.parse(objectPart);

        // Check if parsed result is a simple string (not object/array)
        if (typeof parsed === 'string') {
          // Return the plain string without JSON quotes
          const escapedString = escapeHtml(parsed);
          if (prefix.trim()) {
            const escapedPrefix = escapeHtml(prefix.trim());
            return `<span class="content-prefix">${escapedPrefix}</span>\n${escapedString}`;
          } else {
            return escapedString;
          }
        }

        // For objects and arrays, format as JSON
        jsonString = JSON.stringify(parsed, null, 2);
      } catch (jsonError) {
        // JSON parsing failed, continue with other parsing methods
        tryJsonFirst = false;
      }
    }

    // If we haven't successfully parsed as JSON yet, try other methods
    if (!tryJsonFirst || !jsonString) {
      // Remove surrounding quotes if present (for non-JSON quoted content)
      if (objectPart.startsWith('"') && objectPart.endsWith('"')) {
        objectPart = objectPart.slice(1, -1);
      }

      // Check if it's Salesforce notation or array content
      if (objectPart.trim().startsWith('[') && objectPart.trim().endsWith(']')) {
        // Handle quoted array content: [key=value, key=value]
        const arrayContent = objectPart.slice(1, -1); // Remove [ and ]
        parsed = parseComplexContent(arrayContent);
        jsonString = JSON.stringify(parsed, null, 2);
      } else {
        // Try to parse as Salesforce object notation
        parsed = parseSalesforceObjectNotation(objectPart);
        jsonString = JSON.stringify(parsed, null, 2);
      }
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