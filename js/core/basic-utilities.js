// Basic Utilities
// This file contains basic helper functions for HTML manipulation, URL handling, date formatting, and storage

// HTML manipulation utilities
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const textStr = String(text);
  const div = document.createElement('div');
  div.textContent = textStr;
  return div.innerHTML;
}

// URL and host utilities
const getHostFromUrl = () => new URLSearchParams(window.location.search).get('host');

// Salesforce domains: a host is Salesforce when it equals one of these or ends with "." + one of them
const SALESFORCE_HOST_DOMAINS = ['salesforce.com', 'force.com', 'cloudforce.com', 'salesforce-setup.com',
  'salesforce.mil', 'cloudforce.mil', 'sfcrmproducts.cn', 'visualforce.com'];

function isSalesforceHostname(host) {
  if (!host) return false;
  const name = String(host).toLowerCase();
  return SALESFORCE_HOST_DOMAINS.some(domain => name === domain || name.endsWith('.' + domain));
}

// This extension's own pages that carry an org in ?host= (the dashboard). They count as a Salesforce tab
// for finding the session, but are never used for API calls (tab-manager.js only uses isSalesforceUrl tabs).
function isExtensionPageForSalesforceHost(url) {
  try {
    if (!url || !url.startsWith(chrome.runtime.getURL(''))) return false;
    return isSalesforceHostname(new URL(url).searchParams.get('host'));
  } catch (error) {
    return false;
  }
}

const getSalesforceTabs = async () => {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(tab => isSalesforceUrl(tab.url) || isExtensionPageForSalesforceHost(tab.url));
};

const isSalesforceUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && isSalesforceHostname(parsed.hostname);
  } catch (error) {
    return false;
  }
};

// My Domain hosts of one org differ only in their suffix: acme.my.salesforce.com, acme.lightning.force.com,
// acme.my.salesforce-setup.com and acme--c.vf.force.com (sandbox: acme--uat.sandbox.lightning.force.com,
// acme--uat--c.sandbox.vf.force.com). Returns that common part ("acme", "acme--uat.sandbox"), or null.
function getMyDomainOrgKey(host) {
  const name = String(host || '').toLowerCase();
  for (const suffix of ['.my.salesforce.com', '.lightning.force.com', '.my.salesforce-setup.com']) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  if (name.endsWith('.vf.force.com')) {
    // The first label ends with "--<package>" (usually "--c"): acme--c -> acme
    const prefix = name.slice(0, -'.vf.force.com'.length);
    const dot = prefix.indexOf('.');
    const firstLabel = dot === -1 ? prefix : prefix.slice(0, dot);
    const cut = firstLabel.lastIndexOf('--');
    return cut > 0 ? firstLabel.slice(0, cut) + prefix.slice(firstLabel.length) : null;
  }
  return null;
}

// True when host belongs to the same org as targetHost
function isSameOrgHost(host, targetHost) {
  if (!host || !targetHost) return false;
  if (host.toLowerCase() === targetHost.toLowerCase()) return true;
  const key = getMyDomainOrgKey(host);
  return key !== null && key === getMyDomainOrgKey(targetHost);
}

// Switches to the Salesforce tab saved for this org when the dashboard was opened (lastSfUrl_<host>),
// else to any open tab of the org, else opens the org in a new tab
async function focusSalesforceTab(host) {
  const storageKey = `lastSfUrl_${host}`;
  const { [storageKey]: lastUrl } = await chrome.storage.local.get(storageKey);
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find(t => lastUrl && t.url === lastUrl)
    || tabs.find(t => t.url && isSalesforceUrl(t.url) && isSameOrgHost(new URL(t.url).hostname, host));

  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: lastUrl || `https://${host}` });
  }
}

// Date and time formatting
function formatDateTimeWithHighlight(dateTimeString) {
  try {
    const date = new Date(dateTimeString);
    if (isNaN(date)) return escapeHtml(dateTimeString || 'Unknown');
    const isToday = date.toDateString() === new Date().toDateString();
    const dateStr = isToday ? '' : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} `;
    const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    return `${dateStr}<span class="time-highlight">${timeStr}</span>`;
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

/**
 * Formats duration in minutes to a human-readable string (e.g., "1 hour 30 minutes", "45 minutes")
 * @param {number} totalMinutes Minutes to format
 * @returns {string} Formatted duration string
 */
function formatDuration(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined || totalMinutes <= 0) return '0min';

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = Math.round(totalMinutes % 60);

  let result = [];
  if (days > 0) result.push(`${days}d`);
  if (hours > 0) result.push(`${hours}hr`);
  if (minutes > 0) result.push(`${minutes}min`);

  return result.length === 0 ? '0min' : result.join(' ');
}

/**
 * Formats duration in minutes to a short human-readable string (e.g., "1h 30m", "45m")
 * @param {number} totalMinutes Minutes to format
 * @returns {string} Formatted duration string
 */
function formatDurationShort(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined || totalMinutes <= 0) return '0min';

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = Math.round(totalMinutes % 60);

  let result = [];
  if (days > 0) result.push(`${days}d`);
  if (hours > 0) result.push(`${hours}hr`);
  if (minutes > 0) result.push(`${minutes}min`);

  // For very short display, we might only want the first two units or just non-zero ones
  return result.length === 0 ? '0min' : result.join(' ');
}

// Log retention: Salesforce keeps Monitoring logs for 7 days and System logs for 24 hours
const MONITORING_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SYSTEM_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;
// Read/cleared markers are kept as long as the longest-lived log can exist (+1 hour buffer)
const LOG_MARKER_RETENTION_MS = MONITORING_LOG_RETENTION_MS + 60 * 60 * 1000;

function getLogRetentionMs(log) {
  return log && log.Location === 'Monitoring' ? MONITORING_LOG_RETENTION_MS : SYSTEM_LOG_RETENTION_MS;
}

// Read/cleared markers are stored per org as [{ logId, <timeField> }]. Each entry keeps the time
// the log was first marked, so it expires once the log itself is gone.
function loadLogMarkers(storageKey, timeField) {
  const markers = new Map();
  const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
  stored.forEach(entry => {
    if (typeof entry === 'string') {
      markers.set(entry, Date.now()); // Old format had no time
    } else if (entry && entry.logId) {
      markers.set(entry.logId, Number(entry[timeField]) || Date.now());
    }
  });
  return markers;
}

function isStorageQuotaError(error) {
  return !!error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.code === 22 || error.code === 1014);
}

// Saves markers without the expired ones. When storage is full, the oldest half is dropped and the save is tried once more.
function saveLogMarkers(storageKey, markers, timeField) {
  const expiredBefore = Date.now() - LOG_MARKER_RETENTION_MS;
  markers.forEach((time, logId) => {
    if (time < expiredBefore) markers.delete(logId);
  });
  const toJson = () => JSON.stringify(Array.from(markers, ([logId, time]) => ({ logId, [timeField]: time })));

  try {
    localStorage.setItem(storageKey, toJson());
  } catch (error) {
    if (!isStorageQuotaError(error)) return;
    const oldestFirst = Array.from(markers.entries()).sort((a, b) => a[1] - b[1]);
    oldestFirst.slice(0, Math.ceil(oldestFirst.length / 2)).forEach(([logId]) => markers.delete(logId));
    try {
      localStorage.setItem(storageKey, toJson());
    } catch (retryError) {
      // Still full: the markers stay in memory for this session
    }
  }
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
    readLogs = loadLogMarkers(storageKey, 'readAt');
  } catch (error) {
    readLogs = new Map();
  }
}

function saveReadLogsToStorage() {
  const storageKey = getReadLogsStorageKey();
  if (!storageKey) return;
  saveLogMarkers(storageKey, readLogs, 'readAt');
}

/**
 * Formats date and time in a human-friendly way (e.g., "27 Dec 2025, 7:26 PM")
 * @param {Date|string|number} date Date to format
 * @returns {string} Formatted string
 */
function formatDateTimeNice(date) {
  if (!date) return '';
  const d = new Date(date);
  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${dateStr} ${timeStr}`;
}

/**
 * Formats date in a human-friendly way (e.g., "27 Dec 2025")
 * @param {Date|string|number} date Date to format
 * @returns {string} Formatted string
 */
function formatDateNice(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function markLogAsRead(logId) {
  if (!logId || readLogs.has(logId)) return;
  readLogs.set(logId, Date.now());
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
    clearedLogs = loadLogMarkers(storageKey, 'clearedAt');
  } catch (error) {
    clearedLogs = new Map();
  }
}

function saveClearedLogsToStorage() {
  const storageKey = getClearedLogsStorageKey();
  if (!storageKey) return;
  saveLogMarkers(storageKey, clearedLogs, 'clearedAt');
}

function markLogAsCleared(logId) {
  if (!logId || clearedLogs.has(logId)) return;
  clearedLogs.set(logId, Date.now());
  saveClearedLogsToStorage();
}

function isLogCleared(logId) {
  return clearedLogs.has(logId);
}

// Drops read/cleared markers of logs that Salesforce has deleted by now (saving prunes expired entries)
function cleanupExpiredLogs() {
  saveClearedLogsToStorage();
  saveReadLogsToStorage();
}

// Debug log parsing utilities

// A real log event line: "12:00:00.123 (123456)|EVENT|..."
const LOG_EVENT_LINE = /^\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\)\|/;
const USER_DEBUG_LINE = /^\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\)\|USER_DEBUG\|\[[^\]]*\]\|(\w+)\|(.*)$/s;
// Lines Salesforce adds when it cuts a log that is too big
const LOG_TRUNCATION_LINE = /^[ \t]*\*{3}[ \t]*(?:Skipped \d+ bytes of detailed log|MAXIMUM DEBUG LOG SIZE REACHED)/;

// A log smaller than this holds no Apex output: only the header and USER_INFO (about 320 bytes),
// sometimes ENTERING_MANAGED_PKG lines. Any Apex run writes more (its limits summary alone is about 1 KB).
const EMPTY_LOG_MAX_BYTES = 1024;

// Events a log has even when no code of the org ran
const EMPTY_LOG_EVENTS = new Set(['USER_INFO', 'ENTERING_MANAGED_PKG', 'EXECUTION_STARTED', 'EXECUTION_FINISHED']);

// True when a log body has no other event (checked before "empty" logs are deleted)
function isEmptyLogBody(content) {
  return String(content || '').split('\n').every(line => !LOG_EVENT_LINE.test(line) || EMPTY_LOG_EVENTS.has(line.split('|')[1]));
}

function isLogTruncationLine(line) {
  return LOG_TRUNCATION_LINE.test(line);
}

function isTruncatedLog(rawLog) {
  return new RegExp(LOG_TRUNCATION_LINE.source, 'm').test(rawLog || '');
}

// Returns every System.debug message as { level, message } (any logging level: DEBUG, ERROR, INFO, ...).
// A message runs until the next log event line, a truncation marker, or the end of the log.
function extractUserDebugBlocks(rawLog) {
  const msgs = [];
  if (!rawLog || typeof rawLog !== 'string') return msgs;

  let current = null;
  const finish = () => {
    if (current) {
      // Keep the original formatting - don't collapse newlines for JSON structures
      msgs.push({ level: current.level, message: current.lines.join('\n').trim() });
      current = null;
    }
  };

  for (const line of rawLog.split('\n')) {
    if (LOG_EVENT_LINE.test(line)) {
      finish();
      const m = line.match(USER_DEBUG_LINE);
      if (m) current = { level: m[1], lines: [m[2]] };
    } else if (isLogTruncationLine(line)) {
      finish();
    } else if (current) {
      current.lines.push(line);
    }
  }
  finish();
  return msgs;
}

// Extract searchable content from raw log with smart filtering
// Includes every line except noisy log entries
function extractSearchableContent(rawLog) {
  if (!rawLog || typeof rawLog !== 'string') {
    return '';
  }

  // Event types to EXCLUDE from search (noisy, low-value entries)
  const excludePatterns = [
    'HEAP_ALLOCATE',
    'STATEMENT_EXECUTE',
    'VARIABLE_ASSIGNMENT',
    'VARIABLE_SCOPE_BEGIN',
    'VARIABLE_SCOPE_END',
    'CUMULATIVE_LIMIT_USAGE',
    'CUMULATIVE_PROFILING',
    'LIMIT_USAGE_FOR_NS',
    'EXECUTION_STARTED',
    'EXECUTION_FINISHED'
  ];

  const lines = rawLog.split('\n');
  const searchableLines = [];

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Check if line contains a pipe delimiter (Salesforce log format)
    if (!line.includes('|')) {
      // Include non-pipe lines (headers, limits data, etc.)
      searchableLines.push(line);
      continue;
    }

    // Skip noisy lines; every other line (including custom events) is searchable
    if (excludePatterns.some(p => line.includes(`|${p}|`))) continue;

    searchableLines.push(line);
  }

  return searchableLines.join('\n');
}

// True when some "<word character>:<open>" is followed by "=" before the next <close>.
// Same result as /\w+:\{[^}]*=/ (for "{" and "}") in linear time, so long or odd texts cannot freeze the page.
function hasTypedBodyWithEquals(text, open, close) {
  let inBody = false;
  for (let i = 2; i < text.length; i++) {
    const char = text[i];
    if (char === close) inBody = false;
    else if (char === '=' && inBody) return true;
    else if (char === open && text[i - 1] === ':' && /\w/.test(text[i - 2])) inBody = true;
  }
  return false;
}

// True when a quoted list holds "=": "[key=value, ...]" closed by ]", or the multi-line form
// ObjectName:\n"[key=value, ... (closed or not). Same result as /"\[[^\]]*=[^\]]*\]"/ and
// /\w:[^\S\r\n]*[\r\n]\s*"\[[^\]]*=/ in linear time.
function hasQuotedKeyValueList(text) {
  let quoted = false; // a "[ was seen since the last ]
  let multiLine = false; // one of them starts a multi-line object
  let equals = false; // "=" after a "["
  for (let i = 1; i < text.length; i++) {
    const char = text[i];
    if (char === '[' && text[i - 1] === '"') {
      quoted = true;
      multiLine = multiLine || startsMultiLineObject(text, i - 1);
    } else if (char === '=' && quoted) {
      if (multiLine) return true;
      equals = true;
    } else if (char === ']') {
      if (equals && text[i + 1] === '"') return true;
      quoted = multiLine = equals = false;
    }
  }
  return false;
}

// True when the quote at quoteIndex follows "<word character>:" and white space with a line break
function startsMultiLineObject(text, quoteIndex) {
  let i = quoteIndex - 1;
  let lineBreak = false;
  while (i >= 0 && /\s/.test(text[i])) {
    if (text[i] === '\n' || text[i] === '\r') lineBreak = true;
    i--;
  }
  return lineBreak && i >= 1 && text[i] === ':' && /\w/.test(text[i - 1]);
}

// True when "[{" (white space allowed) is followed, before the next "}", by a quoted key and ":".
// Same result as /\[\s*\{[^}]*"[^"]*"\s*:/ in linear time.
function hasJsonArrayOfObjects(text) {
  const nextQuote = new Int32Array(text.length + 1).fill(-1);
  for (let i = text.length - 1; i >= 0; i--) nextQuote[i] = text[i] === '"' ? i : nextQuote[i + 1];
  let inObject = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '}') {
      inObject = false;
    } else if (char === '{' && !inObject) {
      let j = i - 1;
      while (j >= 0 && /\s/.test(text[j])) j--;
      inObject = text[j] === '[';
    } else if (char === '"' && inObject) {
      const close = nextQuote[i + 1];
      if (close === -1) return false;
      let k = close + 1;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] === ':') return true;
    }
  }
  return false;
}

// True when a "name=(" list holds a class: Bookmarks=(Bookmark:[...]).
// Same result as /\w=\([^)]*\w:\[/ in linear time.
function hasClassListValue(text) {
  let inList = false;
  for (let i = 2; i < text.length; i++) {
    const char = text[i];
    if (char === ')') inList = false;
    else if (char === '(' && text[i - 1] === '=' && /\w/.test(text[i - 2])) inList = true;
    else if (char === '[' && inList && text[i - 1] === ':' && /\w/.test(text[i - 2])) return true;
  }
  return false;
}

// Text is the debug message as Salesforce wrote it (log bodies are not HTML-escaped).
// The checks match the same texts as before, written so that long runs of word characters or many
// unclosed brackets cannot make them slow (every check runs in linear time).
function containsSalesforceObjects(text) {
  if (!text) return false;

  // Check for common Salesforce object patterns anywhere in the text
  return (
    // Salesforce object notation: Account:{Id=001..., Name=...}
    // (also covers maps {key1=Object:{...}} and collections (Account:{...}, Contact:{...}))
    hasTypedBodyWithEquals(text, '{', '}') ||
    // Salesforce object notation with square brackets: SFrequest:[key=value, ...]
    hasTypedBodyWithEquals(text, '[', ']') ||
    // System class objects: Database.SaveResult[getErrors=...], System.HttpRequest[Endpoint=...]
    /\b[A-Za-z]\w*(?:\.\w+)+\[\w+=/.test(text) ||
    // Multi-line Salesforce object ObjectName:\n"[key=value, ...]" and quoted arrays "[key=value, ...]"
    hasQuotedKeyValueList(text) ||
    // JSON arrays: [{"key":"value",...}]
    hasJsonArrayOfObjects(text) ||
    // JSON objects: {"key":"value",...}
    /\{\s*"[^"]*"\s*:/.test(text) ||
    // Multi-line JSON starting with { or [
    /^\s*[\{\[][\s\S]*[\}\]]\s*$/.test(text.trim()) ||
    // JSON serialized string: "some text" (starts and ends with quotes, entire content)
    /^"[^"]*"$/.test(text.trim()) ||
    // Complex nested collections: Bookmarks=(Bookmark:[...], Bookmark:[...])
    hasClassListValue(text)
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