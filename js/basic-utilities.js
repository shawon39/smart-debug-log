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
    return `${dateStr} <span style="color: #0176d3;">${timeStr}</span>`;
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