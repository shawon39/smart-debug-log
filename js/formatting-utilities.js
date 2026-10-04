// Formatting Utilities
// This file contains functions for JSON highlighting, governor limits formatting, and main object extraction

// Debug messages longer than this are not structure-parsed (they are shown as escaped text)
const MAX_STRUCTURED_MESSAGE_LENGTH = 50000;

// One pass over escaped JSON: a key string, a ": value" pair, or any other string (read whole,
// so a ":" or digits inside a string are never highlighted)
const JSON_KEY_VALUE_TOKEN = /("(?:[^"\\]|\\.)*")(?=\s*:)|:\s*("(?:[^"\\]|\\.)*"|\d+\.?\d*|true\b|false\b|null\b)|"(?:[^"\\]|\\.)*"/g;

// Simple JSON key highlighting only
function highlightJsonKeys(jsonString) {
  try {
    return escapeHtml(jsonString).replace(JSON_KEY_VALUE_TOKEN, (token, key, value) => {
      if (key) {
        return `<span class="json-key">${key}</span>`;
      }
      if (value === undefined) {
        return token;
      }
      const type = value.startsWith('"') ? 'json-string' : /^\d/.test(value) ? 'json-number' : 'json-boolean';
      return `: <span class="${type}">${value}</span>`;
    });
  } catch (error) {
    return escapeHtml(jsonString);
  }
}

function formatGovernorLimits(limitsText) {
  try {
    if (!limitsText || !limitsText.trim()) {
      return limitsText;
    }

    // Parse "LIMIT_USAGE_FOR_NS|ns|" headers and "Label: used out of max" rows, grouped by namespace
    const groups = [];
    let current = null;
    limitsText.split('\n').forEach(line => {
      const ns = line.match(/LIMIT_USAGE_FOR_NS\|([^|]+)\|/);
      if (ns) {
        current = { namespace: ns[1], rows: [] };
        groups.push(current);
        return;
      }
      const m = line.match(/^\s*([A-Za-z][A-Za-z ]*?):\s*(\d+)\s+out of\s+(\d+)/);
      if (m) {
        if (!current) {
          current = { namespace: '', rows: [] };
          groups.push(current);
        }
        const label = m[1].replace(/^(Number of|Maximum)\s+/i, '');
        current.rows.push({ label: label.charAt(0).toUpperCase() + label.slice(1), used: Number(m[2]), max: Number(m[3]) });
      }
    });

    // Unknown format: show the text as-is rather than nothing
    if (!groups.some(group => group.rows.length > 0)) {
      return `<pre class="limits-raw">${escapeHtml(limitsText)}</pre>`;
    }

    return groups.filter(group => group.rows.length > 0).map(({ namespace, rows }) => {
      const rowHtml = ({ label, used, max }) => {
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
      };

      // Used limits stay in view; the ones at 0 fold away under a toggle
      const usedRows = rows.filter(row => row.used > 0);
      const unusedRows = rows.filter(row => row.used === 0);
      const usedHtml = usedRows.length
        ? `<div class="limits-list">${usedRows.map(rowHtml).join('')}</div>`
        : '<div class="limits-none">No limits used</div>';
      const unusedHtml = unusedRows.length
        ? `<details class="limits-unused"><summary>Show ${unusedRows.length} unused limit${unusedRows.length === 1 ? '' : 's'}</summary><div class="limits-list">${unusedRows.map(rowHtml).join('')}</div></details>`
        : '';

      const nsHtml = namespace ? `<div class="limits-ns">Governor limits <span>${escapeHtml(namespace)}</span></div>` : '';
      return `<div class="limits-group">${nsHtml}${usedHtml}${unusedHtml}</div>`;
    }).join('');
  } catch (error) {
    return `<pre class="limits-raw">${escapeHtml(limitsText)}</pre>`;
  }
}

// Start/end of the rightmost top-level (...) group that holds Salesforce objects, or null (one linear scan)
function findLastSObjectListGroup(text) {
  const paired = pairedBrackets(text);
  let depth = 0;
  let groupStart = -1;
  let last = null;
  for (let i = 0; i < text.length; i++) {
    if (!paired[i]) continue;
    const char = text[i];
    if (char === '(' || char === '{' || char === '[') {
      if (depth === 0) groupStart = char === '(' ? i : -1;
      depth++;
    } else {
      depth--;
      if (depth === 0 && groupStart !== -1 && char === ')' && hasTypedBodyWithEquals(text.slice(groupStart, i + 1), '{', '}')) {
        last = { start: groupStart, end: i + 1 };
      }
    }
  }
  return last;
}

// Same result as /^([^<stop>]*?)(\w+:<open>.*<close>)$/s ("Some text Account:{...}"), in linear time:
// the object starts at the word before the first stop character, which must be "<word>:<open>"
function matchTypedObjectTail(text, open, close, stopChars) {
  if (!text.endsWith(close)) return null;
  let first = 0;
  while (first < text.length && !stopChars.includes(text[first])) first++;
  if (first < 2 || text[first] !== open || text[first - 1] !== ':' || !/\w/.test(text[first - 2])) return null;
  let start = first - 2;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  return [text, text.slice(0, start), text.slice(start)];
}

function extractAndParseSalesforceObjects(text) {
  if (!text) return escapeHtml(text);

  // The caller has already decoded HTML entities (once)
  let decodedText = text;

  // First, try to clean Salesforce API responses (JSON with attributes/metadata)
  try {
    const cleanedResponse = cleanSalesforceResponse(decodedText);
    if (cleanedResponse && cleanedResponse.json !== decodedText) {
      // Keep the text around the JSON, e.g. "Response:" in "Response: {...}"
      let highlightedJson = highlightJsonKeys(cleanedResponse.json);
      if (cleanedResponse.prefix) {
        highlightedJson = `<span class="content-prefix">${escapeHtml(cleanedResponse.prefix)}</span>\n${highlightedJson}`;
      }
      if (cleanedResponse.suffix) {
        highlightedJson = `${highlightedJson}\n<span class="content-prefix">${escapeHtml(cleanedResponse.suffix)}</span>`;
      }
      return highlightedJson;
    }
  } catch (error) {
    // Continue with original parsing if cleaning fails
  }

  // Check for multi-line Salesforce object pattern: ObjectName:\n"[...]"
  const multiLineMatch = decodedText.match(/^(\w+):[^\S\r\n]*[\r\n]\s*"(\[.*\])"$/s);
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
  const lastParenGroup = findLastSObjectListGroup(decodedText);

  // If we found parentheses groups with Salesforce objects, use the rightmost one
  if (lastParenGroup) {
    prefix = decodedText.substring(0, lastParenGroup.start).trim();
    objectPart = decodedText.substring(lastParenGroup.start, lastParenGroup.end);
  } else {
    // Fallback to original pattern matching
    // Look for common patterns where object data starts
    // (patterns that can only match a text with a given last character are skipped otherwise)
    const patterns = [
      // Pattern: "Full Account → Account:{Id=001..., Name=...}"
      /^([^→]*→\s*)(\w+:\{.*\})$/s,
      // Pattern: "Some text:(Account:{...}, Contact:{...})"
      decodedText.endsWith(')') ? /^([^(]*?)(\([^)]*\w:\{.*\))$/s : null,
      // Pattern: "Some text Account:{...}"
      (t) => matchTypedObjectTail(t, '{', '}', '{'),
      // Pattern: "Some text Account:[...]"
      (t) => matchTypedObjectTail(t, '[', ']', '{[]'),
      // Pattern: "Some text {"key":"value",...}"
      /^([^{[\]]*?)([\{\[].*[\}\]])$/s,
      // Pattern: Multi-line JSON from JSON.serializePretty
      /^([^{[\]]*?)([\{\[][\s\S]*[\}\]])$/,
      // Pattern: Quoted content "[key=value, ...]"
      /\]"?$/.test(decodedText) ? /^([^"]*)("?\[.*\]"?)$/s : null,
      // Pattern: Direct object/array (no prefix)
      /^()([\{\[].*[\}\]])$/s,
      // Pattern: Direct Salesforce object (no prefix)
      /^()(\w+:\{.*\})$/s
    ];

    for (const pattern of patterns) {
      if (!pattern) continue;
      const match = typeof pattern === 'function' ? pattern(decodedText) : decodedText.match(pattern);
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