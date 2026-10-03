// Open dashboard tabs. Without the "tabs" permission Chrome hides the URL of our own pages in
// tabs.query, so read them from runtime.getContexts (Chrome 116+).
async function getOpenDashboards() {
  if (!chrome.runtime.getContexts) return [];
  const baseUrl = chrome.runtime.getURL('dashboard.html');
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  return contexts
    .filter(context => context.documentUrl && context.documentUrl.startsWith(baseUrl))
    .map(context => ({ tabId: context.tabId, windowId: context.windowId, url: context.documentUrl }));
}

class SmartDebugLogPopup {
  constructor() {
    // The org is resolved once in checkConnection and used by every action
    this.sfHost = null;
    this.sourceTab = null; // Salesforce tab the popup was opened on
    this.dashboardTab = null; // set when the popup was opened on a dashboard tab
    this.hasToken = false;
    this.countdownInterval = null;
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
      this.showError(`Could not load the popup: ${error.message}`);
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

    // Event listener for Go to Setup button
    const goToSetupBtn = document.getElementById('goToSetupBtn');
    if (goToSetupBtn) {
      goToSetupBtn.addEventListener('click', () => this.goToSetup());
    }

    // Event listener for Enable/Extend debug logging
    const enableBtn = document.getElementById('enableLoggingBtn');
    if (enableBtn) {
      enableBtn.addEventListener('click', () => this.enableLogging());
    }
  }

  // Finds the tab whose org the popup works on. On a dashboard tab that is the dashboard's
  // ?host= org (not some other Salesforce tab).
  async resolveTargetTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return null;

    const dashboard = (await getOpenDashboards()).find(d => d.tabId === tab.id);
    if (!dashboard) return tab;

    this.dashboardTab = dashboard;
    if (new URL(dashboard.url).searchParams.get('host')) {
      return { id: tab.id, url: dashboard.url };
    }

    // Dashboard without an org: use the most recently accessed Salesforce tab
    const salesforceTabs = (await chrome.tabs.query({})).filter(t => t.url && isSalesforceUrl(t.url));
    salesforceTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return salesforceTabs[0] || null;
  }

  async checkConnection() {
    try {
      const tab = await this.resolveTargetTab();

      if (!tab || !tab.url) {
        this.showNotOnSalesforceNotification();
        this.hideOrgInfo();
        this.hideButton();
        return;
      }

      const hostResponse = await chrome.runtime.sendMessage({
        type: 'GET_SALESFORCE_HOST',
        url: tab.url,
        tabId: tab.id
      });


      if (!hostResponse || !hostResponse.success || !hostResponse.data) {
        this.showNotOnSalesforceNotification();
        this.hideOrgInfo();
        this.hideButton();
        return;
      }

      const sfHost = hostResponse.data.salesforceHost;

      const sessionResponse = await chrome.runtime.sendMessage({
        type: 'GET_SESSION',
        sfHost: sfHost,
        tabId: tab.id,
        skipValidation: true  // Skip API validation for connection check - just verify SF cookies exist
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
      this.sfHost = sfHost;
      this.sourceTab = this.dashboardTab ? null : tab;
      this.showOrgInfo(orgName);
      await this.refreshLoggingStatus();

      if (this.dashboardTab) {
        await this.showDashboardNavigationButtons(sfHost);
      } else {
        this.showButton();
        const setupBtn = document.getElementById('goToSetupBtn');
        if (setupBtn) setupBtn.style.display = 'none';
      }

    } catch (error) {
      console.error('[Popup] Connection check error:', error);
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
      button.style.display = '';
      // Change only the label so the SVG icon stays
      (button.querySelector('span') || button).textContent = 'View Debug Logs';
    }
  }

  async openDashboard() {
    const btn = document.getElementById('openDashboardBtn');

    // Check if we are in "Go Back" mode
    const label = btn?.querySelector('span') || btn;
    if (btn && label.textContent === 'Go Back Salesforce') {
      const sfHost = btn.dataset.sfHost;
      if (sfHost) {
        return this.goBackToSalesforce(sfHost);
      }
    }

    const originalText = label.textContent;

    try {
      label.textContent = 'Opening...';
      btn.disabled = true;

      const sfHost = this.sfHost;

      // Auto-enable debug logging (45 min) if not already active
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

      // Save the source URL for this host before leaving
      if (sfHost && this.sourceTab && this.sourceTab.url) {
        const storageKey = `lastSfUrl_${sfHost}`;
        await chrome.storage.local.set({ [storageKey]: this.sourceTab.url });
      }

      const existingDashboard = (await getOpenDashboards()).find(dashboard => {
        if (sfHost) {
          const targetUrl = `${baseUrl}?host=${encodeURIComponent(sfHost)}`;
          return dashboard.url === targetUrl || dashboard.url.startsWith(targetUrl + '&');
        } else {
          return dashboard.url === baseUrl || !dashboard.url.includes('?host=');
        }
      });

      if (existingDashboard) {
        await chrome.tabs.update(existingDashboard.tabId, { active: true });
        await chrome.windows.update(existingDashboard.windowId, { focused: true });
      } else {
        await chrome.tabs.create({
          url: dashboardUrl,
          active: true
        });
      }

    } catch (error) {
      this.showError(`Could not open the dashboard: ${error.message}`);

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
      label.textContent = originalText;
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
      this.clearError();

      // Send message to background script to start OAuth flow
      const response = await chrome.runtime.sendMessage({
        type: 'SF_GENERATE_TOKEN',
        orgUrl: this.sfHost
      });

      if (response && response.success) {
        this.hasToken = true;
        tokenBtn.textContent = 'Generated';
        tokenBtn.classList.add('is-success');

        // Reset after a short delay, then reflect the new token state in the row
        setTimeout(() => {
          tokenBtn.textContent = originalText;
          tokenBtn.classList.remove('is-success');
          tokenBtn.disabled = false;
          this.renderTokenRow(true);
        }, 1400);
      } else {
        throw new Error(response?.error || 'Failed to generate token');
      }

    } catch (error) {
      console.error('Token generation failed:', error);
      this.showError(error.message);
      tokenBtn.textContent = 'Failed';
      tokenBtn.classList.add('is-error');

      setTimeout(() => {
        tokenBtn.textContent = originalText;
        tokenBtn.classList.remove('is-error');
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
      this.clearError();

      // Send message to background script to revoke token
      const response = await chrome.runtime.sendMessage({
        type: 'REVOKE_OAUTH_TOKEN',
        sfHost: this.sfHost
      });

      if (response && response.success) {
        if (response.warning) this.showError(response.warning);
        this.hasToken = false;
        revokeBtn.textContent = 'Revoked';
        revokeBtn.classList.add('is-success');

        // After feedback, flip the token row back to the "no token" state
        setTimeout(() => {
          revokeBtn.textContent = originalText;
          revokeBtn.classList.remove('is-success');
          revokeBtn.disabled = false;
          this.renderTokenRow(false);
        }, 1400);
      } else {
        throw new Error(response?.error || 'Failed to revoke token');
      }

    } catch (error) {
      console.error('Token revocation failed:', error);
      this.showError(error.message);
      revokeBtn.textContent = 'Failed';
      revokeBtn.classList.add('is-error');

      setTimeout(() => {
        revokeBtn.textContent = originalText;
        revokeBtn.classList.remove('is-error');
        revokeBtn.disabled = false;
      }, 2000);
    }
  }

  async checkTokenStatus() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_TOKEN_STATUS',
        sfHost: this.sfHost
      });

      if (response && response.success && response.data && response.data.hasToken && !response.data.isExpired) {
        this.hasToken = true;
      } else {
        this.hasToken = false;
      }
      this.renderTokenRow(this.hasToken);
    } catch (error) {
      this.hasToken = false;
      this.renderTokenRow(false);
    }
  }

  renderTokenRow(hasToken) {
    const pill = document.getElementById('tokenPill');
    const genBtn = document.getElementById('generateTokenBtn');
    const revokeBtn = document.getElementById('revokeTokenBtn');

    if (pill) {
      pill.textContent = hasToken ? 'Active' : 'None';
      pill.classList.toggle('active', hasToken);
    }
    // Show exactly one action: Generate when no token, Revoke when present
    if (genBtn) genBtn.style.display = hasToken ? 'none' : 'block';
    if (revokeBtn) revokeBtn.style.display = hasToken ? 'block' : 'none';
  }

  // Errors go to a visible line in the popup (not only to the console)
  showError(message) {
    const errorEl = document.getElementById('popupError');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  clearError() {
    const errorEl = document.getElementById('popupError');
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.hidden = true;
  }

  showOrgInfo(orgName) {
    const statusCard = document.getElementById('statusCard');
    const orgNameElement = document.getElementById('orgName');

    if (!statusCard || !orgNameElement) return;

    if (orgName) {
      // Clean up the org name (remove protocol and paths)
      const cleanOrgName = orgName.replace(/^https?:\/\//, '').split('/')[0];
      orgNameElement.textContent = cleanOrgName;
      statusCard.style.display = 'block';
    } else {
      statusCard.style.display = 'none';
    }
  }

  hideOrgInfo() {
    const statusCard = document.getElementById('statusCard');
    if (statusCard) {
      statusCard.style.display = 'none';
    }
    this.stopCountdown();
  }

  // --- Debug-logging status + countdown ---

  async refreshLoggingStatus() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_TRACE_FLAG_STATUS',
        sfHost: this.sfHost
      });
      const data = (response && response.success) ? response.data : { active: false };
      this.renderLoggingStatus(data);
    } catch (error) {
      this.renderLoggingStatus({ active: false });
    }
  }

  renderLoggingStatus(data) {
    const dot = document.getElementById('loggingDot');
    const label = document.getElementById('loggingStatusText');
    const enableBtn = document.getElementById('enableLoggingBtn');
    const countdown = document.getElementById('loggingCountdown');

    this.stopCountdown();

    if (data && data.active && data.expirationDate) {
      if (dot) { dot.classList.add('active'); dot.classList.remove('warning'); }
      if (label) label.textContent = 'Logging active';
      if (enableBtn) enableBtn.textContent = 'Extend';
      this.startCountdown(new Date(data.expirationDate).getTime());
    } else {
      if (dot) { dot.classList.remove('active'); dot.classList.remove('warning'); }
      if (label) {
        // A trace flag can also be scheduled to start later
        label.textContent = data && data.scheduled && data.startTime
          ? `Logging starts at ${new Date(data.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
          : 'Logging off';
      }
      if (enableBtn) enableBtn.textContent = 'Enable';
      if (countdown) { countdown.textContent = ''; countdown.classList.remove('warning'); }
    }
  }

  startCountdown(expirationMs) {
    const countdown = document.getElementById('loggingCountdown');
    if (!countdown) return;

    const dot = document.getElementById('loggingDot');
    const tick = () => {
      const remaining = expirationMs - Date.now();
      if (remaining <= 0) {
        this.renderLoggingStatus({ active: false });
        return;
      }
      const totalSeconds = Math.floor(remaining / 1000);
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      countdown.textContent = `${mins}:${String(secs).padStart(2, '0')}`;

      // Amber warning when under 5 minutes remain
      const warn = remaining < 5 * 60 * 1000;
      countdown.classList.toggle('warning', warn);
      if (dot) dot.classList.toggle('warning', warn);
    };

    tick();
    this.countdownInterval = setInterval(tick, 1000);
  }

  stopCountdown() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  async enableLogging() {
    const btn = document.getElementById('enableLoggingBtn');
    if (!btn) return;

    // Enabling/extending requires an OAuth token - nudge the user instead of failing silently
    if (!this.hasToken) {
      this.nudgeGenerateToken();
      return;
    }

    const durationSelect = document.getElementById('durationSelect');
    const durationMinutes = durationSelect ? parseInt(durationSelect.value, 10) : 15;
    const originalText = btn.textContent;

    try {
      btn.disabled = true;
      btn.textContent = '...';
      this.clearError();

      const response = await chrome.runtime.sendMessage({
        type: 'ENSURE_TRACE_FLAG',
        sfHost: this.sfHost,
        durationMinutes: durationMinutes,
        force: true
      });

      if (response && response.success) {
        await this.refreshLoggingStatus();
      } else if (response && response.error && response.error.includes('OAuth token')) {
        this.hasToken = false;
        this.nudgeGenerateToken();
      } else {
        throw new Error(response?.error || 'Failed to enable logging');
      }
    } catch (error) {
      console.error('Failed to enable logging:', error);
      this.showError(`Could not turn on logging: ${error.message}`);
    } finally {
      btn.disabled = false;
      // refreshLoggingStatus resets the label; restore it if that path didn't run
      if (btn.textContent === '...') btn.textContent = originalText;
    }
  }

  nudgeGenerateToken() {
    const genBtn = document.getElementById('generateTokenBtn');
    const label = document.getElementById('loggingStatusText');
    if (label) label.textContent = 'Generate a token first';
    if (genBtn) {
      genBtn.classList.add('nudge');
      setTimeout(() => genBtn.classList.remove('nudge'), 1600);
    }
  }

  async showDashboardNavigationButtons(sfHost) {
    const mainBtn = document.getElementById('openDashboardBtn');
    const setupBtn = document.getElementById('goToSetupBtn');

    if (mainBtn) {
      (mainBtn.querySelector('span') || mainBtn).textContent = 'Go Back Salesforce';
      // Store the host in the button for the click handler
      mainBtn.dataset.sfHost = sfHost;
    }

    if (setupBtn) {
      setupBtn.style.display = 'block';
    }
  }

  async goToSetup() {
    try {
      const sfHost = this.sfHost;

      if (sfHost) {
        const setupUrl = `https://${sfHost}/lightning/setup/SetupOneHome/home`;
        await chrome.tabs.create({ url: setupUrl });
        window.close();
      }
    } catch (error) {
      console.error('Failed to navigate to setup:', error);
    }
  }

  async goBackToSalesforce(sfHost) {
    try {
      const storageKey = `lastSfUrl_${sfHost}`;
      const result = await chrome.storage.local.get([storageKey]);
      const lastUrl = result[storageKey];

      if (lastUrl) {
        // Try to find a tab with this URL first
        const tabs = await chrome.tabs.query({});
        const existingTab = tabs.find(t => t.url === lastUrl);

        if (existingTab) {
          await chrome.tabs.update(existingTab.id, { active: true });
          await chrome.windows.update(existingTab.windowId, { focused: true });
        } else {
          await chrome.tabs.create({ url: lastUrl });
        }
        window.close();
      } else {
        // Fallback: just open the host root
        await chrome.tabs.create({ url: `https://${sfHost}` });
        window.close();
      }
    } catch (error) {
      console.error('Failed to go back to Salesforce:', error);
    }
  }
}


// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new SmartDebugLogPopup();
}); 