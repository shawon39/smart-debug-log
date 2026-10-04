// Dashboard Actions and Session Management
// This file handles session actions, deploy functionality, and modal interactions

// Session management functions

// Login link for this org. Prefers a one-time link (works once, for about a minute) when the
// OAuth token has the "web" scope; otherwise frontdoor.jsp with the session ID.
async function getSessionLoginUrl() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_SINGLE_ACCESS_URL',
      sfHost: getHostFromUrl() || sfHost
    });
    if (response && response.success && response.data && response.data.url) {
      return { url: response.data.url };
    }
  } catch (error) {
    // Fall back to the session ID link
  }

  const sessionId = currentSession.key || currentSession.sessionId;
  if (!sessionId) throw new Error('Log in to this org in a browser tab first (this needs a browser session, not only the access token)');
  return { url: `https://${sfHost}/secur/frontdoor.jsp?sid=${sessionId}` };
}

async function openInIncognito() {
  if (!currentSession || !sfHost) return;

  try {
    const { url } = await getSessionLoginUrl();
    await chrome.windows.create({
      url,
      incognito: true,
      focused: true
    });
  } catch (error) {
    // Never fall back to a normal tab: the session link would end up in history and sync
    showToast(`Could not open an incognito window: ${error.message}`, 6000);
  }
}

// Custom modal dialog for code deployment
function showCodeDeployDialog(description) {
  return new Promise((resolve) => {
    // Create modal elements
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal-content';

    const content = document.createElement('div');
    content.className = 'modal-text';

    const escapedHost = escapeHtml(sfHost || '');
    const formattedDescription = description
      .replace(/List<\w+>\s+\w+\s*=\s*\[SELECT[^\]]+\];/g, (match) => {
        const escapedMatch = escapeHtml(match);
        return `<code class="code-block">${escapedMatch}</code>`;
      })
      .replace(/Console\.log\([^)]+\);/g, (match) => {
        const escapedMatch = escapeHtml(match);
        return `<code class="code-inline">${escapedMatch}</code>`;
      })
      .replace(/Deploy to org: (.+)$/m, `<div class="deploy-info-block"><strong>Deploy to org:</strong> ${escapedHost}</div>`)
      .replace(/\n/g, '<br>');

    content.innerHTML = `
      <h3 class="modal-title">Deploy Console Class</h3>
      <div class="modal-description">${formattedDescription}</div>
      <div class="modal-actions">
        <button id="deployConfirm" class="modal-button-primary">Deploy to Org</button>
        <button id="deployCancel" class="modal-button-secondary">Cancel</button>
      </div>
    `;

    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Add event listeners
    document.getElementById('deployConfirm').addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(true);
    });

    document.getElementById('deployCancel').addEventListener('click', () => {
      document.body.removeChild(overlay);
      resolve(false);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        resolve(false);
      }
    });
  });
}

// The Console helper class (Deploy Console Class). log(label, value) writes the label and the data in one
// debug message, so the dashboard shows them in one card: the label above the formatted JSON.
const CONSOLE_CLASS_BODY = `public with sharing class Console {
    public static void log(Object obj) {
        System.debug(JSON.serializePretty(obj));
    }

    public static void log(String label, Object obj) {
        System.debug(label + '\\n' + JSON.serializePretty(obj));
    }
}`;

// Earlier versions wrote the label in a debug message of its own. Orgs that have one are offered the update.
const OLD_CONSOLE_CLASS_BODIES = [
  `public with sharing class Console {
    public static void log(Object obj) {
        System.debug(JSON.serializePretty(obj));
    }
    
    public static void log(String label, Object obj) {
        System.debug('👉 ' + label);
        System.debug(JSON.serializePretty(obj));
    }
}`,
  `public with sharing class Console {
    public static void log(Object obj) {
        System.debug(JSON.serializePretty(obj));
    }
    
    public static void log(String label, Object obj) {
        System.debug(label);
        System.debug(JSON.serializePretty(obj));
    }
}`
];

// Same Apex code, ignoring whitespace and line endings
const sameApexCode = (a, b) => String(a || '').replace(/\s+/g, '') === String(b || '').replace(/\s+/g, '');

async function deployPrettierClass() {
  if (!currentSession || !sfHost) {
    showToast('No active Salesforce session found. Please ensure you are logged into Salesforce.', 5000);
    return;
  }

  const host = getHostFromUrl() || sfHost;
  const { deployPrettierBtn } = elements;
  const originalText = deployPrettierBtn.innerHTML;
  const showBusy = (label) => {
    deployPrettierBtn.innerHTML = `${Icons.svg('loader')}${label}`;
    deployPrettierBtn.disabled = true;
  };
  const showDone = (label, message) => {
    showToast(message);
    deployPrettierBtn.innerHTML = `${Icons.svg('check')}${label}`;
    deployPrettierBtn.classList.add('deploy-success');
    setTimeout(() => {
      deployPrettierBtn.innerHTML = originalText;
      deployPrettierBtn.classList.remove('deploy-success');
      deployPrettierBtn.disabled = false;
    }, 3000);
  };

  try {
    // A Console class may exist already: this one, an older one of ours, or the org's own
    const existingCheck = await chrome.runtime.sendMessage({
      type: 'EXECUTE_TOOLING_QUERY',
      query: "SELECT Id, Body FROM ApexClass WHERE Name = 'Console' LIMIT 1",
      sfHost: host
    });

    // Do not deploy when we could not check
    if (!existingCheck || !existingCheck.success) {
      throw new Error(`Could not check if the class exists: ${existingCheck?.error || existingCheck?.message || 'no response'}`);
    }

    const existing = existingCheck.data?.records?.[0];
    if (existing) {
      if (sameApexCode(existing.Body, CONSOLE_CLASS_BODY)) {
        showToast('The Console class is already up to date.');
        return;
      }
      if (!OLD_CONSOLE_CLASS_BODIES.some(body => sameApexCode(existing.Body, body))) {
        showToast('This org has its own Console class, so it was not changed.', 5000);
        return;
      }
      if (!confirm('Update the Console class in this org to the latest version? Console.log(label, value) then writes the label and the data in one debug message.')) {
        return;
      }

      showBusy('Updating...');
      const result = await chrome.runtime.sendMessage({
        type: 'TOOLING_UPDATE',
        sobjectType: 'ApexClass',
        recordId: existing.Id,
        data: { Body: CONSOLE_CLASS_BODY },
        sfHost: host
      });
      if (!result || !result.success) throw new Error(result?.error || 'Unknown update error');
      showDone('Updated', 'Console class updated');
      return;
    }

    const classDescription = `Console Utility Class

Ready to use enhanced debug logging for your Salesforce development.

Code Example:
List<Account> accountList = [SELECT Id, Name, Industry, Type FROM Account LIMIT 5];

Usage Examples:
Console.log(accountList);
Console.log('Account Results', accountList);

Deploy to org: ${sfHost}`;

    // Show confirmation dialog with better formatting
    if (!(await showCodeDeployDialog(classDescription))) {
      return;
    }

    showBusy('Deploying...');

    // Deploy using the Tooling API
    const result = await chrome.runtime.sendMessage({
      type: 'TOOLING_CREATE',
      sobjectType: 'ApexClass',
      data: { Name: 'Console', Body: CONSOLE_CLASS_BODY },
      sfHost: host // For org-aware token selection
    });
    if (!result || !result.success) throw new Error(result?.error || 'Unknown deployment error');
    showDone('Deployed', 'Console class deployed');
  } catch (error) {
    console.error('Deployment error:', error);

    // Show the Salesforce message (for example, Apex classes cannot be created in production)
    alert(`Could not deploy the Console class: ${readableSalesforceError(error.message)}`);

    // Reset button state
    deployPrettierBtn.innerHTML = originalText;
    deployPrettierBtn.disabled = false;
  }
}

// "Tooling create failed: 400 - [{"message":"..."}]" -> the Salesforce message only
function readableSalesforceError(message) {
  const match = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(message || '');
  return match ? match[1] : message;
}

// Clear raw response function
function clearRawResponse() {
  currentRawResponse = null;
  const { toggleViewBtn, copyRawBtn, rawSearchContainer } = elements;
  toggleViewBtn?.classList.add('hidden');
  copyRawBtn?.classList.add('hidden');
  rawSearchContainer?.classList.add('hidden');
  // Don't reset the view preference - keep user's choice
}

// Note: copyRawResponse() is defined in raw-view.js

// Back to Salesforce: the tab the dashboard was opened from, another tab of this org, or a new tab
async function goBackToSalesforce() {
  const host = getHostFromUrl() || sfHost;
  if (!host) {
    showToast('Open the dashboard from a Salesforce tab first', 4000);
    return;
  }

  try {
    await focusSalesforceTab(host);
  } catch (error) {
    showToast(`Could not open Salesforce: ${error.message}`, 5000);
  }
}

// Open Debug Logs Setup page navigation
async function openDebugLogsSetup() {
  if (!currentSession || !sfHost) {
    alert('No active Salesforce session found. Please ensure you are logged into Salesforce.');
    return;
  }

  const debugLogsUrl = `https://${sfHost}/lightning/setup/ApexDebugLogs/home`;

  try {
    await chrome.tabs.create({
      url: debugLogsUrl,
      active: true
    });
  } catch (error) {
    // Fallback: copy URL to clipboard
    try {
      await navigator.clipboard.writeText(debugLogsUrl);
      alert(`Debug Logs URL copied to clipboard:\n${debugLogsUrl}`);
    } catch (clipboardError) {
      alert(`Please navigate to:\n${debugLogsUrl}`);
    }
  }
}