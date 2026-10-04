// Basic Salesforce Object Parsing
// This file contains the parser for Salesforce toString() notation (see System.debug.md):
// SObjects Type:{...}, custom classes Class:[...], lists (...), sets {...} and maps {key=value}.
// Splitting is depth aware: commas and the key "=" only count outside (), {} and [].
// Quotes are not delimiters: toString() does not quote strings, so O'Brien is just text.

// Deeper nesting than this is shown as text
const TOSTRING_MAX_DEPTH = 50;

// Main Salesforce object parsing function
function parseSalesforceObjectNotation(text) {
  try {
    const trimmedText = text.trim();
      
    // Handle different patterns
    
    // Pattern 1: WRAPS (raw): (WrapperType:[...])
    const wrapsMatch = trimmedText.match(/^WRAPS\s*\(raw\):\s*(.+)$/);
    if (wrapsMatch) {
      return parseStructure(wrapsMatch[1]);
    }
    
    // Pattern 2: One wrapper in parentheses (WrapperType:[...]); its fields are listed under the type name
    const wrapperMatch = trimmedText.match(/^\((\w+):\[(.+)\]\)$/);
    if (wrapperMatch && findClosingBracket(trimmedText, wrapperMatch[1].length + 2) === trimmedText.length - 2) {
      const [, wrapperType, content] = wrapperMatch;
      return {
        [wrapperType]: parseStructure(`[${content}]`)
      };
    }
    
    // Pattern 3: Custom Apex class with square brackets ClassName:[...] 
    const complexObjectMatch = trimmedText.match(/^(\w+):\[(.+)\]$/);
    if (complexObjectMatch) {
      const [, objectType, content] = complexObjectMatch;
      return { _apexType: objectType, ...parseEntries(content, 1, true) };
    }
    
    // Check for truncated custom class at top level
    const truncatedClassMatch = trimmedText.match(/^(\w+):\[/);
    if (truncatedClassMatch && !trimmedText.endsWith(']')) {
      // Return raw string for any truncated custom class
      return trimmedText;
    }
    
    // Pattern 4: Multiple objects in parentheses (Object:{...}, Object:{...})
    if (trimmedText.startsWith('(') && trimmedText.endsWith(')')) {
      const content = trimmedText.slice(1, -1);
      return parseElements(content, 1);
    }
        
    // Pattern 5: SObject Object:{...}
    const objectMatch = trimmedText.match(/^(\w+):\{(.+)\}$/);
    if (objectMatch) {
      const [, objectType, content] = objectMatch;
      return { _apexType: objectType, ...parseEntries(content, 1, true) };
    }
    
    // Check for truncated SObject at top level
    const truncatedSObjectMatch = trimmedText.match(/^(\w+):\{/);
    if (truncatedSObjectMatch && !trimmedText.endsWith('}')) {
      // Return raw string for truncated SObject
      return trimmedText;
    }
    
    // Pattern 6: Raw curly brace content - Map {key=val, ...} (has = at depth 0) or Set {1, 2, 3}
    if (trimmedText.startsWith('{') && trimmedText.endsWith('}')) {
      return parseBraces(trimmedText.slice(1, -1), 1);
    }
    
    // If no pattern matches, return as string
    return trimmedText;
    
  } catch (error) {
    return text;
  }
}

function parseStructure(content) {
  try {
    // Handle array-like structures [item1, item2, ...] or parentheses (item1, item2, ...)
    if ((content.startsWith('[') && content.endsWith(']')) ||
        (content.startsWith('(') && content.endsWith(')'))) {
      return parseElements(content.slice(1, -1), 1);
    }
    
    // Handle single object
    return parseElements(content, 1);
  } catch (error) {
    return content;
  }
}

// Marks the brackets that belong to a pair. An opener that is never closed (e.g. "Sad :(" in a text value)
// and a closer without an opener are plain text, so they do not change the depth.
function pairedBrackets(text) {
  const paired = new Uint8Array(text.length);
  const openers = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(' || char === '{' || char === '[') {
      openers.push(i);
    } else if ((char === ')' || char === '}' || char === ']') && openers.length > 0) {
      paired[openers.pop()] = 1;
      paired[i] = 1;
    }
  }
  return paired;
}
    
// Splits text on a separator character that is at depth 0 (outside brackets)
function splitTopLevel(text, separator) {
  const paired = pairedBrackets(text);
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (paired[i]) {
      depth += (char === '(' || char === '{' || char === '[') ? 1 : -1;
    } else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}
    
// Index of the first separator character at depth 0, or -1
function indexOfTopLevel(text, separator) {
  const parts = splitTopLevel(text, separator);
  return parts.length > 1 ? parts[0].length : -1;
}
      
// Index of the bracket that closes the one at openIndex, or -1
function findClosingBracket(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const char = text[i];
    if (char === '(' || char === '{' || char === '[') depth++;
    else if (char === ')' || char === '}' || char === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
  
// Converts number text only when nothing is lost: no leading zeros (02134), within the safe
// integer range, and decimals that print back the same (trailing zeros aside)
function parseSafeNumber(text) {
  if (/^-?(0|[1-9]\d*)$/.test(text)) {
    const number = Number(text);
    return Number.isSafeInteger(number) ? number : undefined;
  }
  if (/^-?(0|[1-9]\d*)\.\d+$/.test(text)) {
    const number = Number(text);
    return String(number) === text.replace(/\.?0+$/, '') ? number : undefined;
  }
  return undefined;
}
  
// Elements of a list or set: "a, b, c" -> parsed values (one element is returned on its own)
function parseElements(content, depth) {
  const objects = [];
  for (const part of splitTopLevel(content, ',')) {
    if (part.trim()) {
      objects.push(parseSingleObject(part.trim(), depth));
    }
  }
  return objects.length === 1 ? objects[0] : objects;
}

function parseSingleObject(content, depth = 1) {
  // Handle primitives first (for lists like (47, 52, null))
  if (content === 'null') return null;
  if (content === 'true') return true;
  if (content === 'false') return false;
  
  // Handle numbers (including negative)
  const number = parseSafeNumber(content);
  if (number !== undefined) return number;
    
  if (depth > TOSTRING_MAX_DEPTH) return content;
  
  // Handle SObject ObjectType:{...} and custom class ClassName:[...]
  const typedObject = parseTypedObject(content, depth);
  if (typedObject !== undefined) return typedObject;
  
  // Nested list (...) or set/map {...}
  if (content.startsWith('(') && content.endsWith(')')) {
    return parseElements(content.slice(1, -1), depth + 1);
  }
  if (content.startsWith('{') && content.endsWith('}')) {
    return parseBraces(content.slice(1, -1), depth + 1);
  }
  
  // Handle key=value assignments
  const assignmentMatch = content.match(/^(\w+)=(.+)$/);
  if (assignmentMatch) {
    const [, key, value] = assignmentMatch;
    return {
      [key]: parseValue(value, depth)
    };
  }
  
  return content;
}

// SObject ObjectType:{...} or custom class ClassName:[...]; undefined for anything else (including truncated ones)
function parseTypedObject(content, depth) {
  const match = content.match(/^(\w+):\{(.+)\}$/) || content.match(/^(\w+):\[(.+)\]$/);
  if (!match) return undefined;
  const [, objectType, innerContent] = match;
  return { _apexType: objectType, ...parseEntries(innerContent, depth + 1, true) };
}

// Set or map body (without the braces): a map has "=" at depth 0
function parseBraces(content, depth) {
  if (indexOfTopLevel(content, '=') !== -1) {
    return parseEntries(content, depth, false);
  }
  return parseElements(content, depth);
}
        
// "key=value, key=value" -> object. Each entry splits on its first "=" at depth 0.
// Field names (identifierKeys) are words; a part that is not "word=..." belongs to the previous value
// (e.g. Name=Smith, John). Map keys can be any text, e.g. {first name=Bob} or {Account:{Name=Bob}=null}.
function parseEntries(content, depth, identifierKeys) {
  const rawValues = new Map();
  let lastKey = null;
        
  for (const part of splitTopLevel(content, ',')) {
    if (!part.trim()) continue;
          
    const equalIndex = indexOfTopLevel(part, '=');
    const key = equalIndex === -1 ? '' : part.slice(0, equalIndex).trim();
    const isEntry = key !== '' && (!identifierKeys || /^\w+$/.test(key));
        
    if (!isEntry && lastKey !== null) {
      rawValues.set(lastKey, rawValues.get(lastKey) + ',' + part);
    } else if (!isEntry) {
      rawValues.set(part.trim(), null);
    } else {
      rawValues.set(key, part.slice(equalIndex + 1));
      lastKey = key;
    }
  }
  
  const result = {};
  rawValues.forEach((rawValue, key) => {
    result[key] = rawValue === null ? null : parseValue(rawValue.trim(), depth);
  });
  return result;
}

function parseValue(value, depth = 1) {
  // Strip leading/trailing quotes if present
  let cleanValue = value;
  if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
      (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
    cleanValue = cleanValue.slice(1, -1);
  }
  
  // Handle null
  if (cleanValue === 'null') {
    return null;
  }
  
  // Handle boolean
  if (cleanValue === 'true') return true;
  if (cleanValue === 'false') return false;
  
  // Handle numbers (including negative)
  const number = parseSafeNumber(cleanValue);
  if (number !== undefined) return number;
  
  if (depth <= TOSTRING_MAX_DEPTH) {
    // Handle lists
    if (cleanValue.startsWith('(') && cleanValue.endsWith(')')) {
      return parseElements(cleanValue.slice(1, -1), depth + 1);
    }
  
    // Handle objects
    const typedObject = parseTypedObject(cleanValue, depth);
    if (typedObject !== undefined) return typedObject;

    // Handle sets and maps (a JSON text value such as {"a":1} stays text)
    if (cleanValue.startsWith('{') && cleanValue.endsWith('}') && !cleanValue.slice(1).trim().startsWith('"')) {
      return parseBraces(cleanValue.slice(1, -1), depth + 1);
    }
  }
  
  // Clean up datetime strings with extra spaces (00: 00: 00 -> 00:00:00)
  cleanValue = cleanValue.replace(/(\d{2}):\s+(\d{2}):\s+(\d{2})/g, '$1:$2:$3');
  
  // Return as string
  return cleanValue;
}
