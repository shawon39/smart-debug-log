// Dashboard Actions and Session Management
// This file handles session actions, deploy functionality, and modal interactions

// Session management functions
async function copySessionUrl() {
  if (!currentSession || !sfHost) return;
  
  const sessionId = currentSession.key || currentSession.sessionId;
  if (!sessionId) return;
  
  const sessionUrl = `https://${sfHost}/secur/frontdoor.jsp?sid=${sessionId}`;
  
  try {
    await navigator.clipboard.writeText(sessionUrl);
    
    const { copySessionBtn } = elements;
    const originalText = copySessionBtn.innerHTML;
    copySessionBtn.innerHTML = 'Copied';
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
    
    // Format the description with proper code styling
    const formattedDescription = description
      .replace(/List<\w+>\s+\w+\s*=\s*\[SELECT[^\]]+\];/g, (match) => {
        const escapedMatch = match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<code class="code-block">${escapedMatch}</code>`;
      })
      .replace(/Console\.log\([^)]+\);/g, `<code class="code-inline">$&</code>`)
      .replace(/Deploy to org: (.+)$/m, `<div class="deploy-info-block"><strong>Deploy to org:</strong> $1</div>`)
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
    alert('No active Salesforce session found. Please ensure you are logged into Salesforce.');
    return;
  }

  // Pre-deployment validation
  // Check if we're in a sandbox environment
  const isSandbox = sfHost.includes('sandbox') || sfHost.includes('develop') || sfHost.includes('scratch');
  
  // Validate session has required properties
  if (!currentSession.sessionId && !currentSession.key) {
    alert('❌ Invalid session: No authentication token found. Please refresh Salesforce and try again.');
    return;
  }

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

  const classDescription = `📋 Console Utility Class

Ready to use enhanced debug logging for your Salesforce development.

⚡ Code Example:
List<Account> accountList = [SELECT Id, Name, Industry, Type FROM Account LIMIT 5];

⚡ Usage Examples:
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
  deployPrettierBtn.innerHTML = 'Deploying...';
  deployPrettierBtn.disabled = true;

  try {
    // Check if class already exists
    const existingCheck = await chrome.runtime.sendMessage({
      type: 'EXECUTE_TOOLING_QUERY',
      query: `SELECT Id FROM ApexClass WHERE Name = '${className}' LIMIT 1`,
      sfHost: getHostFromUrl()
    });

    if (existingCheck.success && existingCheck.data?.records?.length > 0) {
      alert('✅ Console class already exists in this org.');
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
      session: currentSession,
      sfHost: getHostFromUrl() // For org-aware token selection
    });

    if (result.success) {
      alert('✅ Class is deployed');
      
      // Update button to show success
      deployPrettierBtn.innerHTML = 'Deployed ✓';
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
    
    let errorMessage = 'The class already exists, or you can’t deploy it to the production environment from here.';
    
    alert(errorMessage);
    
    // Reset button state
    deployPrettierBtn.innerHTML = originalText;
    deployPrettierBtn.disabled = false;
  }
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