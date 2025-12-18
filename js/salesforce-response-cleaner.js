// Salesforce Response Cleaner
// This file contains utilities for cleaning Salesforce API responses

// Default fields to remove from Salesforce responses
const DEFAULT_FIELDS_TO_REMOVE = ['attributes', 'done'];

// Main function to clean Salesforce API responses.
function cleanSalesforceResponse(rawText, fieldsToRemove = DEFAULT_FIELDS_TO_REMOVE) {
  try {
    if (!rawText || typeof rawText !== 'string') {
      return rawText;
    }

    // Extract JSON from the text
    const jsonData = extractJsonFromText(rawText);
    if (!jsonData) {
      return rawText;
    }

    // Clean by removing unwanted metadata fields
    const cleanedData = removeUnwantedFields(jsonData, fieldsToRemove);
    return JSON.stringify(cleanedData, null, 2);
  } catch (error) {
    return rawText;
  }
}

// Removes unwanted metadata fields from a Salesforce API response.
function removeUnwantedFields(data, fieldsToRemove = DEFAULT_FIELDS_TO_REMOVE) {
  if (Array.isArray(data)) {
    return data.map(item => removeUnwantedFields(item, fieldsToRemove));
  } else if (data && typeof data === 'object') {
    const cleaned = {};
    
    for (const [key, value] of Object.entries(data)) {
      // Skip unwanted metadata fields
      if (fieldsToRemove.includes(key)) {
        continue;
      }
      
      // Recursively process nested objects and arrays
      cleaned[key] = removeUnwantedFields(value, fieldsToRemove);
    }
    
    return cleaned;
  }
  
  return data;
}

// Extracts a JSON object from a raw text string.
function extractJsonFromText(text) {
  // First try direct parsing
  try {
    return JSON.parse(text.trim());
  } catch (e) {
    // Continue with pattern matching
  }

  // Find the last valid JSON structure in the text
  const lines = text.split('\n');
  
  // Scan from the end to find the last complete JSON structure
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    
    // Look for potential JSON start markers
    if (line.trim().startsWith('[') || line.trim().startsWith('{')) {
      // Try to parse from this point forward
      const candidateJson = lines.slice(i).join('\n');
      try {
        const parsed = JSON.parse(candidateJson);
        return parsed;
      } catch (e) {
        // Continue searching
      }
    }
  }
  
  // Try regex patterns as fallback
  const jsonPatterns = [
    // Array pattern - last occurrence
    /(\[[\s\S]*\])(?![\s\S]*[\[\{])/,
    // Object pattern - last occurrence
    /(\{[\s\S]*\})(?![\s\S]*[\[\{])/,
    // More specific patterns for Salesforce responses
    /(\[[\s\S]*"attributes"[\s\S]*\])/,
    /(\{[\s\S]*"attributes"[\s\S]*\})/
  ];

  for (const pattern of jsonPatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (e) {
        continue;
      }
    }
  }

  return null;
} 