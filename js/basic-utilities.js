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
      const readLogsArray = JSON.parse(storedReadLogs);
      readLogs = new Set(readLogsArray);
    }
  } catch (error) {
    readLogs = new Set();
  }
}

function saveReadLogsToStorage() {
  const storageKey = getReadLogsStorageKey();
  if (!storageKey) return;
  
  try {
    const readLogsArray = Array.from(readLogs);
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

// Check if current theme is dark
async function isDarkTheme() {
  const theme = await getThemeFromStorage();
  return theme === THEME_DARK;
}

// Get system theme preference (if available)
function getSystemTheme() {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? THEME_DARK : THEME_LIGHT;
  }
  return THEME_LIGHT;
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