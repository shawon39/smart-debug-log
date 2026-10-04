// Salesforce Response Cleaner
// This file contains utilities for cleaning Salesforce API responses

// Main function to clean Salesforce API responses.
// Returns { prefix, json, suffix }: json is the JSON found in rawText, pretty-printed without SOQL metadata,
// and prefix/suffix are the texts around it (e.g. "Response:"). Returns null when there is no JSON.
function cleanSalesforceResponse(rawText) {
  try {
    if (!rawText || typeof rawText !== 'string') {
      return null;
    }

    // Extract JSON from the text
    const found = extractJsonFromText(rawText);
    if (!found) {
      return null;
    }

    // Clean by removing unwanted metadata fields
    return {
      prefix: rawText.slice(0, found.start).trim(),
      json: JSON.stringify(removeUnwantedFields(found.data), null, 2),
      suffix: rawText.slice(found.end).trim()
    };
  } catch (error) {
    return null;
  }
}

// Removes Salesforce metadata only where Salesforce puts it, so user JSON keeps its own "done" or "attributes" keys:
// "done" of a SOQL query result ({ totalSize, done, records }) and "attributes" ({ type, url }) of a record.
function removeUnwantedFields(data) {
  if (Array.isArray(data)) {
    return data.map(item => removeUnwantedFields(item));
  } else if (data && typeof data === 'object' && !isRawJson(data)) {
    const isQueryResult = 'totalSize' in data && 'done' in data && 'records' in data;
    const cleaned = {};
    
    for (const [key, value] of Object.entries(data)) {
      // Skip unwanted metadata fields
      if ((key === 'done' && isQueryResult) || (key === 'attributes' && isRecordAttributes(value))) {
        continue;
      }
      
      // Recursively process nested objects and arrays
      cleaned[key] = removeUnwantedFields(value);
    }
    
    return cleaned;
  }
  
  return data;
}

// A record's attributes: { type, url }, or { type } alone for a record that is not saved yet
function isRecordAttributes(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.type === 'string' &&
    (value.url === undefined || typeof value.url === 'string') &&
    Object.keys(value).every(key => key === 'type' || key === 'url');
}

function isRawJson(value) {
  return typeof JSON.isRawJSON === 'function' && JSON.isRawJSON(value);
}

// JSON.parse reviver that keeps numbers as written (10.50, 9007199254740993); see exactNumber in basic-parsing.js
function keepNumberText(key, value, context) {
  if (typeof value === 'number' && context && typeof context.source === 'string') {
    const number = exactNumber(context.source);
    if (number !== undefined) return number;
  }
  return value;
}

// Extracts JSON from a raw text string: the whole text, or else the last {...} / [...] block in it.
// Returns { data, start, end } (end is exclusive) or null. Runs in linear time.
function extractJsonFromText(text) {
  // First try direct parsing
  try {
    const data = JSON.parse(text.trim(), keepNumberText);
    const start = text.length - text.trimStart().length;
    return { data, start, end: start + text.trim().length };
  } catch (e) {
    // Continue with the last JSON block
  }

  const block = findLastJsonBlock(text);
  if (!block) {
    return null;
  }
    
  try {
    return { data: JSON.parse(text.slice(block.start, block.end), keepNumberText), start: block.start, end: block.end };
  } catch (e) {
    return null;
  }
}
  
// Finds the last top-level {...} or [...] block: from the last closing bracket back to its opening bracket.
// Brackets inside JSON strings are skipped (a quote is escaped when an odd number of backslashes precede it).
function findLastJsonBlock(text) {
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (end === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  for (let i = end; i >= 0; i--) {
    const char = text[i];
    if (char === '"') {
      let backslashes = 0;
      while (i - backslashes - 1 >= 0 && text[i - backslashes - 1] === '\\') backslashes++;
      if (backslashes % 2 === 0) inString = !inString;
    } else if (!inString) {
      if (char === '}' || char === ']') depth++;
      else if (char === '{' || char === '[') {
        depth--;
        if (depth === 0) return { start: i, end: end + 1 };
      }
    }
  }
  return null;
} 
