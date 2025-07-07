const SALESFORCE_DOMAINS = [
  'salesforce.com',
  'cloudforce.com', 
  'salesforce.mil',
  'cloudforce.mil',
  'sfcrmproducts.cn',
  'force.com'
];

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
          console.log(`Found session cookie for org ${orgId} on ${currentDomain}`);
          
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

      this.domainCache.set(currentDomain, currentDomain);
      return currentDomain;

    } catch (error) {
      const urlObj = new URL(url);
      return urlObj.hostname;
    }
  }

  async getSession(sfHost, tabId = null) {
    try {
      let session = await this.getSessionFromDomain(sfHost, tabId);
      if (session) {
        if (await this.shouldValidateSession(session)) {
          const isValid = await this.validateSession(session);
          session.isValid = isValid;
          
          if (!isValid) {
            console.warn(`Session validation failed for org ${session.orgId}`);
            return null;
          }
        }

        this.sessions.set(session.orgId, session);
        console.log(`Session retrieved for org ${session.orgId} on ${sfHost}`);
        return session;
      }
      
      const apiDomain = this.getApiEnabledDomain(sfHost);
      if (apiDomain !== sfHost) {
        session = await this.getSessionFromDomain(apiDomain, tabId);
        if (session) {
          session.displayDomain = sfHost;
          session.apiDomain = apiDomain;
          
          if (await this.shouldValidateSession(session)) {
            const isValid = await this.validateSession(session);
            session.isValid = isValid;
            
            if (!isValid) {
              console.warn(`Session validation failed for org ${session.orgId}`);
              return null;
            }
          }

          this.sessions.set(session.orgId, session);
          console.log(`Session retrieved for org ${session.orgId} on API domain ${apiDomain} (requested: ${sfHost})`);
          return session;
        }
      }
      
      const relatedDomains = this.getRelatedDomains(sfHost);
      for (const domain of relatedDomains) {
        session = await this.getSessionFromDomain(domain, tabId);
        if (session) {
          session.displayDomain = sfHost;
          session.apiDomain = domain;
          
          if (await this.shouldValidateSession(session)) {
            const isValid = await this.validateSession(session);
            session.isValid = isValid;
            
            if (!isValid) {
              console.warn(`Session validation failed for org ${session.orgId}`);
              continue;
            }
          }

          this.sessions.set(session.orgId, session);
          console.log(`Session retrieved for org ${session.orgId} on related domain ${domain} (requested: ${sfHost})`);
          return session;
        }
      }
      
      console.log(`No valid session found for ${sfHost} or any related domains`);
      return null;

    } catch (error) {
      console.error('Failed to get session:', error);
      return null;
    }
  }

  getAllSessions() {
    return Array.from(this.sessions.values()).filter(session => session.isValid);
  }

  getSessionByOrgId(orgId) {
    return this.sessions.get(orgId) || null;
  }

  async refreshSession(orgId) {
    try {
      const session = this.sessions.get(orgId);
      if (!session) {
        console.warn(`No session found for org ${orgId}`);
        return false;
      }

      session.lastUsed = Date.now();
      
      const isValid = await this.validateSession(session);
      session.isValid = isValid;

      if (isValid) {
        console.log(`Session refreshed for org ${orgId}`);
        return true;
      } else {
        console.warn(`Session validation failed for org ${orgId}`);
        this.sessions.delete(orgId);
        return false;
      }

    } catch (error) {
      console.error('Failed to refresh session:', error);
      return false;
    }
  }

  async cleanupSessions() {
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000;
    
    for (const [orgId, session] of this.sessions.entries()) {
      if (now - session.lastUsed > maxAge || !session.isValid) {
        console.log(`Cleaning up expired session for org ${orgId}`);
        this.sessions.delete(orgId);
      }
    }
  }

  clearAllSessions() {
    this.sessions.clear();
    this.domainCache.clear();
    console.log('All sessions cleared');
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

  async findMatchingDomain(orgId, storeId) {
    const searchPromises = SALESFORCE_DOMAINS.map(async domain => {
      const cookies = await this.getAllCookies(domain, 'sid', storeId);
      
      const matchingCookie = cookies.find(cookie => 
        cookie.value.startsWith(orgId + '!') && 
        cookie.domain !== 'help.salesforce.com'
      );

      return matchingCookie ? matchingCookie.domain : null;
    });

    const results = await Promise.all(searchPromises);
    return results.find(domain => domain !== null) || null;
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
      
      const response = await fetch(`https://${apiDomain}/services/data/v58.0/limits`, {
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