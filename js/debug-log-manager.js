// Debug Log Manager
// This file contains all debug log operations, parsing, display, and log selection functions

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