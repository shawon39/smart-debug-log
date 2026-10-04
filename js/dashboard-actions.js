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
      return { url: response.data.url, oneTime: true };
    }
  } catch (error) {
    // Fall back to the session ID link
  }

  const sessionId = currentSession.key || currentSession.sessionId;
  if (!sessionId) throw new Error('Log in to this org in a browser tab first (this needs a browser session, not only the access token)');
  return { url: `https://${sfHost}/secur/frontdoor.jsp?sid=${sessionId}`, oneTime: false };
}

async function copySessionUrl() {
  if (!currentSession || !sfHost) return;

  const confirmed = await showConfirmDialog({
    title: 'Copy session link?',
    message: 'Anyone who opens this link is logged in to Salesforce as you, with full access. Do not share it or paste it into chats, tickets or emails.',
    confirmLabel: 'Copy link'
  });
  if (!confirmed) return;

  try {
    const { url, oneTime } = await getSessionLoginUrl();
    await navigator.clipboard.writeText(url);

    const { copySessionBtn } = elements;
    const originalText = copySessionBtn.innerHTML;
    copySessionBtn.innerHTML = `${Icons.svg('check')}Copied`;
    copySessionBtn.disabled = true;

    setTimeout(() => {
      copySessionBtn.innerHTML = originalText;
      copySessionBtn.disabled = false;
    }, 2000);

    if (oneTime) showToast('One-time link copied. It works once, within about a minute.', 4000);
  } catch (error) {
    showToast(`Could not copy the link: ${error.message}`, 5000);
  }
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

// Small in-page confirm dialog (built like the deploy dialog below)
function showConfirmDialog({ title, message, confirmLabel }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal-content confirm-dialog';
    modal.setAttribute('role', 'alertdialog');
    modal.setAttribute('aria-modal', 'true');

    const heading = document.createElement('h3');
    heading.className = 'confirm-dialog-title';
    heading.innerHTML = Icons.svg('triangleAlert', 18);
    heading.append(title);

    const text = document.createElement('p');
    text.className = 'confirm-dialog-message';
    text.textContent = message;

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'button secondary';
    cancelBtn.textContent = 'Cancel';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'button danger';
    confirmBtn.textContent = confirmLabel;

    const actions = document.createElement('div');
    actions.className = 'confirm-dialog-actions';
    actions.append(cancelBtn, confirmBtn);

    modal.append(heading, text, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    cancelBtn.focus();

    const close = (result) => {
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      resolve(result);
    };
    const onKeydown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      }
    };

    document.addEventListener('keydown', onKeydown, true);
    confirmBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
  });
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

async function deployPrettierClass() {
  if (!currentSession || !sfHost) {
    showToast('No active Salesforce session found. Please ensure you are logged into Salesforce.', 5000);
    return;
  }

  // Pre-deployment validation

  const className = 'Console';
  const classBody = `public with sharing class Console {
    public static void log(Object obj) {
        System.debug(JSON.serializePretty(obj));
    }
    
    public static void log(String label, Object obj) {
        System.debug('👉 ' + label);
        System.debug(JSON.serializePretty(obj));
    }
}`;

  const classDescription = `Console Utility Class

Ready to use enhanced debug logging for your Salesforce development.

Code Example:
List<Account> accountList = [SELECT Id, Name, Industry, Type FROM Account LIMIT 5];

Usage Examples:
Console.log(accountList);
Console.log('Account Results', accountList);

Deploy to org: ${sfHost}`;

  // Show confirmation dialog with better formatting
  const confirmed = await showCodeDeployDialog(classDescription);
  if (!confirmed) {
    return;
  }

  // Update button state
  const { deployPrettierBtn } = elements;
  const originalText = deployPrettierBtn.innerHTML;
  deployPrettierBtn.innerHTML = `${Icons.svg('loader')}Deploying...`;
  deployPrettierBtn.disabled = true;

  try {
    // Check if class already exists
    const existingCheck = await chrome.runtime.sendMessage({
      type: 'EXECUTE_TOOLING_QUERY',
      query: `SELECT Id FROM ApexClass WHERE Name = '${className}' LIMIT 1`,
      sfHost: getHostFromUrl() || sfHost
    });

    // Do not deploy when we could not check
    if (!existingCheck || !existingCheck.success) {
      throw new Error(`Could not check if the class exists: ${existingCheck?.error || existingCheck?.message || 'no response'}`);
    }

    if (existingCheck.data?.records?.length > 0) {
      showToast('Console class already exists in this org.');
      deployPrettierBtn.innerHTML = originalText;
      deployPrettierBtn.disabled = false;
      return;
    }

    // Prepare the class data for deployment
    const classData = {
      Name: className,
      Body: classBody
    };

    // Deploy using the Tooling API
    const result = await chrome.runtime.sendMessage({
      type: 'TOOLING_CREATE',
      sobjectType: 'ApexClass',
      data: classData,
      sfHost: getHostFromUrl() || sfHost // For org-aware token selection
    });

    if (result.success) {
      showToast('Console class deployed');

      // Update button to show success
      deployPrettierBtn.innerHTML = `${Icons.svg('check')}Deployed`;
      deployPrettierBtn.classList.add('deploy-success');

      setTimeout(() => {
        deployPrettierBtn.innerHTML = originalText;
        deployPrettierBtn.classList.remove('deploy-success');
        deployPrettierBtn.disabled = false;
      }, 3000);
    } else {
      throw new Error(result.error || 'Unknown deployment error');
    }
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