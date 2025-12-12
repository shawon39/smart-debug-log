// Basic Salesforce Object Parsing
// This file contains basic parsing functions for Salesforce object notation

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
    
    // Pattern 2: Simple wrapper (WrapperType:[...])
    const wrapperMatch = trimmedText.match(/^\((\w+):\[(.+)\]\)$/);
    if (wrapperMatch) {
      const [, wrapperType, content] = wrapperMatch;
      return {
        [wrapperType]: parseStructure(`[${content}]`)
      };
    }
    
    // Pattern 3: Custom Apex class with square brackets ClassName:[...] 
    const complexObjectMatch = trimmedText.match(/^(\w+):\[(.+)\]$/);
    if (complexObjectMatch) {
      const [, objectType, content] = complexObjectMatch;
      
      // Check if this contains nested custom wrappers
      if (hasNestedWrappers(content)) {
        // Return raw content for nested wrappers
        return trimmedText;
      }
      
      // Simple wrapper without nesting - parse normally
      const parsed = parseComplexContent(content);
      return { _apexType: objectType, ...parsed };
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
      return parseMultipleObjects(content);
    }
        
    // Pattern 5: SObject Object:{...}
    const objectMatch = trimmedText.match(/^(\w+):\{(.+)\}$/);
    if (objectMatch) {
      const [, objectType, content] = objectMatch;
      const parsed = parseKeyValuePairs(content);
      return { _apexType: objectType, ...parsed };
    }
    
    // Check for truncated SObject at top level
    const truncatedSObjectMatch = trimmedText.match(/^(\w+):\{/);
    if (truncatedSObjectMatch && !trimmedText.endsWith('}')) {
      // Return raw string for truncated SObject
      return trimmedText;
    }
    
    // Pattern 6: Raw curly brace content - could be Set or Map
    if (trimmedText.startsWith('{') && trimmedText.endsWith('}')) {
      const content = trimmedText.slice(1, -1);
      
      // Check if there's an = at depth 0 to distinguish Set from Map
      // Sets: {1, 2, 3} - no = at depth 0
      // Maps: {key=val, key2=val2} - has = at depth 0
      if (hasEqualsAtDepthZero(content)) {
        // This is a Map
        if (content.includes(':{')) {
          // Map with Salesforce objects as values
          return parseMapContent(content);
        } else {
          // Regular key=value pairs
          return parseKeyValuePairs(content);
        }
      } else {
        // This is a Set - parse elements as array
        return parseMultipleObjects(content);
      }
    }
    
    // If no pattern matches, return as string
    return trimmedText;
    
  } catch (error) {
    return text;
  }
}

function parseStructure(content) {
  try {
    // Handle array-like structures [item1, item2, ...]
    if (content.startsWith('[') && content.endsWith(']')) {
      const innerContent = content.slice(1, -1);
      return parseMultipleObjects(innerContent);
    }
    
    // Handle parentheses (item1, item2, ...)
    if (content.startsWith('(') && content.endsWith(')')) {
      const innerContent = content.slice(1, -1);
      return parseMultipleObjects(innerContent);
    }
    
    // Handle single object
    return parseMultipleObjects(content);
  } catch (error) {
    return content;
  }
}

function parseMultipleObjects(content) {
  const objects = [];
  let currentObject = '';
  let braceCount = 0;
  let parenCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    
    // Handle string escaping
    if (escapeNext) {
      escapeNext = false;
      currentObject += char;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      currentObject += char;
      continue;
    }
    
    if (char === '"' || char === "'") {
      inString = !inString;
      currentObject += char;
      continue;
    }
    
    // Only count brackets when not in a string
    if (!inString) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;
      
      // Split on comma only when all brackets are balanced and not in string
      if (char === ',' && braceCount === 0 && parenCount === 0 && bracketCount === 0) {
        if (currentObject.trim()) {
          objects.push(parseSingleObject(currentObject.trim()));
        }
        currentObject = '';
        continue;
      }
    }
    
    currentObject += char;
  }
  
  if (currentObject.trim()) {
    objects.push(parseSingleObject(currentObject.trim()));
  }
  
  return objects.length === 1 ? objects[0] : objects;
}

function parseSingleObject(content) {
  // Handle primitives first (for lists like (47, 52, null))
  if (content === 'null') return null;
  if (content === 'true') return true;
  if (content === 'false') return false;
  
  // Handle numbers (including negative)
  if (/^-?\d+$/.test(content)) {
    return parseInt(content, 10);
  }
  if (/^-?\d+\.\d+$/.test(content)) {
    return parseFloat(content);
  }
  
  // Handle custom class pattern ClassName:[...]
  const wrapperMatch = content.match(/^(\w+):\[(.+)\]$/);
  if (wrapperMatch) {
    const [, wrapperType, innerContent] = wrapperMatch;
    
    // Check if this contains nested custom wrappers
    if (hasNestedWrappers(innerContent)) {
      // Return raw content for nested wrappers
      return content;
    }
    
    // Simple wrapper without nesting - parse normally
    const parsed = parseKeyValuePairs(innerContent);
    return { _apexType: wrapperType, ...parsed };
  }
  
  // Check for truncated custom class (starts with ClassName:[ but no closing ])
  const truncatedWrapperMatch = content.match(/^(\w+):\[/);
  if (truncatedWrapperMatch && !content.endsWith(']')) {
    // Return raw string for any truncated custom class
    return content;
  }
  
  // Handle SObject pattern ObjectType:{...}
  const objectMatch = content.match(/^(\w+):\{(.+)\}$/);
  if (objectMatch) {
    const [, objectType, innerContent] = objectMatch;
    const parsed = parseKeyValuePairs(innerContent);
    return { _apexType: objectType, ...parsed };
  }
  
  // Check for truncated SObject (starts with ObjectType:{ but no closing })
  const truncatedObjectMatch = content.match(/^(\w+):\{/);
  if (truncatedObjectMatch && !content.endsWith('}')) {
    // Return raw string for truncated SObject
    return content;
  }
  
  // Handle key=value assignments
  const assignmentMatch = content.match(/^(\w+)=(.+)$/);
  if (assignmentMatch) {
    const [, key, value] = assignmentMatch;
    return {
      [key]: parseValue(value)
    };
  }
  
  return content;
}

function parseKeyValuePairs(content) {
  const result = {};
  
  // Use improved parsing that identifies key=value patterns instead of splitting on commas
  const pairs = extractKeyValuePairs(content);
  
  for (const pair of pairs) {
    const parsed = parseKeyValuePair(pair);
    Object.assign(result, parsed);
  }
  
  return result;
}

// Function to extract key=value pairs based on pattern matching
function extractKeyValuePairs(content) {
  const pairs = [];
  
  // Find all key=value positions in the content
  const keyValuePositions = [];
  const keyPattern = /\b(\w+)\s*=/g;
  let match;
  
  while ((match = keyPattern.exec(content)) !== null) {
    keyValuePositions.push({
      keyStart: match.index,
      keyEnd: match.index + match[1].length,
      equalPos: keyPattern.lastIndex - 1,
      key: match[1]
    });
  }
  
  if (keyValuePositions.length === 0) {
    return [];
  }
  
  // Extract key=value pairs based on positions
  for (let i = 0; i < keyValuePositions.length; i++) {
    const currentPos = keyValuePositions[i];
    const nextPos = keyValuePositions[i + 1];
    
    let valueStart = currentPos.equalPos + 1;
    let valueEnd = nextPos ? nextPos.keyStart : content.length;
    
    // If there's a next key, find the proper boundary by looking backwards from the next key
    if (nextPos) {
      // Look backwards from the next key to find where this value should end
      let searchPos = nextPos.keyStart - 1;
      let depth = 0;
      let inString = false;
      let escapeNext = false;
      
      // Find the last comma before the next key that's at depth 0
      while (searchPos > valueStart) {
        const char = content[searchPos];
        
        if (escapeNext) {
          escapeNext = false;
          searchPos--;
          continue;
        }
        
        if (char === '\\') {
          escapeNext = true;
          searchPos--;
          continue;
        }
        
        if (char === '"' || char === "'") {
          inString = !inString;
          searchPos--;
          continue;
        }
        
        if (!inString) {
          if (char === '}' || char === ')' || char === ']') depth++;
          if (char === '{' || char === '(' || char === '[') depth--;
          
          if (char === ',' && depth === 0) {
            valueEnd = searchPos;
            break;
          }
        }
        
        searchPos--;
      }
    }
    
    // Extract and clean the key=value pair
    const key = currentPos.key;
    const value = content.substring(valueStart, valueEnd).trim();
    
    // Remove trailing comma if present
    const cleanValue = value.replace(/,\s*$/, '');
    
    pairs.push(`${key}=${cleanValue}`);
  }
  
  return pairs;
}

function parseKeyValuePair(pair) {
  const equalIndex = pair.indexOf('=');
  if (equalIndex === -1) {
    return { [pair]: null };
  }
  
  const key = pair.substring(0, equalIndex).trim();
  const value = pair.substring(equalIndex + 1).trim();
    
  return { [key]: parseValue(value) };
}

function parseValue(value) {
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
  if (/^-?\d+$/.test(cleanValue)) {
    return parseInt(cleanValue, 10);
  }
  if (/^-?\d+\.\d+$/.test(cleanValue)) {
    return parseFloat(cleanValue);
  }
  
  // Handle nested structures
  if (cleanValue.startsWith('(') && cleanValue.endsWith(')')) {
    return parseStructure(cleanValue);
  }
  
  // Handle objects
  if (cleanValue.includes(':{')) {
    return parseSingleObject(cleanValue);
  }
  
  // Clean up datetime strings with extra spaces (00: 00: 00 -> 00:00:00)
  cleanValue = cleanValue.replace(/(\d{2}):\s+(\d{2}):\s+(\d{2})/g, '$1:$2:$3');
  
  // Return as string
  return cleanValue;
}

// Function to parse map content like "key1=value1, key2=value2, ..."
function parseMapContent(content) {
  const result = {};
  
  // Use similar parsing logic as parseMultipleObjects but for key=value pairs
  let currentPair = '';
  let braceCount = 0;
  let parenCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    
    // Handle string escaping
    if (escapeNext) {
      escapeNext = false;
      currentPair += char;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      currentPair += char;
      continue;
    }
    
    if (char === '"' || char === "'") {
      inString = !inString;
      currentPair += char;
      continue;
    }
    
    // Only count brackets when not in a string
    if (!inString) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;
      
      // Split on comma only when all brackets are balanced and not in string
      if (char === ',' && braceCount === 0 && parenCount === 0 && bracketCount === 0) {
        if (currentPair.trim()) {
          const parsedPair = parseMapKeyValuePair(currentPair.trim());
          Object.assign(result, parsedPair);
        }
        currentPair = '';
        continue;
      }
    }
    
    currentPair += char;
  }
  
  // Handle the last pair
  if (currentPair.trim()) {
    const parsedPair = parseMapKeyValuePair(currentPair.trim());
    Object.assign(result, parsedPair);
  }
  
  return result;
}

// Function to parse individual map key=value pairs
function parseMapKeyValuePair(pair) {
  const equalIndex = pair.indexOf('=');
  if (equalIndex === -1) {
    return { [pair]: null };
  }
  
  const key = pair.substring(0, equalIndex).trim();
  const value = pair.substring(equalIndex + 1).trim();
  
  // Parse the value - it might be a complex object like Account:{Id=..., Name=...}
  let parsedValue;
  if (value.includes(':{')) {
    // This is a Salesforce object notation
    parsedValue = parseSingleObject(value);
  } else {
    // Use the regular value parsing
    parsedValue = parseValue(value);
  }
  
  return { [key]: parsedValue };
}

// Helper function to check if content has = at depth 0
// Used to distinguish Sets {1, 2, 3} from Maps {key=val}
function hasEqualsAtDepthZero(content) {
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' || char === "'") {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{' || char === '(' || char === '[') depth++;
      if (char === '}' || char === ')' || char === ']') depth--;
      
      if (char === '=' && depth === 0) {
        return true;
      }
    }
  }
  
  return false;
}

// Helper function to detect nested custom wrappers
// Returns true if content contains another ClassName:[ pattern
function hasNestedWrappers(content) {
  // Look for ClassName:[ pattern indicating a custom wrapper
  return /\w+:\[/.test(content);
} 