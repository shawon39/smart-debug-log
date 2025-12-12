// Complex Salesforce Object Parsing
// This file contains complex and collection parsing functions for Salesforce object notation

function parseComplexContent(content) {
  try {
    // This function handles complex content that can contain key=value pairs
    // and nested collections like Bookmarks=(Bookmark:[...], Bookmark:[...])
    
    const result = {};
    
    // Use improved parsing that identifies key=value patterns instead of splitting on commas
    const pairs = extractComplexKeyValuePairs(content);
    
    for (const pair of pairs) {
      const parsed = parseComplexKeyValuePair(pair);
      Object.assign(result, parsed);
    }
    
    return result;
  } catch (error) {
    return content;
  }
}

// Function to extract complex key=value pairs based on pattern matching
function extractComplexKeyValuePairs(content) {
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

function parseComplexKeyValuePair(pair) {
  try {
    const equalIndex = pair.indexOf('=');
    if (equalIndex === -1) {
      return { [pair]: null };
    }
    
    const key = pair.substring(0, equalIndex).trim();
    const value = pair.substring(equalIndex + 1).trim();
    
    return { [key]: parseComplexValue(value) };
  } catch (error) {
    return { [pair]: null };
  }
}

function parseComplexValue(value) {
  try {
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
    
    // Handle collections in parentheses like (Bookmark:[...], Bookmark:[...])
    if (cleanValue.startsWith('(') && cleanValue.endsWith(')')) {
      const innerContent = cleanValue.slice(1, -1);
      return parseCollectionContent(innerContent);
    }
    
    // Handle arrays in square brackets like [item1, item2]
    if (cleanValue.startsWith('[') && cleanValue.endsWith(']')) {
      const innerContent = cleanValue.slice(1, -1);
      return parseCollectionContent(innerContent);
    }
    
    // Handle single object patterns like ObjectType:[...]
    const singleObjectMatch = cleanValue.match(/^(\w+):\[(.+)\]$/);
    if (singleObjectMatch) {
      const [, objectType, content] = singleObjectMatch;
      const parsed = parseKeyValuePairs(content);
      return { _apexType: objectType, ...parsed };
    }
    
    // Handle objects in braces
    if (cleanValue.startsWith('{') && cleanValue.endsWith('}')) {
      return parseKeyValuePairs(cleanValue.slice(1, -1));
    }
    
    // Clean up datetime strings with extra spaces (00: 00: 00 -> 00:00:00)
    cleanValue = cleanValue.replace(/(\d{2}):\s+(\d{2}):\s+(\d{2})/g, '$1:$2:$3');
    
    // Return as string for simple values
    return cleanValue;
  } catch (error) {
    return value;
  }
}

function parseCollectionContent(content) {
  try {
    const items = [];
    
    // Use improved parsing that identifies key=value patterns instead of splitting on commas
    const itemPairs = extractCollectionItems(content);
    
    for (const item of itemPairs) {
      const parsed = parseCollectionItem(item);
      items.push(parsed);
    }
    
    return items.length === 1 ? items[0] : items;
  } catch (error) {
    return content;
  }
}

// Function to extract collection items based on pattern matching
function extractCollectionItems(content) {
  const items = [];
  
  // Find all key=value and object:value positions in the content
  const itemPositions = [];
  const itemPattern = /\b(\w+)\s*[:=]/g;
  let match;
  
  while ((match = itemPattern.exec(content)) !== null) {
    itemPositions.push({
      keyStart: match.index,
      keyEnd: match.index + match[1].length,
      separatorPos: itemPattern.lastIndex - 1,
      key: match[1],
      separator: match[0].includes('=') ? '=' : ':'
    });
  }
  
  if (itemPositions.length === 0) {
    return [content.trim()];
  }
  
  // Extract items based on positions
  for (let i = 0; i < itemPositions.length; i++) {
    const currentPos = itemPositions[i];
    const nextPos = itemPositions[i + 1];
    
    let valueStart = currentPos.separatorPos + 1;
    let valueEnd = nextPos ? nextPos.keyStart : content.length;
    
    // If there's a next item, find the proper boundary by looking backwards from the next item
    if (nextPos) {
      // Look backwards from the next item to find where this value should end
      let searchPos = nextPos.keyStart - 1;
      let depth = 0;
      let inString = false;
      let escapeNext = false;
      
      // Find the last comma before the next item that's at depth 0
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
    
    // Extract and clean the item
    const key = currentPos.key;
    const value = content.substring(valueStart, valueEnd).trim();
    
    // Remove trailing comma if present
    const cleanValue = value.replace(/,\s*$/, '');
    
    items.push(`${key}${currentPos.separator}${cleanValue}`);
  }
  
  return items;
}

function parseCollectionItem(item) {
  try {
    // Handle object patterns like Bookmark:[key=value, key=value]
    const objectMatch = item.match(/^(\w+):\[(.+)\]$/);
    if (objectMatch) {
      const [, objectType, content] = objectMatch;
      return {
        [objectType]: parseKeyValuePairs(content)
      };
    }
    
    // Handle simple key=value pairs
    const keyValueMatch = item.match(/^(\w+)=(.+)$/);
    if (keyValueMatch) {
      const [, key, value] = keyValueMatch;
      return {
        [key]: parseComplexValue(value)
      };
    }
    
    // Return as-is if no pattern matches
    return item;
  } catch (error) {
    return item;
  }
} 