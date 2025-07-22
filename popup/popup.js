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
      
      if (sfHost) {
        try {
          const debugLogUrl = `https://${sfHost}/_ui/common/apex/debug/ApexCSIPage`;
          
          // Check if developer console is already open
          const tabs = await chrome.tabs.query({});
          const existingDebugTab = tabs.find(tab => 
            tab.url && tab.url.includes('/_ui/common/apex/debug/ApexCSIPage')
          );
          
          if (!existingDebugTab) {
            // Create new developer console tab only if it doesn't exist
            await chrome.tabs.create({
              url: debugLogUrl,
              active: false
            });
          }
        } catch (debugError) {
          // Continue if developer console creation fails
        }
      }
      
      const baseUrl = chrome.runtime.getURL('dashboard.html');
      const dashboardUrl = sfHost ? `${baseUrl}?host=${encodeURIComponent(sfHost)}` : baseUrl;
      
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
      setTimeout(() => window.close(), 100);
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