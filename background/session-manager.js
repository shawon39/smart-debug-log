const SALESFORCE_DOMAINS = [
  'salesforce.com',
  'salesforce-setup.com',
  'cloudforce.com',
  'salesforce.mil',
  'cloudforce.mil',
  'sfcrmproducts.cn',
  'force.com'
];

const SALESFORCE_API_VERSION = 'v62.0';

const DOMAIN_MAPPINGS = {
  '.lightning.force.com': '.my.salesforce.com',
  '.develop.lightning.force.com': '.develop.my.salesforce.com',
  '.sandbox.lightning.force.com': '.sandbox.my.salesforce.com',
  '.visual.force.com': '.my.salesforce.com',
  '.develop.visual.force.com': '.develop.my.salesforce.com',
  '.sandbox.visual.force.com': '.sandbox.my.salesforce.com',
  '.my.salesforce.com': '.my.salesforce.com',
  '.develop.my.salesforce.com': '.develop.my.salesforce.com'
};

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.domainCache = new Map();
  }

  initialize() {
    // Ready
  }

  getApiEnabledDomain(currentDomain) {
    if (currentDomain.includes('.my.salesforce.com')) {
      return currentDomain;
    }

    for (const [pattern, apiDomain] of Object.entries(DOMAIN_MAPPINGS)) {
      if (currentDomain.includes(pattern)) {
        return currentDomain.replace(pattern, apiDomain);
      }
    }

    return currentDomain;
  }

  getRelatedDomains(sfHost) {
    const domains = new Set();

    const orgMatch = sfHost.match(/^([^.]+(?:\.[^.]+)*)\.(my\.salesforce|lightning\.force|visual\.force)\.com$/);
    if (orgMatch) {
      const orgPrefix = orgMatch[1];

      domains.add(`${orgPrefix}.my.salesforce.com`);
      domains.add(`${orgPrefix}.lightning.force.com`);
      domains.add(`${orgPrefix}.visual.force.com`);

      if (orgPrefix.includes('.develop')) {
        const baseOrg = orgPrefix.replace('.develop', '');
        domains.add(`${baseOrg}.my.salesforce.com`);
        domains.add(`${baseOrg}.lightning.force.com`);
      }

      if (orgPrefix.includes('.sandbox')) {
        const baseOrg = orgPrefix.replace('.sandbox', '');
        domains.add(`${baseOrg}.my.salesforce.com`);
        domains.add(`${baseOrg}.lightning.force.com`);
      }
    }

    return Array.from(domains).filter(domain => domain !== sfHost);
  }

  async getSessionFromDomain(domain, tabId = null) {
    try {
      const cookieStoreId = await this.getCookieStoreId(tabId);
      const sessionCookie = await this.getCookie(`https://${domain}`, 'sid', cookieStoreId);

      if (!sessionCookie) {
        return null;
      }

      const [orgId, ...sessionParts] = sessionCookie.value.split('!');

      if (!orgId || sessionParts.length === 0) {
        return null;
      }


      const sessionData = {
        key: sessionCookie.value,
        hostname: sessionCookie.domain,
        orgId: orgId,
        sessionId: sessionCookie.value,
        sessionToken: sessionParts[0],
        created: Date.now(),
        lastUsed: Date.now(),
        isValid: true,
        domain: domain
      };

      return sessionData;

    } catch (error) {
      return null;
    }
  }

  async getSalesforceHost(url, tabId = null) {
    try {
      const urlObj = new URL(url);
      const currentDomain = urlObj.hostname;

      if (this.domainCache.has(currentDomain)) {
        return this.domainCache.get(currentDomain);
      }

      if (currentDomain.endsWith('.mcas.ms')) {
        this.domainCache.set(currentDomain, currentDomain);
        return currentDomain;
      }

      const cookieStoreId = await this.getCookieStoreId(tabId);
      const currentCookie = await this.getCookie(url, 'sid', cookieStoreId);

      if (currentCookie) {
        const [orgId] = currentCookie.value.split('!');
        if (orgId) {

          const apiDomain = await this.findApiEnabledDomain(orgId, cookieStoreId);
          const effectiveDomain = apiDomain || currentDomain;

          this.domainCache.set(currentDomain, effectiveDomain);
          return effectiveDomain;
        }
      }

      const isSalesforce = SALESFORCE_DOMAINS.some(domain => currentDomain.includes(domain));

      if (isSalesforce) {
        this.domainCache.set(currentDomain, currentDomain);
        return currentDomain;
      }

      // Not a Salesforce URL - return null to indicate this
      return null;

    } catch (error) {
      // Return null for invalid/non-Salesforce URLs
      return null;
    }
  }

  async getSession(sfHost, tabId = null, skipValidation = false) {
    try {
      // First check if we have a cached session for this host
      let session = await this.getSessionFromDomain(sfHost, tabId);
      if (session && session.orgId) {
        const cachedSession = this.sessions.get(session.orgId);
        if (cachedSession && cachedSession.key === session.key) {
          // Use cached session if the key matches (same login session)
          return cachedSession;
        }
      }

      // If no cache or different session, proceed with fresh session
      if (session) {
        if (!skipValidation && await this.shouldValidateSession(session)) {
          const isValid = await this.validateSession(session);
          session.isValid = isValid;

          // Don't return null on validation failure - just mark as invalid
          // This allows popup to still show org info even if API validation fails
        }

        this.sessions.set(session.orgId, session);
        return session;
      }

      const apiDomain = this.getApiEnabledDomain(sfHost);
      if (apiDomain !== sfHost) {
        session = await this.getSessionFromDomain(apiDomain, tabId);
        if (session) {
          session.displayDomain = sfHost;
          session.apiDomain = apiDomain;

          if (!skipValidation && await this.shouldValidateSession(session)) {
            const isValid = await this.validateSession(session);
            session.isValid = isValid;

            // Don't return null on validation failure
          }

          this.sessions.set(session.orgId, session);
          return session;
        }
      }

      const relatedDomains = this.getRelatedDomains(sfHost);
      for (const domain of relatedDomains) {
        session = await this.getSessionFromDomain(domain, tabId);
        if (session) {
          session.displayDomain = sfHost;
          session.apiDomain = domain;

          if (!skipValidation && await this.shouldValidateSession(session)) {
            const isValid = await this.validateSession(session);
            session.isValid = isValid;

            // Don't skip to next domain on validation failure
            // The session cookie is valid even if API check fails
          }

          this.sessions.set(session.orgId, session);
          return session;
        }
      }

      return null;

    } catch (error) {
      return null;
    }
  }

  async getCookieStoreId(tabId) {
    if (!tabId) return undefined;

    try {
      const tab = await chrome.tabs.get(tabId);
      return tab.cookieStoreId;
    } catch (error) {
      return undefined;
    }
  }

  async getCookie(url, name, storeId = undefined) {
    try {
      const cookie = await chrome.cookies.get({
        url: url,
        name: name,
        storeId: storeId
      });
      return cookie;
    } catch (error) {
      return null;
    }
  }

  async getAllCookies(domain, name = 'sid', storeId = undefined) {
    try {
      const cookies = await chrome.cookies.getAll({
        name: name,
        domain: domain,
        secure: true,
        storeId: storeId
      });
      return cookies || [];
    } catch (error) {
      return [];
    }
  }

  async findApiEnabledDomain(orgId, storeId) {
    for (const domain of SALESFORCE_DOMAINS) {
      const cookies = await this.getAllCookies(domain, 'sid', storeId);

      const matchingCookie = cookies.find(cookie =>
        cookie.value.startsWith(orgId + '!') &&
        cookie.domain !== 'help.salesforce.com'
      );

      if (matchingCookie) {
        return matchingCookie.domain;
      }
    }

    return null;
  }

  shouldValidateSession(sessionData) {
    const now = Date.now();
    const lastValidation = sessionData.lastValidated || 0;
    const validationInterval = 10 * 60 * 1000;

    return (now - lastValidation) > validationInterval;
  }

  async validateSession(sessionData) {
    try {
      const apiDomain = sessionData.apiDomain || sessionData.domain;

      const response = await fetch(`https://${apiDomain}/services/data/${SALESFORCE_API_VERSION}/limits`, {
        headers: {
          'Authorization': `Bearer ${sessionData.key}`,
          'Content-Type': 'application/json'
        }
      });

      const isValid = response.ok;
      sessionData.lastValidated = Date.now();

      return isValid;

    } catch (error) {
      return false;
    }
  }
}

const sessionManager = new SessionManager();

export default sessionManager; 