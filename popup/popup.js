class SmartDebugLogPopup {
  constructor() {
    this.init();
  }

  async init() {
    try {
      this.setupEventListeners();
      await this.checkConnection();
    } catch (error) {
      this.updateStatus('error', 'Initialization failed');
    }
  }

  setupEventListeners() {
    document.getElementById('openDashboardBtn').addEventListener('click', () => this.openDashboard());
  }

  async checkConnection() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab || !tab.url) {
        this.updateStatus('disconnected', 'Cannot access tab information');
        return;
      }

      const hostResponse = await chrome.runtime.sendMessage({
        type: 'GET_SALESFORCE_HOST',
        url: tab.url,
      });

      if (!hostResponse || !hostResponse.success) {
        this.updateStatus('disconnected', 'Not a Salesforce page');
        return;
      }

      const sfHost = hostResponse.data.salesforceHost;
      const sessionResponse = await chrome.runtime.sendMessage({
        type: 'GET_SESSION',
        sfHost: sfHost,
      });

      if (!sessionResponse || !sessionResponse.success) {
        this.updateStatus('disconnected', 'No active Salesforce session');
        return;
      }

      const session = sessionResponse.data;
      const orgName = session.orgName || session.hostname || sfHost;
      this.updateStatus('connected', `Connected to ${orgName}`);
      
    } catch (error) {
      this.updateStatus('error', 'Connection check failed');
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
          // If developer console already exists, do nothing - just proceed to open dashboard
        } catch (debugError) {
          // Continue
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
        const newTab = await chrome.tabs.create({
          url: dashboardUrl,
          active: true
        });
      }
      
    } catch (error) {
      this.updateStatus('error', 'Failed to open dashboard');
      
      try {
        const fallbackUrl = chrome.runtime.getURL('dashboard.html');
        await chrome.tabs.create({
          url: fallbackUrl,
          active: true
        });
      } catch (fallbackError) {
        // Failed
      }
    } finally {
      setTimeout(() => window.close(), 100);
    }
  }

  updateStatus(status, message) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    
    if (!dot || !text) return;
    
    dot.classList.remove('connected', 'disconnected', 'error');
    
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
      orgNameElement.textContent = orgName;
      orgInfo.classList.remove('hidden');
    } else {
      orgInfo.classList.add('hidden');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SmartDebugLogPopup();
}); 