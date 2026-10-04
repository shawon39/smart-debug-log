// Formatting Utilities
// This file contains functions for JSON highlighting, governor limits formatting, and main object extraction

// Debug messages longer than these are shown as escaped text. JSON (Console.log, JSON.serialize) is read in
// linear time; toString text is split level by level, so it gets a lower limit.
const MAX_JSON_MESSAGE_LENGTH = 2000000;
const MAX_TOSTRING_MESSAGE_LENGTH = 300000;

// Shown under a value when Salesforce left out items (it prints the first 10 of a list, set or map, then "...")
const TOSTRING_CUT_NOTE = 'Salesforce prints only the first 10 items of a list, set or map. Use Console.log to see all of them.';

// One pass over escaped JSON: a key string, a ": value" pair, or any other string (read whole,
// so a ":" or digits inside a string are never highlighted)
const JSON_KEY_VALUE_TOKEN = /("(?:[^"\\]|\\.)*")(?=\s*:)|:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true\b|false\b|null\b)|"(?:[^"\\]|\\.)*"/g;

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
      const type = value.startsWith('"') ? 'json-string' : /^-?\d/.test(value) ? 'json-number' : 'json-boolean';
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

// Start of the type name when the bracket at i opens a record, class or system object
// ("Account:{", "Wrapper:[", "Database.SaveResult["), else -1
function typedValueStart(text, i) {
  const char = text[i];
  if ((char === '{' || char === '[') && text[i - 1] === ':' && i >= 2 && /\w/.test(text[i - 2])) {
    let start = i - 2;
    while (start > 0 && /\w/.test(text[start - 1])) start--;
    return start;
  }
  if (char === '[' && i >= 1 && /\w/.test(text[i - 1])) {
    let start = i - 1;
    while (start > 0 && /[\w.]/.test(text[start - 1])) start--;
    return /^[A-Za-z]\w*(?:\.\w+)+$/.test(text.slice(start, i)) ? start : -1;
  }
  return -1;
}

const TYPED_VALUE_AT = /\w+:[{[]/y;

// The values in a message and the text around them: { segments: [{ text } | { value }], cut }, or null when the
// message holds no value. The whole message can be one value of any kind ({1, 2, 3}); inside text, a value is a
// record or class (Type:{...}, Class:[...]), a system object (Ns.Type[...]), or a list, set or map holding them.
// A value that does not close (the message was cut) leaves the whole message as text.
function splitValueSegments(text) {
  const whole = parseApexValueText(text);
  if (whole) return { segments: [{ value: whole.value }], cut: whole.cut };

  const partner = bracketPartners(text);
  const typedStart = new Int32Array(text.length).fill(-1);
  const typedBefore = new Int32Array(text.length + 1);
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(' || text[i] === '{' || text[i] === '[') typedStart[i] = typedValueStart(text, i);
    typedBefore[i + 1] = typedBefore[i] + (typedStart[i] >= 0 ? 1 : 0);
  }

  // nextFreeCloser[close][i]: the first closer at or after i that pairs with nothing. A stray bracket in a text value
  // (e.g. "Smile :)") pairs with the opener of its value, which then ends at such a closer.
  const nextFreeCloser = {};
  for (const close of [')', '}', ']']) {
    const next = new Int32Array(text.length + 1).fill(-1);
    for (let i = text.length - 1; i >= 0; i--) next[i] = text[i] === close && partner[i] < 0 ? i : next[i + 1];
    nextFreeCloser[close] = next;
  }

  const last = text.length - 1;
  const firstBracket = text.search(/[({[]/);
  const segments = [];
  let cut = false;
  let textStart = 0;
  // Ends other than the paired bracket are tried within this budget (characters parsed), so long texts stay fast
  let budget = 2 * text.length;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char !== '(' && char !== '{' && char !== '[') continue;
    const end = partner[i];
    let start = typedStart[i];
    if (start < 0 && char !== '[') {
      // A list, set or map counts when it holds a record or class, or when it follows a label to the end of
      // the message ("Prices: {a=1, b=2}")
      TYPED_VALUE_AT.lastIndex = i + 1;
      const holdsTyped = end > i ? typedBefore[end] - typedBefore[i + 1] > 0 : TYPED_VALUE_AT.test(text);
      if (holdsTyped || (i === firstBracket && end === last)) start = i;
    }
    if (start < textStart) continue;

    // The value ends at its paired bracket, else at the next closer of its kind that pairs with nothing, else at
    // the end of the message
    const close = BRACKET_CLOSERS[char];
    const freeCloser = nextFreeCloser[close][i + 1];
    const ends = end > i ? [end] : [];
    if (freeCloser > end) ends.push(freeCloser);
    if (text[last] === close && last > end && last !== freeCloser) ends.push(last);
    let found = null;
    for (const valueEnd of ends) {
      if (valueEnd !== end) {
        if (budget <= 0) break;
        budget -= valueEnd - start + 1;
      }
      const ctx = { cut: false };
      const value = parseStructure(text.slice(start, valueEnd + 1), 1, ctx);
      if (value !== undefined) {
        found = { value, end: valueEnd, cut: ctx.cut };
        break;
      }
    }
    if (!found) {
      if (end < 0) return null;
      continue;
    }
    if (start > textStart) segments.push({ text: text.slice(textStart, start) });
    segments.push({ value: found.value });
    cut = cut || found.cut;
    textStart = found.end + 1;
    i = found.end;
  }
  if (segments.length === 0) return null;
  if (textStart <= last) segments.push({ text: text.slice(textStart) });
  return { segments, cut };
}

// Text longer than this around a value is not a label (e.g. a long log text before a JSON block)
const MAX_LABEL_LENGTH = 500;

// Text around a value: a short text as label lines, a long one as plain highlighted text
function textLinesHtml(text) {
  const trimmed = tidyExceptionText((text || '').trim());
  if (!trimmed) return '';
  if (trimmed.length > MAX_LABEL_LENGTH) return applyDebugLogHighlighting(trimmed);
  return trimmed.split('\n').map(line => `<span class="content-prefix">${escapeHtml(line)}</span>`).join('\n');
}

// Formats a debug message that holds JSON or toString values: each value as highlighted JSON, the text around
// it as label lines. Returns null when nothing can be formatted (the caller shows the message as text).
function extractAndParseSalesforceObjects(text) {
  if (!text) return null;

  // JSON (Console.log, JSON.serialize): the whole message or its last {...} / [...] block, without Salesforce
  // metadata, and the text around it (e.g. "Response:" in "Response: {...}")
  if (text.length <= MAX_JSON_MESSAGE_LENGTH) {
    try {
      const cleaned = cleanSalesforceResponse(text);
      if (cleaned && /^[[{]/.test(cleaned.json)) {
        return [textLinesHtml(cleaned.prefix), highlightJsonKeys(cleaned.json), textLinesHtml(cleaned.suffix)].filter(Boolean).join('\n');
      }
      // The whole message is one JSON string, e.g. System.debug(JSON.serialize('text')): show the text
      if (cleaned && cleaned.json.startsWith('"') && !cleaned.prefix && !cleaned.suffix) {
        return escapeHtml(JSON.parse(cleaned.json));
      }
    } catch (error) {
      // Not JSON: continue with toString values
    }
  }
  if (text.length > MAX_TOSTRING_MESSAGE_LENGTH) return null;

  try {
    // Multi-line object: ObjectName:\n"[key=value, ...]"
    const multiLineMatch = text.match(/^(\w+):[^\S\r\n]*[\r\n]\s*"(\[.*\])"$/s);
    if (multiLineMatch) {
      const [, objectName, content] = multiLineMatch;
      return highlightJsonKeys(JSON.stringify({ [objectName]: parseComplexContent(content.slice(1, -1)) }, null, 2));
    }

    const found = splitValueSegments(text.trim());
    if (found) {
      const lines = found.segments.map(segment => 'value' in segment
        ? highlightJsonKeys(JSON.stringify(segment.value, null, 2))
        : textLinesHtml(segment.text));
      if (found.cut) lines.push(`<span class="content-note">${escapeHtml(TOSTRING_CUT_NOTE)}</span>`);
      return lines.filter(Boolean).join('\n');
    }

    // Quoted key=value list: Label "[key=value, ...]"
    const quoteStart = text.indexOf('"[');
    if (text.endsWith(']"') && quoteStart !== -1 && text.indexOf('=', quoteStart) !== -1 && !text.slice(0, quoteStart).includes('"')) {
      const parsed = parseComplexContent(text.slice(quoteStart + 2, -2));
      return [textLinesHtml(text.slice(0, quoteStart)), highlightJsonKeys(JSON.stringify(parsed, null, 2))].filter(Boolean).join('\n');
    }
  } catch (error) {
    // Shown as text
  }
  return null;
}
