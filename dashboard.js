let monitoringInterval = null;
let isMonitoring = false;
let currentSession = null;
let sfHost = null;
let debugLogs = [];
let selectedLogId = null;
let readLogs = new Set();

// Cache DOM elements
const elements = {
  connectionStatusText: document.getElementById('connectionStatusText'),
  monitoringStatusDot: document.getElementById('monitoringStatusDot'),
  monitoringStatusText: document.getElementById('monitoringStatusText'),
  orgActions: document.getElementById('orgActions'),
  copySessionBtn: document.getElementById('copySessionBtn'),
  openIncognitoBtn: document.getElementById('openIncognitoBtn'),
  devConsoleWarning: document.getElementById('devConsoleWarning'),
  openDevConsoleBtn: document.getElementById('openDevConsoleBtn'),
  dismissWarningBtn: document.getElementById('dismissWarningBtn'),
  pollInterval: document.getElementById('pollInterval'),
  logLimit: document.getElementById('logLimit'),
  startMonitoringBtn: document.getElementById('startMonitoringBtn'),
  stopMonitoringBtn: document.getElementById('stopMonitoringBtn'),
  refreshLogsBtn: document.getElementById('refreshLogsBtn'),
  monitoringStats: document.getElementById('monitoringStats'),
  totalLogsCount: document.getElementById('totalLogsCount'),
  lastPollTime: document.getElementById('lastPollTime'),
  pollIntervalStat: document.getElementById('pollIntervalStat'),
  logsLoading: document.getElementById('logsLoading'),
  emptyState: document.getElementById('emptyState'),
  logsList: document.getElementById('logsList'),
  welcomeState: document.getElementById('welcomeState'),
  limitsWelcomeState: document.getElementById('limitsWelcomeState'),
  debugContentPanel: document.getElementById('debugContentPanel'),
  selectedLogIdElement: document.getElementById('selectedLogId'),
  debugContent: document.getElementById('debugContent'),
  limitsContent: document.getElementById('limitsContent')
};

const getHostFromUrl = () => new URLSearchParams(window.location.search).get('host');

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

document.addEventListener('DOMContentLoaded', async () => {
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const targetHost = getHostFromUrl();
  const headerHost = document.getElementById('headerHost');
  if (headerHost && targetHost) {
    headerHost.textContent = `(${targetHost})`;
  }
  
  await checkConnectionStatus(targetHost);
  await loadDebugLogs();
  setupEventListeners();
  updatePollIntervalStat();
});

const refreshDashboard = async () => {
  const targetHost = getHostFromUrl();
  await checkConnectionStatus(targetHost);
  if (currentSession && sfHost) {
    await loadDebugLogs();
  }
  setTimeout(checkDeveloperConsoleStatus, 300);
};

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) setTimeout(refreshDashboard, 100);
});

window.addEventListener('focus', () => {
  setTimeout(refreshDashboard, 100);
});

function setupEventListeners() {
  const { startMonitoringBtn, stopMonitoringBtn, refreshLogsBtn, copySessionBtn, 
          openIncognitoBtn, openDevConsoleBtn, dismissWarningBtn, pollInterval, logLimit } = elements;
  
  startMonitoringBtn?.addEventListener('click', startMonitoring);
  stopMonitoringBtn?.addEventListener('click', stopMonitoring);
  refreshLogsBtn?.addEventListener('click', refreshDashboard);
  
  document.getElementById('closeDashboardBtn')?.addEventListener('click', () => window.close());
  
  copySessionBtn?.addEventListener('click', copySessionUrl);
  openIncognitoBtn?.addEventListener('click', openInIncognito);
  openDevConsoleBtn?.addEventListener('click', openDeveloperConsole);
  dismissWarningBtn?.addEventListener('click', dismissDevConsoleWarning);
  
  pollInterval?.addEventListener('change', () => {
    updatePollIntervalStat();
    if (isMonitoring) restartMonitoring();
  });
  
  logLimit?.addEventListener('change', loadDebugLogs);
}

function updatePollIntervalStat() {
  const { pollInterval, pollIntervalStat } = elements;
  if (!pollInterval || !pollIntervalStat) return;
  const interval = parseInt(pollInterval.value);
  pollIntervalStat.textContent = interval >= 60 ? `${interval/60}m` : `${interval}s`;
}

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

async function checkConnectionStatus(targetHost = null) {
  try {
    const salesforceTabs = await getSalesforceTabs();

    if (salesforceTabs.length === 0) {
      updateConnectionStatus(false, 'No Salesforce tabs found');
      return;
    }

    // If we have a target host, prioritize tabs from that host
    if (targetHost) {
      // Find tabs that match the target host
      const targetHostTabs = salesforceTabs.filter(tab => {
        const tabUrl = new URL(tab.url);
        return tabUrl.hostname === targetHost || tab.url.includes(targetHost);
      });
      
      // Try tabs matching the target host first
      for (const tab of targetHostTabs) {
        const sessionData = await tryGetSessionForTab(tab);
        if (sessionData && (sessionData.sfHost === targetHost || sessionData.session.hostname === targetHost)) {
          sfHost = sessionData.sfHost;
          currentSession = sessionData.session;
          loadReadLogsFromStorage(); // Load read logs for this org
          updateConnectionStatus(true, `Connected to ${targetHost}`, sessionData.session);
          return;
        }
      }
      
      // If no valid session found for target host, show helpful error
      updateConnectionStatus(false, `No valid session found for ${targetHost}`);
      return;
    }

    // If no target host specified, use the original logic
    // First, check if the currently active/focused tab is a Salesforce tab
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];
    
    if (activeTab && activeTab.url && isSalesforceUrl(activeTab.url)) {
      const sessionData = await tryGetSessionForTab(activeTab);
      if (sessionData) {
        sfHost = sessionData.sfHost;
        currentSession = sessionData.session;
        loadReadLogsFromStorage();
        updateConnectionStatus(true, 'Connected', sessionData.session);
        return;
      }
    }

    // If active tab isn't Salesforce or doesn't have a session, 
    // check the most recently accessed Salesforce tab
    const sortedSalesforceTabs = salesforceTabs.sort((a, b) => {
      // Sort by lastAccessed (most recent first), with fallback to id for tabs without lastAccessed
      const aTime = a.lastAccessed || 0;
      const bTime = b.lastAccessed || 0;
      return bTime - aTime;
    });

    // Try each Salesforce tab starting with most recently accessed
    for (const tab of sortedSalesforceTabs) {
      const sessionData = await tryGetSessionForTab(tab);
      if (sessionData) {
        sfHost = sessionData.sfHost;
        currentSession = sessionData.session;
        loadReadLogsFromStorage(); // Load read logs for this org
        updateConnectionStatus(true, 'Connected', sessionData.session);
        return;
      }
    }

    updateConnectionStatus(false, 'No valid session found');
  } catch (error) {
    updateConnectionStatus(false, 'Connection check failed');
  }
}



// Helper function to try getting session for a specific tab
async function tryGetSessionForTab(tab) {
  try {
    const hostResponse = await chrome.runtime.sendMessage({
      type: 'GET_SALESFORCE_HOST',
      url: tab.url,
      tabId: tab.id
    });

    if (hostResponse.success && hostResponse.data.salesforceHost) {
      const sessionResponse = await chrome.runtime.sendMessage({
        type: 'GET_SESSION',
        sfHost: hostResponse.data.salesforceHost,
        tabId: tab.id
      });

      if (sessionResponse.success && sessionResponse.data) {
        const session = sessionResponse.data;
        // Add orgName if not present
        if (!session.orgName && session.hostname) {
          session.orgName = session.hostname;
        }
        
        return {
          sfHost: hostResponse.data.salesforceHost,
          session: session
        };
      }
    }
  } catch (error) {
    // Continue to return null on error
  }
  return null;
}

function updateConnectionStatus(connected, statusText = '', session = null) {
  const { connectionStatusText, orgActions } = elements;
  if (!connectionStatusText) return;
  
  if (connected && session) {
    const displayName = session.orgName || session.hostname || sfHost;
    const orgId = session.organizationId || session.orgId || '';
    connectionStatusText.textContent = `Connected ${displayName}${orgId ? ' (' + orgId + ')' : ''}`;
    
    if (orgActions) {
      orgActions.classList.remove('hidden');
      orgActions.style.display = 'flex';
    }
    
    const targetHost = getHostFromUrl();
    if (targetHost) {
      document.title = `Salesforce Debug Log Beautifier - ${targetHost}`;
    }
    
    const controlsBar = document.querySelector('.controls-bar');
    const existingHelpPanel = controlsBar?.querySelector('.session-help-panel');
    existingHelpPanel?.remove();
    
    setTimeout(checkDeveloperConsoleStatus, 500);
  } else {
    connectionStatusText.textContent = statusText;
    
    if (orgActions) {
      orgActions.classList.add('hidden');
      orgActions.style.display = 'none';
    }
  }
}

function updateMonitoringStatus(monitoring, statusText = '') {
  const { monitoringStatusDot, monitoringStatusText, startMonitoringBtn, stopMonitoringBtn, monitoringStats } = elements;
  if (!monitoringStatusDot || !monitoringStatusText) return;
  
  isMonitoring = monitoring;
  
  if (monitoring) {
    monitoringStatusDot.classList.add('monitoring');
    monitoringStatusText.textContent = statusText || 'Active';
    
    startMonitoringBtn?.classList.add('hidden');
    stopMonitoringBtn?.classList.remove('hidden');
    monitoringStats?.classList.remove('hidden');
  } else {
    monitoringStatusDot.classList.remove('monitoring');
    monitoringStatusText.textContent = statusText || 'Stopped';
    
    startMonitoringBtn?.classList.remove('hidden');
    stopMonitoringBtn?.classList.add('hidden');
    monitoringStats?.classList.add('hidden');
  }
}

async function loadDebugLogs() {
  if (!currentSession || !sfHost) {
    const targetHost = getHostFromUrl();
    await checkConnectionStatus(targetHost);
    if (!currentSession) {
      showEmptyState();
      return;
    }
  }

  showLoading();

  try {
    try {
      await chrome.runtime.sendMessage({
        type: 'ENSURE_DEBUG_INFRASTRUCTURE',
        session: currentSession,
        sfHost: sfHost
      });
    } catch (error) {
      // Continue anyway
    }

    const salesforceTabs = await getSalesforceTabs();

    const targetHost = getHostFromUrl();
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];
    
    const realSalesforceTabs = salesforceTabs.filter(tab => isRealSalesforceUrl(tab.url));
    const extensionTabs = salesforceTabs.filter(tab => !isRealSalesforceUrl(tab.url));
    
    const orderedTabs = [];
    
    if (targetHost) {
      const targetHostTabs = realSalesforceTabs.filter(tab => {
        const tabUrl = new URL(tab.url);
        return tabUrl.hostname === targetHost || tab.url.includes(targetHost);
      });
      orderedTabs.push(...targetHostTabs);
    }
    
    if (activeTab && isRealSalesforceUrl(activeTab.url) && !orderedTabs.find(tab => tab.id === activeTab.id)) {
      orderedTabs.push(activeTab);
    }
    
    const otherRealTabs = realSalesforceTabs
      .filter(tab => !orderedTabs.find(existingTab => existingTab.id === tab.id))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    
    orderedTabs.push(...otherRealTabs);
    
    const otherExtensionTabs = extensionTabs
      .filter(tab => !orderedTabs.find(existingTab => existingTab.id === tab.id))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    
    orderedTabs.push(...otherExtensionTabs);

    let logsFound = false;
    
    for (const tab of orderedTabs) {
      try {
        let isScriptLoaded = false;
        try {
          const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'PING' });
          isScriptLoaded = pingResponse && pingResponse.success;
        } catch (e) {
          isScriptLoaded = false;
        }
        
        if (!isScriptLoaded) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content/salesforce-api.js']
            });
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (injectionError) {
            continue;
          }
        }
        
        let finalPingResponse;
        try {
          finalPingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'PING' });
        } catch (pingError) {
          continue;
        }
        
        if (!finalPingResponse || !finalPingResponse.success) {
          continue;
        }

        let instanceUrl;
        if (tab.url) {
          const url = new URL(tab.url);
          instanceUrl = `${url.protocol}//${url.hostname}`;
        } else {
          instanceUrl = `https://${sfHost}`;
        }
        
        const sessionData = {
          sessionId: currentSession.key || currentSession.sessionId,
          instanceUrl: instanceUrl
        };
        
        const query = `SELECT Id, LogUserId, StartTime, LogLength, Application, Operation, DurationMilliseconds 
                       FROM ApexLog 
                       ORDER BY StartTime DESC 
                       LIMIT ${parseInt(elements.logLimit.value)}`;

        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'TOOLING_QUERY',
          query: query,
          session: sessionData
        });

        if (response && response.success && response.data) {
          debugLogs = response.data.records || [];
          displayDebugLogs();
          updateStats();
          logsFound = true;
          break;
        }
      } catch (error) {
        continue;
      }
    }

    if (!logsFound) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_RECENT_LOGS',
          orgId: currentSession.orgId,
          limit: parseInt(elements.logLimit.value)
        });

        if (response.success && response.data && response.data.length > 0) {
          debugLogs = response.data;
          displayDebugLogs();
          updateStats();
          logsFound = true;
        }
      } catch (error) {
        // Failed
      }
      
      if (!logsFound) {
        try {
          const query = `SELECT Id, LogUserId, StartTime, LogLength, Application, Operation, DurationMilliseconds 
                         FROM ApexLog 
                         ORDER BY StartTime DESC 
                         LIMIT ${parseInt(elements.logLimit.value)}`;
          
          const response = await chrome.runtime.sendMessage({
            type: 'EXECUTE_TOOLING_QUERY',
            query: query,
            session: currentSession
          });

          if (response.success && response.data && response.data.records) {
            debugLogs = response.data.records;
            displayDebugLogs();
            updateStats();
            logsFound = true;
          }
        } catch (error) {
          // Failed
        }
      }
      
      if (!logsFound) {
        showEmptyState();
      }
    }
      } catch (error) {
      showEmptyState();
    }
}

function showLoading() {
  const { logsLoading, emptyState, logsList } = elements;
  logsLoading.classList.remove('hidden');
  emptyState.classList.add('hidden');
  logsList.innerHTML = '';
}

function showEmptyState() {
  const { logsLoading, emptyState, logsList } = elements;
  logsLoading.classList.add('hidden');
  emptyState.classList.remove('hidden');
  logsList.innerHTML = '';
}

function displayDebugLogs() {
  const { logsLoading, emptyState, logsList } = elements;
  logsLoading.classList.add('hidden');
  emptyState.classList.add('hidden');

  if (!debugLogs || debugLogs.length === 0) {
    showEmptyState();
    return;
  }

  logsList.innerHTML = debugLogs.map(log => {
    const logTime = new Date(log.StartTime);
    const now = new Date();
    const hoursSinceLog = (now - logTime) / (1000 * 60 * 60);
    const isLikelyExpired = hoursSinceLog > 24;
    
    const expiredClass = isLikelyExpired ? 'log-item-expired' : '';
    const expiredIndicator = isLikelyExpired ? '<span class="expired-indicator" title="This log may have expired (older than 24 hours)">⚠️</span>' : '';
    
    // Check if this log is unread
    const isUnread = !isLogRead(log.Id);
    const unreadIndicator = isUnread ? '<span class="unread-indicator" title="Unread log"></span>' : '';
    
    return `
    <div class="log-item ${selectedLogId === log.Id ? 'selected' : ''} ${expiredClass}" data-log-id="${log.Id}">
      <div class="log-header">
        <div class="log-id">${log.Id}${unreadIndicator}</div>
        <div class="log-time">
          ${expiredIndicator}
          ${formatDateTimeWithHighlight(log.StartTime)}
        </div>
      </div>
      <div class="log-details">
        <span class="log-operation">${log.Operation || 'Unknown'}</span>
        <span class="log-duration">${log.DurationMilliseconds || 0}ms</span>
        <span class="log-size">${formatFileSize(log.LogLength || 0)}</span>
      </div>
    </div>
  `;
  }).join('');

  document.querySelectorAll('.log-item').forEach(item => {
    item.addEventListener('click', () => {
      const logId = item.getAttribute('data-log-id');
      selectDebugLog(logId);
    });
  });
}

function selectDebugLog(logId) {
  // Mark log as read
  markLogAsRead(logId);
  
  // Remove unread indicator from this log
  const logElement = document.querySelector(`[data-log-id="${logId}"]`);
  if (logElement) {
    const unreadIndicator = logElement.querySelector('.unread-indicator');
    if (unreadIndicator) {
      unreadIndicator.remove();
    }
  }
  
  // Update selected state
  selectedLogId = logId;
  
  // Update visual selection
  document.querySelectorAll('.log-item').forEach(item => {
    item.classList.remove('selected');
  });
  logElement?.classList.add('selected');
  
  // Show log details
  showLogDetails(logId);
}

async function showLogDetails(logId) {
  const log = debugLogs.find(l => l.Id === logId);
  if (!log) return;

  const { selectedLogIdElement, welcomeState, limitsWelcomeState, debugContentPanel, debugContent, limitsContent } = elements;
  
  if (selectedLogIdElement) {
    selectedLogIdElement.textContent = `Log ID: ${logId}`;
  }

  welcomeState.classList.add('hidden');
  limitsWelcomeState.classList.add('hidden');
  debugContentPanel.classList.remove('hidden');
  
  debugContent.innerHTML = '<div style="text-align: center; padding: 20px; color: #6c757d;">Loading debug messages...</div>';
  limitsContent.innerHTML = '<div style="text-align: center; padding: 20px; color: #6c757d;">Loading governor limits...</div>';

  try {
    // Get log content
    const targetHost = getHostFromUrl();
    const response = await chrome.runtime.sendMessage({
      type: 'GET_LOG_CONTENT',
      logId: logId,
      orgId: currentSession.orgId,
      targetHost: targetHost
    });

    if (response.success && response.data) {
      const parsedContent = parseDebugLogContent(response.data.content || response.data);
      
      // Display debug messages
      if (parsedContent.debugMessages && parsedContent.debugMessages.length > 0) {
        // Create individual blocks for each debug message
        const messageBlocks = parsedContent.debugMessages.map((message, index) => {
          let formattedMessage = message;
          
          // Decode HTML entities first
          formattedMessage = decodeHtmlEntities(formattedMessage);
          
          // Check if this looks like Salesforce object notation and try to format it
          if (containsSalesforceObjects(formattedMessage)) {
            try {
              // Extract and parse the Salesforce object part
              const result = extractAndParseSalesforceObjects(formattedMessage);
              formattedMessage = result;
            } catch (e) {
              // If parsing fails, just decode HTML entities and escape
              formattedMessage = escapeHtml(formattedMessage);
            }
          } else {
            // For simple text messages, decode HTML entities and escape
            formattedMessage = escapeHtml(formattedMessage);
          }
          
          return `<div class="debug-message-block" data-message-index="${index}"><pre style="margin: 0; white-space: pre-wrap; font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Fira Code', 'Consolas', 'Courier New', monospace; font-size: 10px; color: inherit;">${formattedMessage}</pre></div>`;
        }).join('');
        debugContent.innerHTML = messageBlocks;
      } else {
        debugContent.innerHTML = '<div style="color: #6c757d; font-style: italic;">No DEBUG messages found in this log.</div>';
      }
      
      // Display limits with enhanced formatting
      if (parsedContent.limits) {
        const formattedLimits = formatGovernorLimits(parsedContent.limits);
        limitsContent.innerHTML = formattedLimits;
        limitsContent.classList.remove('hidden');
      } else {
        limitsContent.innerHTML = '<div style="color: #6c757d; font-style: italic;">No CUMULATIVE_LIMIT_USAGE information found in this log.</div>';
        limitsContent.classList.remove('hidden');
      }
    } else {
      // Handle specific error cases
      let errorMessage = 'Failed to load debug log content.';
      if (response.error && response.error.includes('not found or expired')) {
        errorMessage = '<div style="color: #dc3545; font-style: italic; padding: 10px; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px;">' +
          '<strong>Debug Log Expired</strong><br>' +
          'This debug log is no longer available. Debug logs in Salesforce automatically expire after 24 hours or may be deleted.<br>' +
          '<small>Try generating a new debug log to view recent execution details.</small>' +
          '</div>';
      } else if (response.message) {
        errorMessage = `<div style="color: #dc3545; font-style: italic;">Error: ${escapeHtml(response.message)}</div>`;
      }
      
      debugContent.innerHTML = errorMessage;
      limitsContent.innerHTML = '<div style="color: #dc3545; font-style: italic;">Unable to load governor limits.</div>';
      limitsContent.classList.remove('hidden');
    }
  } catch (error) {
    debugContent.innerHTML = '<div style="color: #dc3545; font-style: italic;">Error loading debug messages.</div>';
    limitsContent.innerHTML = '<div style="color: #dc3545; font-style: italic;">Error loading governor limits.</div>';
    limitsContent.classList.remove('hidden');
  }
}

// Debug log parsing functions
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

// Parse Salesforce object notation (key=value format) and convert to JSON
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
    
    // Pattern 3: Complex object with square brackets ObjectType:[...] 
    const complexObjectMatch = trimmedText.match(/^(\w+):\[(.+)\]$/);
    if (complexObjectMatch) {
      const [, objectType, content] = complexObjectMatch;
      return {
        [objectType]: parseComplexContent(content)
      };
    }
    
    // Pattern 4: Multiple objects in parentheses (Object:{...}, Object:{...})
    if (trimmedText.startsWith('(') && trimmedText.endsWith(')')) {
      const content = trimmedText.slice(1, -1);
      return parseMultipleObjects(content);
    }
        
    // Pattern 5: Single object Object:{...}
    const objectMatch = trimmedText.match(/^(\w+):\{(.+)\}$/);
    if (objectMatch) {
      const [, objectType, content] = objectMatch;
      return {
        [objectType]: parseKeyValuePairs(content)
      };
    }
    
    // Pattern 6: Raw object content {key=value, key=value}
    if (trimmedText.startsWith('{') && trimmedText.endsWith('}')) {
      return parseKeyValuePairs(trimmedText.slice(1, -1));
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
  // Handle wrapper pattern WrapperType:[...]
  const wrapperMatch = content.match(/^(\w+):\[(.+)\]$/);
  if (wrapperMatch) {
    const [, wrapperType, innerContent] = wrapperMatch;
    return {
      [wrapperType]: parseStructure(`[${innerContent}]`)
    };
  }
  
  // Handle object pattern ObjectType:{...}
  const objectMatch = content.match(/^(\w+):\{(.+)\}$/);
  if (objectMatch) {
    const [, objectType, innerContent] = objectMatch;
    return {
      [objectType]: parseKeyValuePairs(innerContent)
    };
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

// New function to extract key=value pairs based on pattern matching
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
  // Handle null
  if (value === 'null') {
    return null;
  }
  
  // Handle boolean
  if (value === 'true') return true;
  if (value === 'false') return false;
  
  // Handle numbers
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  if (/^\d+\.\d+$/.test(value)) {
    return parseFloat(value);
  }
  
  // Handle nested structures
  if (value.startsWith('(') && value.endsWith(')')) {
    return parseStructure(value);
    }
    
  // Handle objects
  if (value.includes(':{')) {
    return parseSingleObject(value);
  }
  
  // Return as string
  return value;
}

// Simple JSON key highlighting only
function highlightJsonKeys(jsonString) {
  try {
    let highlighted = escapeHtml(jsonString);
    
    // Highlight JSON keys only - property names in quotes followed by colon
    // Pattern 1: Standard &quot; format followed by colon
    highlighted = highlighted.replace(/&quot;([^&"]*?)&quot;(\s*):/g, '<span style="color:#d73a49;font-weight:bold">&quot;$1&quot;</span>$2:');
    // Pattern 2: In case quotes aren't escaped as &quot;
    highlighted = highlighted.replace(/"([^"]*?)"(\s*):/g, '<span style="color:#d73a49;font-weight:bold">"$1"</span>$2:');
    
    // Highlight string values
    highlighted = highlighted.replace(/:\s*&quot;([^&"]*?)&quot;/g, ': <span style="color:#032f62">&quot;$1&quot;</span>');
    highlighted = highlighted.replace(/:\s*"([^"]*?)"/g, ': <span style="color:#032f62">"$1"</span>');
    
    // Highlight numbers
    highlighted = highlighted.replace(/:\s*(\d+\.?\d*)/g, ': <span style="color:#005cc5">$1</span>');
    
    // Highlight booleans and null
    highlighted = highlighted.replace(/:\s*(true|false|null)\b/g, ': <span style="color:#6f42c1">$1</span>');
    
    return highlighted;
  } catch (error) {
    return escapeHtml(jsonString);
  }
}

function parseDebugLogContent(content) {
  try {
    const debugMessages = extractUserDebugBlocks(content);
          
    // Extract limits section
    const lines = content.split('\n');
    let limitsSection = '';
    let inLimitsSection = false;
    let lastLimitsStartIndex = -1;
    
    // First pass: find the LAST LIMIT_USAGE_FOR_NS section
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('LIMIT_USAGE_FOR_NS')) {
        lastLimitsStartIndex = i;
        break;
  }
}

    // Extract the LAST LIMIT_USAGE_FOR_NS section
    if (lastLimitsStartIndex >= 0) {
      for (let i = lastLimitsStartIndex; i < lines.length; i++) {
      const line = lines[i];
      
        if (line.includes('LIMIT_USAGE_FOR_NS')) {
          inLimitsSection = true;
          // Extract the namespace from the line
          const namespaceMatch = line.match(/LIMIT_USAGE_FOR_NS\|([^|]+)\|/);
          const namespace = namespaceMatch ? namespaceMatch[1] : 'unknown';
          limitsSection = `LIMIT_USAGE_FOR_NS|${namespace}|\n`;
          continue;
        }
        
        if (inLimitsSection) {
          // Stop collecting when we hit another section (any line with |) or empty line followed by another section
          if (line.includes('|') && !line.match(/^\s+/)) {
            break;
       }
      
          // Stop collecting when we hit CUMULATIVE_LIMIT_USAGE_END
          if (line.includes('CUMULATIVE_LIMIT_USAGE_END')) {
            break;
          }
          
          limitsSection += line + '\n';
      }
      }
    }
    
    return {
      debugMessages: debugMessages,
      limits: limitsSection.trim()
    };
  } catch (error) {
    return {
      debugMessages: [],
      limits: ''
    };
        }
}



function updateStats() {
  const { totalLogsCount, lastPollTime } = elements;
  if (totalLogsCount) {
    totalLogsCount.textContent = debugLogs.length;
  }
  if (lastPollTime) {
    lastPollTime.textContent = new Date().toLocaleTimeString();
  }
}

async function startMonitoring() {
  if (!currentSession) {
    await checkConnectionStatus();
    if (!currentSession) {
      alert('Please ensure you are logged into Salesforce and try again.');
      return;
    }
  }
  
  updateMonitoringStatus(true, 'Starting...');
  await loadDebugLogs();
  
  const interval = parseInt(elements.pollInterval.value) * 1000;
  monitoringInterval = setInterval(loadDebugLogs, interval);
  
  updateMonitoringStatus(true, 'Active');
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  
  updateMonitoringStatus(false, 'Stopped');
}

function restartMonitoring() {
  if (isMonitoring) {
    stopMonitoring();
    setTimeout(startMonitoring, 100);
  }
}

// Utility functions
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

function containsSalesforceObjects(text) {
  if (!text) return false;
  
  // Decode HTML entities first for better pattern matching
  const decodedText = decodeHtmlEntities(text);
  
  // Check for common Salesforce object patterns anywhere in the text
  return (
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

function extractAndParseSalesforceObjects(text) {
  if (!text) return escapeHtml(text);
  
  // Decode HTML entities first for better processing
  let decodedText = decodeHtmlEntities(text);
  
  // Check for multi-line Salesforce object pattern: ObjectName:\n"[...]"
  const multiLineMatch = decodedText.match(/^(\w+):\s*[\r\n]+\s*"(\[.*\])"$/s);
  if (multiLineMatch) {
    const [, objectName, content] = multiLineMatch;
    
    try {
      // Parse the content inside the quotes
      const parsed = {
        [objectName]: parseComplexContent(content.slice(1, -1)) // Remove [ and ]
      };
      const jsonString = JSON.stringify(parsed, null, 2);
      const highlightedJson = highlightJsonKeys(jsonString);
      return highlightedJson;
    } catch (error) {
      return escapeHtml(decodedText);
    }
  }
  
  // Convert literal \n sequences to spaces for single-line processing
  decodedText = decodedText
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ');
  
  // Try to find where the Salesforce object data starts
  let objectPart = decodedText;
  let prefix = '';
  
  // Look for common patterns where object data starts
  const patterns = [
    // Pattern: "Full Account → Account:{Id=001..., Name=...}"
    /^([^→]*→\s*)(\w+:\{.*\})$/s,
    // Pattern: "Some text:(Account:{...}, Contact:{...})"
    /^([^(]*?)(\([^)]*\w+:\{.*\))$/s,
    // Pattern: "Some text Account:{...}"
    /^([^{]*?)(\w+:\{.*\})$/s,
    // Pattern: "Some text Account:[...]"
    /^([^{[\]]*?)(\w+:\[.*\])$/s,
    // Pattern: "Some text {"key":"value",...}"
    /^([^{[\]]*?)([\{\[].*[\}\]])$/s,
    // Pattern: Multi-line JSON from JSON.serializePretty
    /^([^{[\]]*?)([\{\[][\s\S]*[\}\]])$/,
    // Pattern: Quoted content "[key=value, ...]"
    /^([^"]*)("?\[.*\]"?)$/s,
    // Pattern: Direct object/array (no prefix)
    /^()([\{\[].*[\}\]])$/s,
    // Pattern: Direct Salesforce object (no prefix)
    /^()(\w+:\{.*\})$/s
  ];
  
  for (const pattern of patterns) {
    const match = decodedText.match(pattern);
    if (match) {
      prefix = match[1];
      objectPart = match[2];
      break;
    }
  }
  
  try {
    let parsed;
    let jsonString;
    
    // Remove surrounding quotes if present
    if (objectPart.startsWith('"') && objectPart.endsWith('"')) {
      objectPart = objectPart.slice(1, -1);
    }
    
    // Check if it's already valid JSON (from JSON.serialize/serializePretty)
    if (objectPart.trim().startsWith('{') || objectPart.trim().startsWith('[')) {
      try {
        parsed = JSON.parse(objectPart);
        jsonString = JSON.stringify(parsed, null, 2);
      } catch (jsonError) {
        // If JSON parsing fails, try Salesforce notation parsing
        if (objectPart.trim().startsWith('[') && objectPart.trim().endsWith(']')) {
          // Handle quoted array content: [key=value, key=value]
          const arrayContent = objectPart.slice(1, -1); // Remove [ and ]
          parsed = parseComplexContent(arrayContent);
          jsonString = JSON.stringify(parsed, null, 2);
        } else {
          parsed = parseSalesforceObjectNotation(objectPart);
          jsonString = JSON.stringify(parsed, null, 2);
        }
      }
    } else {
      // Try to parse as Salesforce object notation
      parsed = parseSalesforceObjectNotation(objectPart);
      jsonString = JSON.stringify(parsed, null, 2);
    }
    
    const highlightedJson = highlightJsonKeys(jsonString);
    
    // Combine prefix (if any) with formatted JSON
    if (prefix.trim()) {
      const escapedPrefix = escapeHtml(prefix.trim());
      return `<span style="color: #6c757d;">${escapedPrefix}</span>\n${highlightedJson}`;
    } else {
      return highlightedJson;
    }
  } catch (e) {
    // If all parsing fails, just escape the decoded text
    return escapeHtml(decodedText);
  }
}

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

// New function to extract complex key=value pairs based on pattern matching
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
    // Handle null
    if (value === 'null') {
      return null;
    }
    
    // Handle boolean
    if (value === 'true') return true;
    if (value === 'false') return false;
    
    // Handle numbers
    if (/^\d+$/.test(value)) {
      return parseInt(value, 10);
    }
    if (/^\d+\.\d+$/.test(value)) {
      return parseFloat(value);
    }
    
    // Handle collections in parentheses like (Bookmark:[...], Bookmark:[...])
    if (value.startsWith('(') && value.endsWith(')')) {
      const innerContent = value.slice(1, -1);
      return parseCollectionContent(innerContent);
    }
    
    // Handle arrays in square brackets like [item1, item2]
    if (value.startsWith('[') && value.endsWith(']')) {
      const innerContent = value.slice(1, -1);
      return parseCollectionContent(innerContent);
    }
    
    // Handle single object patterns like ObjectType:[...]
    const singleObjectMatch = value.match(/^(\w+):\[(.+)\]$/);
    if (singleObjectMatch) {
      const [, objectType, content] = singleObjectMatch;
      return {
        [objectType]: parseKeyValuePairs(content)
      };
    }
    
    // Handle objects in braces
    if (value.startsWith('{') && value.endsWith('}')) {
      return parseKeyValuePairs(value.slice(1, -1));
    }
    
    // Return as string for simple values
    return value;
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

// New function to extract collection items based on pattern matching
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

function formatGovernorLimits(limitsText) {
  try {
    if (!limitsText || !limitsText.trim()) {
      return limitsText;
    }
    
    let formattedLimits = limitsText;
    
    // Define color for LIMIT_USAGE_FOR_NS theme (light black)
    const limitHeaderColor = '#444';
    
    // Format the main header (LIMIT_USAGE_FOR_NS)
    formattedLimits = formattedLimits.replace(
      /^(LIMIT_USAGE_FOR_NS.*?)$/gm, 
      `<div class="limit-header" style="color: ${limitHeaderColor}; font-weight: bold; margin-bottom: 4px; font-size: 11px;">$1</div>`
    );
    
    // Format category lines like "Number of SOQL queries: 0 out of 1000"
    formattedLimits = formattedLimits.replace(
      /^([A-Za-z\s]+):\s*(\d+)\s+(out of)\s+(\d+)(.*)$/gm,
      `<div style="margin: 1px 0;"><span class="limit-category" style="color: ${limitHeaderColor}; font-weight: 500;">$1:</span> <span class="limit-used" style="color: #d73a49; font-weight: bold; margin: 0 3px;">$2</span> <span class="limit-separator" style="color: ${limitHeaderColor}; margin: 0 1px;">$3</span> <span class="limit-value" style="font-weight: bold; margin-left: 3px;">$4</span>$5</div>`
    );
    
    // Format percentage lines like "****** CLOSE TO LIMIT (85%)"
    formattedLimits = formattedLimits.replace(
      /(\*+)\s*(CLOSE TO LIMIT|OVER LIMIT)\s*\((\d+%)\)/g,
      '<div style="margin: 1px 0;"><span class="limit-separator" style="margin-right: 3px;">$1</span> <span class="limit-used" style="color: #dc3545; font-weight: bold;">$2</span> <span class="limit-percentage" style="color: #dc3545; font-weight: bold; margin-left: 3px;">($3)</span></div>'
    );
    
    // Format OK status percentages
    formattedLimits = formattedLimits.replace(
      /\((\d+%)\)$/gm,
      '<span class="limit-percentage" style="margin-left: 3px; color: #666;">($1)</span>'
    );
    
    // Format number ranges like "0 out of 1000" (fallback for any missed cases)
    formattedLimits = formattedLimits.replace(
      /(\d+)\s+(out of)\s+(\d+)/g,
      `<span class="limit-used" style="color: #d73a49; font-weight: bold; margin: 0 3px;">$1</span> <span class="limit-separator" style="color: ${limitHeaderColor}; margin: 0 1px;">$2</span> <span class="limit-value" style="font-weight: bold; margin-left: 3px;">$3</span>`
    );
    
    // Improved spacing between sections
    formattedLimits = formattedLimits.replace(/\n([A-Za-z])/g, '\n\n$1');
    
    // Wrap the entire content in a container with proper spacing
    formattedLimits = `<div style="font-family: Monaco, 'Courier New', monospace; font-size: 10px; line-height: 1.2; padding: 4px 0;">${formattedLimits}</div>`;
    
    return formattedLimits;
  } catch (error) {
    return limitsText;
  }
}

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

async function copySessionUrl() {
  if (!currentSession || !sfHost) return;
  
  const sessionId = currentSession.key || currentSession.sessionId;
  if (!sessionId) return;
  
  const sessionUrl = `https://${sfHost}/secur/frontdoor.jsp?sid=${sessionId}`;
  
  try {
    await navigator.clipboard.writeText(sessionUrl);
    
    const { copySessionBtn } = elements;
    const originalText = copySessionBtn.innerHTML;
    copySessionBtn.innerHTML = '✅ Copied';
    copySessionBtn.disabled = true;
    
    setTimeout(() => {
      copySessionBtn.innerHTML = originalText;
      copySessionBtn.disabled = false;
    }, 2000);
    
  } catch (error) {
    alert(`Session URL: ${sessionUrl}`);
  }
}

async function openInIncognito() {
  if (!currentSession || !sfHost) return;
  
  const sessionId = currentSession.key || currentSession.sessionId;
  if (!sessionId) return;
  
  const orgUrl = `https://${sfHost}/secur/frontdoor.jsp?sid=${sessionId}`;
  
  try {
    await chrome.windows.create({
      url: orgUrl,
      incognito: true,
      focused: true
    });
  } catch (error) {
    try {
      await chrome.tabs.create({
        url: orgUrl,
        active: true
      });
    } catch (fallbackError) {
      // Failed
    }
  }
}

async function autoEstablishSession(targetHost) {
  try {
    const classicDomain = targetHost.replace('.lightning.force.com', '.my.salesforce.com');
    
    await chrome.tabs.create({
      url: `https://${classicDomain}/lightning/page/home`,
      active: true
    });
    
    setTimeout(async () => {
      await checkConnectionStatus(targetHost);
    }, 3000);
    
  } catch (error) {
    // Failed
  }
}

function dismissSessionHelp() {
  const controlsBar = document.querySelector('.controls-bar');
  const existingHelpPanel = controlsBar?.querySelector('.session-help-panel');
  existingHelpPanel?.remove();
}



async function checkDeveloperConsoleStatus() {
  if (!sfHost || !currentSession) {
    hideDevConsoleWarning();
    return;
  }

  try {
    const isDismissed = sessionStorage.getItem(`devConsole_dismissed_${sfHost}`);
    if (isDismissed) {
      hideDevConsoleWarning();
      return;
    }

    const tabs = await chrome.tabs.query({});
    const devConsoleTabs = tabs.filter(tab => {
      if (!tab.url) return false;
      return tab.url.includes(sfHost) && 
             (tab.url.includes('/_ui/common/apex/debug/ApexCSIPage') ||
              tab.url.includes('/debug/debug.jsp') ||
              tab.url.includes('/apexDebug') ||
              tab.url.includes('debug') && tab.url.includes('apex'));
    });

    if (devConsoleTabs.length === 0) {
      showDevConsoleWarning();
    } else {
      hideDevConsoleWarning();
    }
  } catch (error) {
    hideDevConsoleWarning();
  }
}

function showDevConsoleWarning() {
  elements.devConsoleWarning?.classList.remove('hidden');
}

function hideDevConsoleWarning() {
  elements.devConsoleWarning?.classList.add('hidden');
}

async function openDeveloperConsole() {
  if (!sfHost) return;

  try {
    const developerConsoleUrl = `https://${sfHost}/_ui/common/apex/debug/ApexCSIPage`;
    
    await chrome.tabs.create({
      url: developerConsoleUrl,
      active: false
    });

    setTimeout(checkDeveloperConsoleStatus, 1000);
    
  } catch (error) {
    // Failed
  }
}

function dismissDevConsoleWarning() {
  if (sfHost) {
    sessionStorage.setItem(`devConsole_dismissed_${sfHost}`, 'true');
  }
  hideDevConsoleWarning();
}

window.addEventListener('beforeunload', () => {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
});