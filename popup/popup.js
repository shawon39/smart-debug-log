class SmartDebugLogPopup {
  constructor() {
    this.init();
  }

  async init() {
    try {
      // Initialize theme first
      await this.initializeTheme();
      
      this.setupEventListeners();
      await this.checkConnection();
      await this.checkTokenStatus();
    } catch (error) {
      this.updateStatus('error', 'Initialization failed');
    }
  }

  async initializeTheme() {
    try {
      // Initialize theme from storage
      await initializeTheme();
      
      // Setup theme toggle
      const themeToggle = document.getElementById('themeToggle');
      if (themeToggle) {
        setupThemeToggle(themeToggle);
      }
    } catch (error) {
      console.warn('Failed to initialize theme:', error);
    }
  }

  setupEventListeners() {
    // Event listener for dashboard button
    document.getElementById('openDashboardBtn').addEventListener('click', () => this.openDashboard());
    
    // Event listener for generate token button
    document.getElementById('generateTokenBtn').addEventListener('click', () => this.generateAccessToken());
    
    // Event listener for revoke token button
    document.getElementById('revokeTokenBtn').addEventListener('click', () => this.revokeAccessToken());
    
    // Add simple hover effects for feature cards
    document.querySelectorAll('.feature-card').forEach(card => {
      card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateY(-1px)';
      });
      
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'translateY(0)';
      });
    });
  }

  async checkConnection() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab || !tab.url) {
        this.showNotOnSalesforceNotification();
        this.hideOrgInfo();
        this.hideButton();
        return;
      }

      const hostResponse = await chrome.runtime.sendMessage({
        type: 'GET_SALESFORCE_HOST',
        url: tab.url,
      });

      if (!hostResponse || !hostResponse.success) {
        this.showNotOnSalesforceNotification();
        this.hideOrgInfo();
        this.hideButton();
        return;
      }

      const sfHost = hostResponse.data.salesforceHost;
      const sessionResponse = await chrome.runtime.sendMessage({
        type: 'GET_SESSION',
        sfHost: sfHost,
      });

      if (!sessionResponse || !sessionResponse.success) {
        this.showNotOnSalesforceNotification();
        this.hideOrgInfo();
        this.hideButton();
        return;
      }

      const session = sessionResponse.data;
      const orgName = session.orgName || session.hostname || sfHost;
      
      this.hideNotOnSalesforceNotification();
      this.showOrgInfo(orgName);
      this.showButton();
      
    } catch (error) {
      this.showNotOnSalesforceNotification();
      this.hideOrgInfo();
      this.hideButton();
    }
  }

  showNotOnSalesforceNotification() {
    const notification = document.getElementById('notOnSalesforceNotification');
    if (notification) {
      notification.style.display = 'block';
      
      // Add a slight delay for smooth animation
      setTimeout(() => {
        notification.style.opacity = '1';
      }, 10);
    }
  }

  hideNotOnSalesforceNotification() {
    const notification = document.getElementById('notOnSalesforceNotification');
    if (notification) {
      notification.style.display = 'none';
      notification.style.opacity = '0';
    }
  }

  hideButton() {
    const button = document.getElementById('openDashboardBtn');
    if (button) {
      button.style.display = 'none';
    }
  }

  showButton() {
    const button = document.getElementById('openDashboardBtn');
    if (button) {
      button.style.display = 'block';
      button.textContent = 'Open Debug Dashboard';
    }
  }

  async openDashboard() {
    const btn = document.getElementById('openDashboardBtn');
    const originalText = btn.textContent;
    
    try {
      btn.textContent = 'Opening...';
      btn.disabled = true;
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let sfHost = null;
      
      if (tab && tab.url) {
        const hostResponse = await chrome.runtime.sendMessage({
          type: 'GET_SALESFORCE_HOST',
          url: tab.url,
        });
        
        if (hostResponse && hostResponse.success) {
          sfHost = hostResponse.data.salesforceHost;
        }
      }
      
      // Auto-enable debug logging (60 min) if not already active
      try {
        await chrome.runtime.sendMessage({ 
          type: 'ENSURE_TRACE_FLAG',
          sfHost: sfHost // For org-aware token selection
        });
      } catch (traceFlagError) {
        // Continue even if trace flag creation fails - user can enable manually
        console.warn('Could not auto-enable debug:', traceFlagError);
      }
      
      const baseUrl = chrome.runtime.getURL('dashboard.html');
      const dashboardUrl = sfHost ? `${baseUrl}?host=${encodeURIComponent(sfHost)}&traceFlagCreated=true` : `${baseUrl}?traceFlagCreated=true`;
      
      const tabs = await chrome.tabs.query({});
      const existingDashboard = tabs.find(tab => {
        if (!tab.url) return false;
        
        if (sfHost) {
          const targetUrl = `${baseUrl}?host=${encodeURIComponent(sfHost)}`;
          return tab.url === targetUrl || tab.url.startsWith(targetUrl + '&');
        } else {
          return tab.url === baseUrl || (tab.url.startsWith(baseUrl) && !tab.url.includes('?host='));
        }
      });
      
      if (existingDashboard) {
        await chrome.tabs.update(existingDashboard.id, { active: true });
        await chrome.windows.update(existingDashboard.windowId, { focused: true });
      } else {
        await chrome.tabs.create({
          url: dashboardUrl,
          active: true
        });
      }
      
    } catch (error) {
      this.updateStatus('error', 'Failed to open dashboard');
      
      // Fallback: try to open dashboard without specific host
      try {
        const fallbackUrl = chrome.runtime.getURL('dashboard.html');
        await chrome.tabs.create({
          url: fallbackUrl,
          active: true
        });
      } catch (fallbackError) {
        console.error('Dashboard launch failed:', fallbackError);
      }
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
      setTimeout(() => window.close(), 100);
    }
  }

  async generateAccessToken() {
    const tokenBtn = document.getElementById('generateTokenBtn');
    const originalText = tokenBtn.textContent;
    
    try {
      tokenBtn.disabled = true;
      tokenBtn.textContent = 'Authenticating...';
      
      // Get the current Salesforce org URL
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let orgUrl = null;
      
      if (tab && tab.url) {
        const hostResponse = await chrome.runtime.sendMessage({
          type: 'GET_SALESFORCE_HOST',
          url: tab.url,
        });
        
        if (hostResponse && hostResponse.success) {
          orgUrl = hostResponse.data.salesforceHost;
        }
      }
      
      // Send message to background script to start OAuth flow
      const response = await chrome.runtime.sendMessage({
        type: 'SF_GENERATE_TOKEN',
        orgUrl: orgUrl
      });
      
      if (response && response.success) {
        tokenBtn.textContent = 'Token Generated!';
        tokenBtn.style.background = 'linear-gradient(135deg, #047857 0%, #059669 100%)';
        
        // Reset after a short delay
        setTimeout(() => {
          tokenBtn.textContent = originalText;
          tokenBtn.style.background = '';
          tokenBtn.disabled = false;
        }, 2000);
      } else {
        throw new Error(response?.error || 'Failed to generate token');
      }
      
    } catch (error) {
      console.error('Token generation failed:', error);
      tokenBtn.textContent = 'Failed - Try Again';
      tokenBtn.style.background = 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)';
      
      setTimeout(() => {
        tokenBtn.textContent = originalText;
        tokenBtn.style.background = '';
        tokenBtn.disabled = false;
      }, 2000);
    }
  }

  async revokeAccessToken() {
    // Show confirmation dialog
    const confirmed = confirm('Are you sure you want to revoke your access token? You\'ll need to re-authenticate to use features requiring an access token.');
    
    if (!confirmed) {
      return;
    }
    
    const revokeBtn = document.getElementById('revokeTokenBtn');
    const originalText = revokeBtn.textContent;
    
    try {
      revokeBtn.disabled = true;
      revokeBtn.textContent = 'Revoking...';
      
      // Get the current Salesforce org URL
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let orgUrl = null;
      
      if (tab && tab.url) {
        const hostResponse = await chrome.runtime.sendMessage({
          type: 'GET_SALESFORCE_HOST',
          url: tab.url,
        });
        
        if (hostResponse && hostResponse.success) {
          orgUrl = hostResponse.data.salesforceHost;
        }
      }
      
      // Send message to background script to revoke token
      const response = await chrome.runtime.sendMessage({
        type: 'REVOKE_OAUTH_TOKEN',
        sfHost: orgUrl
      });
      
      if (response && response.success) {
        revokeBtn.textContent = 'Token Revoked!';
        revokeBtn.style.background = 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)';
        
        // Hide revoke button after short delay
        setTimeout(() => {
          revokeBtn.style.display = 'none';
          revokeBtn.textContent = originalText;
          revokeBtn.style.background = '';
          revokeBtn.disabled = false;
        }, 1500);
      } else {
        throw new Error(response?.error || 'Failed to revoke token');
      }
      
    } catch (error) {
      console.error('Token revocation failed:', error);
      revokeBtn.textContent = 'Failed - Try Again';
      
      setTimeout(() => {
        revokeBtn.textContent = originalText;
        revokeBtn.disabled = false;
      }, 2000);
    }
  }

  async checkTokenStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let sfHost = null;
      
      if (tab && tab.url) {
        const hostResponse = await chrome.runtime.sendMessage({
          type: 'GET_SALESFORCE_HOST',
          url: tab.url,
        });
        
        if (hostResponse && hostResponse.success) {
          sfHost = hostResponse.data.salesforceHost;
        }
      }
      
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_TOKEN_STATUS',
        sfHost: sfHost
      });
      
      const revokeBtn = document.getElementById('revokeTokenBtn');
      
      if (response && response.success && response.data && response.data.hasToken && !response.data.isExpired) {
        // Token exists and is valid - show revoke button
        if (revokeBtn) {
          revokeBtn.style.display = 'block';
        }
      } else {
        // No token or expired - hide revoke button
        if (revokeBtn) {
          revokeBtn.style.display = 'none';
        }
      }
    } catch (error) {
      // Hide button on error
      const revokeBtn = document.getElementById('revokeTokenBtn');
      if (revokeBtn) {
        revokeBtn.style.display = 'none';
      }
    }
  }

  updateStatus(status, message) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    
    if (!dot || !text) return;
    
    // Remove all status classes
    dot.classList.remove('connected', 'disconnected', 'error');
    
    // Add the current status class if not connected
    if (status !== 'connected') {
      dot.classList.add(status);
    }
    
    text.textContent = message;
  }

  showOrgInfo(orgName) {
    const orgInfo = document.getElementById('orgInfo');
    const orgNameElement = document.getElementById('orgName');
    
    if (!orgInfo || !orgNameElement) return;
    
    if (orgName) {
      // Clean up the org name (remove protocol and paths)
      const cleanOrgName = orgName.replace(/^https?:\/\//, '').split('/')[0];
      orgNameElement.textContent = cleanOrgName;
      orgInfo.style.display = 'block';
    } else {
      orgInfo.style.display = 'none';
    }
  }

  hideOrgInfo() {
    const orgInfo = document.getElementById('orgInfo');
    if (orgInfo) {
      orgInfo.style.display = 'none';
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new SmartDebugLogPopup();
}); 