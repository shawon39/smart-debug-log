// Basic Utilities
// This file contains basic helper functions for HTML manipulation, URL handling, date formatting, and storage

// HTML manipulation utilities
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.innerHTML = text;
  return div.textContent || div.innerText || '';
}

// URL and host utilities
const getHostFromUrl = () => new URLSearchParams(window.location.search).get('host');

const getSalesforceTabs = async () => {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(tab => 
    tab.url && (
      tab.url.includes('.salesforce.com') || 
      tab.url.includes('.force.com') ||
      tab.url.includes('.lightning.force.com') ||
      tab.url.includes('--c.visualforce.com') ||
      tab.url.includes('.my.salesforce.com')
    )
  );
};

const isSalesforceUrl = (url) => url && (
  url.includes('.salesforce.com') || 
  url.includes('.force.com') ||
  url.includes('.lightning.force.com') ||
  url.includes('--c.visualforce.com') ||
  url.includes('.my.salesforce.com')
);

const isRealSalesforceUrl = (url) => url && !url.startsWith('chrome-extension://') && isSalesforceUrl(url);

// Date and time formatting
function formatDateTime(dateTimeString) {
  try {
    const date = new Date(dateTimeString);
    return date.toLocaleString();
  } catch (error) {
    return dateTimeString || 'Unknown';
  }
}

function formatDateTimeWithHighlight(dateTimeString) {
  try {
    const date = new Date(dateTimeString);
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString();
    return `${dateStr} <span class="time-highlight">${timeStr}</span>`;
  } catch (error) {
    return dateTimeString || 'Unknown';
  }
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

// Read/Unread status management
function getReadLogsStorageKey() {
  if (!currentSession || !sfHost) return null;
  const orgId = currentSession.organizationId || currentSession.orgId || sfHost;
  return `readLogs_${orgId}`;
}

function loadReadLogsFromStorage() {
  const storageKey = getReadLogsStorageKey();
  if (!storageKey) return;
  
  try {
    const storedReadLogs = localStorage.getItem(storageKey);
    if (storedReadLogs) {
      const readLogsData = JSON.parse(storedReadLogs);
      
      // Handle backward compatibility: old format (array of strings) vs new format (array of objects)
      if (readLogsData.length > 0 && typeof readLogsData[0] === 'string') {
        // Old format - just load the log IDs
        readLogs = new Set(readLogsData);
      } else {
        // New format - extract log IDs from objects
        readLogs = new Set(readLogsData.map(entry => entry.logId));
      }
    }
  } catch (error) {
    readLogs = new Set();
  }
}

function saveReadLogsToStorage() {
  const storageKey = getReadLogsStorageKey();
  if (!storageKey) return;
  
  try {
    // Convert Set to array of objects with timestamps
    const readLogsArray = Array.from(readLogs).map(logId => ({
      logId: logId,
      readAt: Date.now()
    }));
    localStorage.setItem(storageKey, JSON.stringify(readLogsArray));
  } catch (error) {
    // Ignore storage errors
  }
}

function markLogAsRead(logId) {
  if (!logId) return;
  readLogs.add(logId);
  saveReadLogsToStorage();
}

function isLogRead(logId) {
  return readLogs.has(logId);
}

// Cleared logs storage functions
function getClearedLogsStorageKey() {
  if (!currentSession || !sfHost) return null;
  const orgId = currentSession.organizationId || currentSession.orgId || sfHost;
  return `clearedLogs_${orgId}`;
}

function loadClearedLogsFromStorage() {
  const storageKey = getClearedLogsStorageKey();
  if (!storageKey) return;
  
  try {
    const storedClearedLogs = localStorage.getItem(storageKey);
    if (storedClearedLogs) {
      const clearedLogsData = JSON.parse(storedClearedLogs);
      
      // Handle backward compatibility: old format (array of strings) vs new format (array of objects)
      if (clearedLogsData.length > 0 && typeof clearedLogsData[0] === 'string') {
        // Old format - just load the log IDs
        clearedLogs = new Set(clearedLogsData);
      } else {
        // New format - extract log IDs from objects
        clearedLogs = new Set(clearedLogsData.map(entry => entry.logId));
      }
    }
  } catch (error) {
    clearedLogs = new Set();
  }
}

function saveClearedLogsToStorage() {
  const storageKey = getClearedLogsStorageKey();
  if (!storageKey) return;
  
  try {
    // Convert Set to array of objects with timestamps
    const clearedLogsArray = Array.from(clearedLogs).map(logId => ({
      logId: logId,
      clearedAt: Date.now()
    }));
    localStorage.setItem(storageKey, JSON.stringify(clearedLogsArray));
  } catch (error) {
    // Ignore storage errors
  }
}

function markLogAsCleared(logId) {
  if (!logId) return;
  clearedLogs.add(logId);
  saveClearedLogsToStorage();
}

function isLogCleared(logId) {
  return clearedLogs.has(logId);
}

// Cleanup functions for expired logs (Salesforce logs expire after 24 hours)
function cleanupExpiredLogs() {
  const EXPIRY_HOURS = 25; // 24h + 1h buffer
  const expiryTime = Date.now() - (EXPIRY_HOURS * 60 * 60 * 1000);
  
  // Cleanup expired cleared logs
  cleanupExpiredClearedLogs(expiryTime);
  
  // Cleanup expired read logs  
  cleanupExpiredReadLogs(expiryTime);
}

function cleanupExpiredClearedLogs(expiryTime) {
  const storageKey = getClearedLogsStorageKey();
  if (!storageKey) return;
  
  try {
    const storedClearedLogs = localStorage.getItem(storageKey);
    if (!storedClearedLogs) return;
    
    const clearedLogsData = JSON.parse(storedClearedLogs);
    
    // Handle both old format (array of strings) and new format (array of objects)
    let filteredLogs;
    if (clearedLogsData.length > 0 && typeof clearedLogsData[0] === 'string') {
      // Old format - can't filter by time, just keep as is for now
      filteredLogs = clearedLogsData;
    } else {
      // New format - filter out expired entries
      filteredLogs = clearedLogsData.filter(entry => entry.clearedAt > expiryTime);
    }
    
    // Update localStorage and memory
    localStorage.setItem(storageKey, JSON.stringify(filteredLogs));
    
    // Rebuild clearedLogs Set from filtered data
    if (filteredLogs.length > 0 && typeof filteredLogs[0] === 'string') {
      clearedLogs = new Set(filteredLogs);
    } else {
      clearedLogs = new Set(filteredLogs.map(entry => entry.logId));
    }
  } catch (error) {
    // If cleanup fails, just continue with existing data
  }
}

function cleanupExpiredReadLogs(expiryTime) {
  const storageKey = getReadLogsStorageKey();
  if (!storageKey) return;
  
  try {
    const storedReadLogs = localStorage.getItem(storageKey);
    if (!storedReadLogs) return;
    
    const readLogsData = JSON.parse(storedReadLogs);
    
    // Handle both old format (array of strings) and new format (array of objects)
    let filteredLogs;
    if (readLogsData.length > 0 && typeof readLogsData[0] === 'string') {
      // Old format - can't filter by time, just keep as is for now
      filteredLogs = readLogsData;
    } else {
      // New format - filter out expired entries
      filteredLogs = readLogsData.filter(entry => entry.readAt > expiryTime);
    }
    
    // Update localStorage and memory
    localStorage.setItem(storageKey, JSON.stringify(filteredLogs));
    
    // Rebuild readLogs Set from filtered data
    if (filteredLogs.length > 0 && typeof filteredLogs[0] === 'string') {
      readLogs = new Set(filteredLogs);
    } else {
      readLogs = new Set(filteredLogs.map(entry => entry.logId));
    }
  } catch (error) {
    // If cleanup fails, just continue with existing data
  }
}

// Debug log parsing utilities
function extractUserDebugBlocks(rawLog) {
  const regex = /^\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\)\|USER_DEBUG\|\[[^\]]+\]\|DEBUG\|(.*?)(?=\r?\n\d{2}:\d{2}:\d{2}\.\d+)/gms;
  const msgs = [];
  let m;
  while ((m = regex.exec(rawLog)) !== null) {
    // Keep the original formatting - don't collapse newlines for JSON structures
    const originalText = m[1].trim();
    msgs.push(originalText);
  }
  return msgs;
}

// Helper function to check if log content contains debug messages
function hasDebugMessages(logContent) {
  if (!logContent) return false;
  const debugMessages = extractUserDebugBlocks(logContent);
  return debugMessages.length > 0;
}

// Helper function to check if log content contains errors
function hasErrors(logContent) {
  if (!logContent) return false;
  const errorData = extractErrorsFromDebugLog(logContent);
  return errorData.hasErrors;
}

// Helper function to check if log content contains fatal errors
function hasFatalErrors(logContent) {
  if (!logContent) return false;
  const errorData = extractErrorsFromDebugLog(logContent);
  return errorData.hasFatalErrors;
}

// Helper function to check if log content contains exceptions
function hasExceptions(logContent) {
  if (!logContent) return false;
  const errorData = extractErrorsFromDebugLog(logContent);
  return errorData.hasExceptions;
}

function containsSalesforceObjects(text) {
  if (!text) return false;
  
  // Decode HTML entities first for better pattern matching
  const decodedText = decodeHtmlEntities(text);
  
  // Check for common Salesforce object patterns anywhere in the text
  return (
    // Raw map content with Salesforce objects: {key1=Object:{...}, key2=Object:{...}}
    /\{[^}]*=\w+:\{[^}]*=/.test(decodedText) ||
    // Salesforce object notation: Account:{Id=001..., Name=...}
    /\w+:\{[^}]*=/.test(decodedText) ||
    // Salesforce object notation with square brackets: SFrequest:[key=value, ...]
    /\w+:\[[^\]]*=/.test(decodedText) ||
    // Multi-line Salesforce object: ObjectName:\n"[key=value, ...]"
    /\w+:\s*[\r\n]+\s*"\[[^\]]*=/.test(decodedText) ||
    // JSON arrays: [{"key":"value",...}]
    /\[\s*\{[^}]*"[^"]*"\s*:/.test(decodedText) ||
    // JSON objects: {"key":"value",...}
    /\{\s*"[^"]*"\s*:/.test(decodedText) ||
    // Multi-line JSON starting with { or [
    /^\s*[\{\[][\s\S]*[\}\]]\s*$/.test(decodedText.trim()) ||
    // JSON serialized string: "some text" (starts and ends with quotes, entire content)
    /^"[^"]*"$/.test(decodedText.trim()) ||
    // Salesforce collections in parentheses: (Account:{...}, Contact:{...})
    /\([^)]*\w+:\{[^}]*=/.test(decodedText) ||
    // Complex nested collections: Bookmarks=(Bookmark:[...], Bookmark:[...])
    /\w+=\([^)]*\w+:\[/.test(decodedText) ||
    // Quoted arrays with key=value: "[key=value, key=value]"
    /"\[[^\]]*=[^\]]*\]"/.test(decodedText)
  );
} 

// Theme management utilities
const THEME_STORAGE_KEY = 'smart-debug-log-theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';

// Get current theme from storage
async function getThemeFromStorage() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get([THEME_STORAGE_KEY]);
      return result[THEME_STORAGE_KEY] || THEME_LIGHT;
    } else {
      // Fallback to localStorage for testing
      return localStorage.getItem(THEME_STORAGE_KEY) || THEME_LIGHT;
    }
  } catch (error) {
    console.warn('Failed to get theme from storage, using default light theme:', error);
    return THEME_LIGHT;
  }
}

// Save theme to storage
async function saveThemeToStorage(theme) {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
    } else {
      // Fallback to localStorage for testing
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch (error) {
    console.warn('Failed to save theme to storage:', error);
  }
}

// Apply theme to document
function applyTheme(theme) {
  const html = document.documentElement;
  
  if (theme === THEME_DARK) {
    html.setAttribute('data-theme', 'dark');
  } else {
    html.removeAttribute('data-theme');
  }
}

// Initialize theme on page load
async function initializeTheme() {
  const savedTheme = await getThemeFromStorage();
  applyTheme(savedTheme);
  return savedTheme;
}

// Toggle theme and save preference
async function toggleTheme() {
  const currentTheme = await getThemeFromStorage();
  const newTheme = currentTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
  
  applyTheme(newTheme);
  await saveThemeToStorage(newTheme);
  
  return newTheme;
}

// Set specific theme
async function setTheme(theme) {
  if (theme !== THEME_LIGHT && theme !== THEME_DARK) {
    console.warn('Invalid theme:', theme, 'Using light theme as fallback');
    theme = THEME_LIGHT;
  }
  
  applyTheme(theme);
  await saveThemeToStorage(theme);
  
  return theme;
}

// Setup theme toggle listener for a checkbox element
function setupThemeToggle(toggleElement) {
  if (!toggleElement) {
    console.warn('Theme toggle element not found');
    return;
  }
  
  // Initialize toggle state
  initializeTheme().then(theme => {
    toggleElement.checked = theme === THEME_DARK;
  });
  
  // Add event listener
  toggleElement.addEventListener('change', async () => {
    const newTheme = toggleElement.checked ? THEME_DARK : THEME_LIGHT;
    await setTheme(newTheme);
    
    // Sync other theme toggles on the same page
    syncThemeToggles(newTheme, toggleElement);
  });
}

// View preference management utilities
const VIEW_PREFERENCE_STORAGE_KEY = 'debug-view-preference';
const VIEW_DEBUG_MESSAGES = 'debug_messages';
const VIEW_RAW_RESPONSE = 'raw_response';

// Get current view preference from storage
async function getViewPreferenceFromStorage() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get([VIEW_PREFERENCE_STORAGE_KEY]);
      return result[VIEW_PREFERENCE_STORAGE_KEY] || VIEW_DEBUG_MESSAGES;
    } else {
      // Fallback to localStorage for testing
      return localStorage.getItem(VIEW_PREFERENCE_STORAGE_KEY) || VIEW_DEBUG_MESSAGES;
    }
  } catch (error) {
    console.warn('Failed to get view preference from storage, using default debug messages view:', error);
    return VIEW_DEBUG_MESSAGES;
  }
}

// Save view preference to storage
async function saveViewPreferenceToStorage(viewPreference) {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [VIEW_PREFERENCE_STORAGE_KEY]: viewPreference });
    } else {
      // Fallback to localStorage for testing
      localStorage.setItem(VIEW_PREFERENCE_STORAGE_KEY, viewPreference);
    }
  } catch (error) {
    console.warn('Failed to save view preference to storage:', error);
  }
}

// Sync theme toggles across multiple elements
function syncThemeToggles(theme, excludeElement) {
  const themeToggles = document.querySelectorAll('input[type="checkbox"][id*="theme"], input[type="checkbox"][id*="Theme"]');
  const isDark = theme === THEME_DARK;
  
  themeToggles.forEach(toggle => {
    if (toggle !== excludeElement) {
      toggle.checked = isDark;
    }
  });
} 