import DebugLogManager from './debug-log-manager.js';
import sessionManager from './session-manager.js';

const debugLogManager = new DebugLogManager();

// OAuth Configuration
//const OAUTH_CLIENT_ID = '3MVG95mg0lk4batiOPo696IEH2HgoU2UEozJEuCiCQBK_UmFAC0G.w2gvRdkxnG9exLIMvUqe6BNJKlr4vIYM';
const OAUTH_CLIENT_ID = '3MVG95mg0lk4batiOPo696IEH2CKKjz0rft6yvoueOIdkjyYyOCS1zj3EzVIKrc5Y25ekBWEZ4omoLZ8T8t79';


// Helper to extract org domain from instanceUrl or sfHost
function extractOrgDomain(urlOrHost) {
  if (!urlOrHost) return null;
  try {
    // Handle full URLs
    if (urlOrHost.startsWith('http')) {
      const url = new URL(urlOrHost);
      return url.hostname.toLowerCase();
    }
    // Already a hostname
    return urlOrHost.toLowerCase();
  } catch {
    return urlOrHost.toLowerCase();
  }
}

// Generate storage key for org-specific token
function getTokenStorageKey(orgDomain) {
  if (!orgDomain) return 'sfOAuthToken'; // Fallback for backwards compatibility
  // Normalize domain: my.salesforce.com domains should be grouped by org
  // e.g., shshawon-dev-ed.my.salesforce.com -> sfOAuthToken_shshawon-dev-ed.my.salesforce.com
  return `sfOAuthToken_${orgDomain}`;
}

// PKCE Utilities
function generateRandomString(length = 43) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, x => chars[x % chars.length]).join('');
}

async function generatePKCEChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function detectLoginBase(orgUrl) {
  // Try to extract My Domain from the org URL and use it directly
  // This avoids CORS issues and works better with SSO configurations
  if (!orgUrl) {
    return 'https://login.salesforce.com';
  }
  
  const lowerUrl = orgUrl.toLowerCase();
  
  // Try to extract My Domain URL patterns:
  // - *.my.salesforce.com (production/dev edition)
  // - *.sandbox.my.salesforce.com (sandbox)
  // - *.scratch.my.salesforce.com (scratch)
  // - *.develop.my.salesforce.com (developer)
  
  // Match patterns like: mydomain.my.salesforce.com, mydomain.sandbox.my.salesforce.com
  const myDomainMatch = lowerUrl.match(/([a-z0-9-]+(?:--[a-z0-9-]+)?(?:\.sandbox|\.scratch|\.develop)?\.my\.salesforce\.com)/i);
  if (myDomainMatch) {
    return `https://${myDomainMatch[1]}`;
  }
  
  // Match lightning.force.com pattern and convert to my.salesforce.com
  // e.g., mydomain.lightning.force.com -> mydomain.my.salesforce.com
  const lightningMatch = lowerUrl.match(/([a-z0-9-]+(?:--[a-z0-9-]+)?)\.lightning\.force\.com/i);
  if (lightningMatch) {
    const domain = lightningMatch[1];
    // Check if it's a sandbox pattern (contains --) 
    if (domain.includes('--')) {
      // Could be sandbox, but dev editions also use -- pattern
      // For dev editions like "shishawon-dev-ed", use .my.salesforce.com
      return `https://${domain}.my.salesforce.com`;
    }
    return `https://${domain}.my.salesforce.com`;
  }
  
  // Fallback: Check for sandbox/scratch patterns for generic login URLs
  if (
    lowerUrl.includes('.sandbox.') ||
    lowerUrl.includes('.scratch.') ||
    lowerUrl.includes('.develop.') ||
    /\.cs\d+\./.test(lowerUrl) ||
    lowerUrl.includes('test.salesforce.com')
  ) {
    return 'https://test.salesforce.com';
  }
  
  return 'https://login.salesforce.com';
}

async function performOAuthLogin(orgUrl) {
  const loginBase = detectLoginBase(orgUrl);
  const redirectUri = chrome.identity.getRedirectURL('salesforce');
  const state = generateRandomString(16);
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generatePKCEChallenge(codeVerifier);
  
  console.log('OAuth: Starting login flow');
  console.log('OAuth: Login base:', loginBase);
  console.log('OAuth: Redirect URI:', redirectUri);
  
  const authUrl = new URL(`${loginBase}/services/oauth2/authorize`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', OAUTH_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'api refresh_token');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  
  // Launch the OAuth flow
  const redirectResponse = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true
  });
  
  if (!redirectResponse) {
    throw new Error('User closed the authentication window or auth failed');
  }
  
  console.log('OAuth: Got redirect response');
  
  const responseUrl = new URL(redirectResponse);
  const returnedState = responseUrl.searchParams.get('state');
  
  if (returnedState !== state) {
    throw new Error('State mismatch - possible CSRF attack');
  }
  
  const code = responseUrl.searchParams.get('code');
  if (!code) {
    const error = responseUrl.searchParams.get('error');
    const errorDesc = responseUrl.searchParams.get('error_description');
    throw new Error(errorDesc || error || 'No authorization code returned from Salesforce');
  }
  
  console.log('OAuth: Exchanging code for token');
  
  // Exchange authorization code for access token
  const tokenResponse = await fetch(`${loginBase}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: OAUTH_CLIENT_ID,
      code: code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
  });
  
  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error('Token exchange failed: ' + errorText);
  }
  
  const tokens = await tokenResponse.json();
  console.log('OAuth: Token received successfully');
  
  // Store the tokens with org-specific key
  const tokenData = {
    accessToken: tokens.access_token,
    instanceUrl: tokens.instance_url,
    refreshToken: tokens.refresh_token || null,
    issuedAt: Number(tokens.issued_at),
    tokenType: tokens.token_type,
    id: tokens.id
  };
  
  // Store token per org domain for multi-org support
  const orgDomain = extractOrgDomain(tokens.instance_url);
  const storageKey = getTokenStorageKey(orgDomain);
  
  console.log('OAuth: Storing token for org:', orgDomain);
  await chrome.storage.local.set({ [storageKey]: tokenData });
  
  // Also store as default for backwards compatibility (last authenticated org)
  await chrome.storage.local.set({ sfOAuthToken: tokenData });
  
  return tokenData;
}

async function handleGenerateToken(request, sender) {
  try {
    const tokens = await performOAuthLogin(request.orgUrl);
    return { 
      success: true, 
      data: {
        instanceUrl: tokens.instanceUrl,
        issuedAt: tokens.issuedAt
      }
    };
  } catch (error) {
    console.error('OAuth error:', error);
    return {
      success: false,
      error: error.message || 'Failed to generate access token'
    };
  }
}

// Token expiration check (Salesforce tokens typically expire in 2 hours = 7200000ms)
const TOKEN_EXPIRY_BUFFER = 5 * 60 * 1000; // 5 minutes buffer before actual expiry
const TOKEN_LIFETIME = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

function isTokenExpired(token) {
  if (!token || !token.issuedAt) return true;
  const expiresAt = token.issuedAt + TOKEN_LIFETIME - TOKEN_EXPIRY_BUFFER;
  return Date.now() > expiresAt;
}

// Refresh access token using refresh_token
async function refreshAccessToken(token) {
  if (!token || !token.refreshToken || !token.instanceUrl) {
    throw new Error('NO_REFRESH_TOKEN');
  }
  
  console.log('OAuth: Refreshing access token');
  
  const response = await fetch(`${token.instanceUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: OAUTH_CLIENT_ID,
      refresh_token: token.refreshToken
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('OAuth: Token refresh failed:', errorText);
    // Clear stored token if refresh fails (user needs to re-authenticate)
    const orgDomain = extractOrgDomain(token.instanceUrl);
    const storageKey = getTokenStorageKey(orgDomain);
    await chrome.storage.local.remove([storageKey, 'sfOAuthToken']);
    throw new Error('TOKEN_REFRESH_FAILED');
  }
  
  const newTokens = await response.json();
  console.log('OAuth: Token refreshed successfully');
  
  // Update stored token with new access token
  const updatedToken = {
    accessToken: newTokens.access_token,
    instanceUrl: newTokens.instance_url || token.instanceUrl,
    refreshToken: newTokens.refresh_token || token.refreshToken, // Some orgs return new refresh token
    issuedAt: Date.now(), // Use current time as issued time
    tokenType: newTokens.token_type || token.tokenType,
    id: newTokens.id || token.id
  };
  
  // Store token per org domain for multi-org support
  const orgDomain = extractOrgDomain(updatedToken.instanceUrl);
  const storageKey = getTokenStorageKey(orgDomain);
  await chrome.storage.local.set({ [storageKey]: updatedToken, sfOAuthToken: updatedToken });
  
  return updatedToken;
}

// Helper to get stored OAuth token for specific org (with auto-refresh if expired)
// sfHost: The Salesforce host to get token for (e.g., 'myorg.my.salesforce.com')
async function getStoredOAuthToken(sfHost = null) {
  try {
    let token = null;
    
    // If sfHost is provided, try to get org-specific token first
    if (sfHost) {
      const orgDomain = extractOrgDomain(sfHost);
      const storageKey = getTokenStorageKey(orgDomain);
      const result = await chrome.storage.local.get(storageKey);
      token = result[storageKey];
      
      // If no org-specific token, check if default token matches the org
      if (!token) {
        const defaultResult = await chrome.storage.local.get('sfOAuthToken');
        const defaultToken = defaultResult.sfOAuthToken;
        if (defaultToken && defaultToken.instanceUrl) {
          const defaultDomain = extractOrgDomain(defaultToken.instanceUrl);
          // Only use default if it matches the requested org
          if (defaultDomain === orgDomain) {
            token = defaultToken;
          }
        }
      }
      
      // Verify token is for the correct org
      if (token && token.instanceUrl) {
        const tokenDomain = extractOrgDomain(token.instanceUrl);
        if (tokenDomain !== orgDomain) {
          console.warn(`OAuth: Token domain mismatch. Expected ${orgDomain}, got ${tokenDomain}`);
          return null; // Wrong org, need re-authentication
        }
      }
    } else {
      // No sfHost specified, use default token (backwards compatibility)
      const result = await chrome.storage.local.get('sfOAuthToken');
      token = result.sfOAuthToken;
    }
    
    if (!token || !token.accessToken || !token.instanceUrl) {
      return null;
    }
    
    // Check if token is expired and auto-refresh if needed
    if (isTokenExpired(token)) {
      console.log('OAuth: Token expired, attempting refresh');
      try {
        token = await refreshAccessToken(token);
      } catch (refreshError) {
        console.error('OAuth: Auto-refresh failed:', refreshError.message);
        return null; // Token is invalid, user needs to re-authenticate
      }
    }
    
    return token;
  } catch (error) {
    console.debug('Failed to get OAuth token:', error.message);
  }
  return null;
}

// Direct API call functions - bypass content scripts when OAuth token is available
const API_VERSION = 'v62.0';

async function directToolingQuery(query, sfHost = null) {
  const token = await getStoredOAuthToken(sfHost);
  if (!token) {
    throw new Error('NO_OAUTH_TOKEN');
  }
  
  const url = `${token.instanceUrl}/services/data/${API_VERSION}/tooling/query/?q=${encodeURIComponent(query)}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tooling query failed: ${response.status} - ${errorText}`);
  }
  
  return response.json();
}

async function directToolingCreate(sobjectType, data, sfHost = null) {
  const token = await getStoredOAuthToken(sfHost);
  if (!token) {
    throw new Error('NO_OAUTH_TOKEN');
  }
  
  const url = `${token.instanceUrl}/services/data/${API_VERSION}/tooling/sobjects/${sobjectType}/`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tooling create failed: ${response.status} - ${errorText}`);
  }
  
  return response.json();
}

async function directToolingUpdate(sobjectType, recordId, data, sfHost = null) {
  const token = await getStoredOAuthToken(sfHost);
  if (!token) {
    throw new Error('NO_OAUTH_TOKEN');
  }
  
  const url = `${token.instanceUrl}/services/data/${API_VERSION}/tooling/sobjects/${sobjectType}/${recordId}`;
  
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tooling update failed: ${response.status} - ${errorText}`);
  }
  
  // PATCH returns 204 No Content on success
  return { success: true };
}

async function directToolingDelete(sobjectType, recordId, sfHost = null) {
  const token = await getStoredOAuthToken(sfHost);
  if (!token) {
    throw new Error('NO_OAUTH_TOKEN');
  }
  
  const url = `${token.instanceUrl}/services/data/${API_VERSION}/tooling/sobjects/${sobjectType}/${recordId}`;
  
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token.accessToken}`,
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tooling delete failed: ${response.status} - ${errorText}`);
  }
  
  // DELETE returns 204 No Content on success
  return { success: true };
}

async function directToolingDescribe(sobjectType, sfHost = null) {
  const token = await getStoredOAuthToken(sfHost);
  if (!token) {
    throw new Error('NO_OAUTH_TOKEN');
  }
  
  const url = `${token.instanceUrl}/services/data/${API_VERSION}/tooling/sobjects/${sobjectType}/describe/`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token.accessToken}`,
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tooling describe failed: ${response.status} - ${errorText}`);
  }
  
  return response.json();
}

async function directGetLogBody(logId, sfHost = null) {
  const token = await getStoredOAuthToken(sfHost);
  if (!token) {
    throw new Error('NO_OAUTH_TOKEN');
  }
  
  const url = `${token.instanceUrl}/services/data/${API_VERSION}/tooling/sobjects/ApexLog/${logId}/Body/`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token.accessToken}`,
      'Accept': 'text/plain'
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 404) {
      throw new Error(`Debug log not found or expired. Log ID: ${logId}`);
    }
    throw new Error(`Failed to fetch log body: ${response.status} - ${errorText}`);
  }
  
  const content = await response.text();
  return { content, logId };
}

async function directExecuteAnonymous(code, sfHost = null) {
  const token = await getStoredOAuthToken(sfHost);
  if (!token) {
    throw new Error('NO_OAUTH_TOKEN');
  }
  
  const url = `${token.instanceUrl}/services/data/${API_VERSION}/tooling/executeAnonymous/?anonymousBody=${encodeURIComponent(code)}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) {
      throw new Error('Authentication failed. Please regenerate your access token.');
    }
    if (response.status === 403) {
      throw new Error('Insufficient permissions to execute anonymous Apex.');
    }
    throw new Error(`Execute anonymous failed: ${response.status} - ${errorText}`);
  }
  
  return response.json();
}

// Regular SOQL query (non-tooling)
async function directQuery(query, sfHost = null) {
  const token = await getStoredOAuthToken(sfHost);
  if (!token) {
    throw new Error('NO_OAUTH_TOKEN');
  }
  
  const url = `${token.instanceUrl}/services/data/${API_VERSION}/query/?q=${encodeURIComponent(query)}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Query failed: ${response.status} - ${errorText}`);
  }
  
  return response.json();
}

// Simple error check for harmless extension warnings
function checkLastError() {
  if (chrome.runtime.lastError) {
    // Just log the error - no need for complex suppression logic
    console.debug('Extension runtime message:', chrome.runtime.lastError.message);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  try {
    sessionManager.initialize();
    debugLogManager.initialize();
    
    checkLastError();
  } catch (error) {
    console.warn('Extension initialization warning:', error.message);
  }
});

chrome.runtime.onStartup.addListener(() => {
  try {
    sessionManager.initialize();
    debugLogManager.initialize();
    
    checkLastError();
  } catch (error) {
    console.warn('Extension startup warning:', error.message);
  }
});

// Keyboard shortcut command listener (Alt+D / Option+D)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-debug-dashboard') {
    try {
      // Get current active tab to determine SF host
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let sfHost = null;
      
      if (tab && tab.url) {
        sfHost = await sessionManager.getSalesforceHost(tab.url, tab.id);
      }
      
      // Auto-enable debug if possible (use sfHost for org-aware token)
      try {
        const token = await getStoredOAuthToken(sfHost);
        if (token) {
          // Extract user ID
          let userId = null;
          if (token.id) {
            const parts = token.id.split('/');
            if (parts.length >= 2) {
              userId = parts[parts.length - 1];
            }
          }
          
          if (userId) {
            // Check for existing trace flag
            const checkQuery = `SELECT Id, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'USER_DEBUG' ORDER BY ExpirationDate DESC LIMIT 1`;
            const checkResult = await directToolingQuery(checkQuery, sfHost);
            
            let needsNewFlag = true;
            if (checkResult.records && checkResult.records.length > 0) {
              const expiration = new Date(checkResult.records[0].ExpirationDate);
              if (expiration > new Date()) {
                needsNewFlag = false;
              }
            }
            
            if (needsNewFlag) {
              // Get debug level
              const levelQuery = `SELECT Id FROM DebugLevel WHERE DeveloperName = 'SFDC_DevConsole' LIMIT 1`;
              const levelResult = await directToolingQuery(levelQuery, sfHost);
              
              if (levelResult.records && levelResult.records.length > 0) {
                const now = new Date();
                const expiration = new Date(now.getTime() + 60 * 60 * 1000);
                
                await directToolingCreate('TraceFlag', {
                  TracedEntityId: userId,
                  LogType: 'USER_DEBUG',
                  DebugLevelId: levelResult.records[0].Id,
                  StartDate: now.toISOString(),
                  ExpirationDate: expiration.toISOString()
                }, sfHost);
              }
            }
          }
        }
      } catch (e) {
        console.warn('Could not auto-enable debug:', e);
      }
      
      // Open dashboard
      const baseUrl = chrome.runtime.getURL('dashboard.html');
      const dashboardUrl = sfHost ? `${baseUrl}?host=${encodeURIComponent(sfHost)}` : baseUrl;
      
      // Check for existing dashboard tab FOR THE SAME ORG
      const tabs = await chrome.tabs.query({});
      const existingDashboard = tabs.find(t => {
        if (!t.url) return false;
        if (sfHost) {
          // Match dashboard for this specific org
          const targetUrl = `${baseUrl}?host=${encodeURIComponent(sfHost)}`;
          return t.url === targetUrl || t.url.startsWith(targetUrl + '&');
        }
        // No sfHost - match dashboard without host parameter
        return t.url === baseUrl || (t.url.startsWith(baseUrl) && !t.url.includes('?host='));
      });
      
      if (existingDashboard) {
        await chrome.tabs.update(existingDashboard.id, { active: true });
        await chrome.windows.update(existingDashboard.windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: dashboardUrl, active: true });
      }
    } catch (error) {
      console.error('Failed to open dashboard via shortcut:', error);
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true;
});



async function handleMessage(request, sender, sendResponse) {
  try {
    let result;
    switch (request.type) {
      case 'GET_SALESFORCE_HOST':
        result = await handleGetSalesforceHost(request, sender);
        break;
      case 'GET_SESSION':
        result = await handleGetSession(request, sender);
        break;
      case 'GET_RECENT_LOGS':
        result = await handleGetRecentLogs(request, sender);
        break;
      case 'GET_LOG_CONTENT':
        result = await handleGetLogContent(request, sender);
        break;
      case 'EXECUTE_TOOLING_QUERY':
        result = await handleExecuteToolingQuery(request, sender);
        break;
      case 'TOOLING_CREATE':
        result = await handleToolingCreate(request, sender);
        break;
      case 'TOOLING_UPDATE':
        result = await handleToolingUpdate(request, sender);
        break;
      case 'TOOLING_DELETE':
        result = await handleToolingDelete(request, sender);
        break;
      case 'TOOLING_DESCRIBE':
        result = await handleToolingDescribe(request, sender);
        break;
      case 'DOWNLOAD_LOG':
        result = await handleDownloadLog(request, sender);
        break;
      case 'SAVE_APEX_CODE':
        result = await handleSaveApexCode(request, sender);
        break;
      case 'UPDATE_APEX_CODE':
        result = await handleUpdateApexCode(request, sender);
        break;
      case 'GET_APEX_CODES':
        result = await handleGetApexCodes(request, sender);
        break;
      case 'DELETE_APEX_CODE':
        result = await handleDeleteApexCode(request, sender);
        break;
      case 'EXECUTE_ANONYMOUS':
        result = await handleExecuteAnonymous(request, sender);
        break;
      
      case 'SF_GENERATE_TOKEN':
        result = await handleGenerateToken(request, sender);
        break;
      
      case 'GET_USER_INFO':
        result = await handleGetUserInfo(request, sender);
        break;
      
      case 'CHECK_TOKEN_STATUS':
        result = await handleCheckTokenStatus(request, sender);
        break;
      
      case 'ENSURE_TRACE_FLAG':
        result = await handleEnsureTraceFlag(request, sender);
        break;
      
      case 'REVOKE_OAUTH_TOKEN':
        result = await handleRevokeOAuthToken(request, sender);
        break;
      
      case 'SEARCH_USERS':
        result = await handleSearchUsers(request, sender);
        break;

      default:
        result = { success: false, message: `Unknown message type: ${request.type}` };
    }
    sendResponse(result);
  } catch (error) {
    sendResponse({
      success: false,
      error: error.message || 'Unknown error occurred'
    });
  }
}

async function handleGetSalesforceHost(request, sender) {
  try {
    const url = request.url || sender.tab?.url;
    const tabId = request.tabId || sender.tab?.id;
    
    if (!url) {
      return { success: false, message: 'No URL provided' };
    }

    let sfHost = null;
    let extractedFromExtension = false;

    if (url.startsWith('chrome-extension://')) {
      try {
        const urlObj = new URL(url);
        const hostParam = urlObj.searchParams.get('host');
        
        if (hostParam) {
          sfHost = hostParam;
          extractedFromExtension = true;
        }
      } catch (error) {
        // Continue
      }
    }

    if (!sfHost) {
      sfHost = await sessionManager.getSalesforceHost(url, tabId);
    }

    let sessionInfo = null;
    let sessionFound = false;
    
    try {
      const session = await sessionManager.getSession(sfHost, tabId);
      if (session) {
        sessionFound = true;
        sessionInfo = {
          orgId: session.orgId,
          sessionId: session.sessionId ? session.sessionId + '...' : 'NOT_FOUND',
          sessionToken: session.sessionToken ? session.sessionToken.substring(0, 20) + '...' : 'NOT_FOUND',
          hostname: session.hostname,
          domain: session.domain,
          displayDomain: session.displayDomain,
          apiDomain: session.apiDomain,
          isValid: session.isValid,
          hasKey: !!session.key,
          keyLength: session.key ? session.key.length : 0,
          sessionIdLength: session.sessionId ? session.sessionId.length : 0
        };
      }
    } catch (sessionError) {
      // Failed
    }

    return {
      success: true,
      data: {
        salesforceHost: sfHost,
        sessionFound: sessionFound,
        sessionInfo: sessionInfo,
        extractedFromExtension: extractedFromExtension
      }
    };

  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to detect Salesforce host'
    };
  }
}

async function handleGetSession(request, sender) {
  try {
    const sfHost = request.sfHost;
    const tabId = request.tabId || sender.tab?.id;
    
    if (!sfHost) {
      return { success: false, message: 'Salesforce host is required' };
    }

    const session = await sessionManager.getSession(sfHost, tabId);
    
    if (!session) {
      const relatedDomains = sessionManager.getRelatedDomains(sfHost);
      
      for (const domain of relatedDomains) {
        try {
          const relatedSession = await sessionManager.getSessionFromDomain(domain, tabId);
          if (relatedSession) {
            return {
              success: true,
              data: relatedSession
            };
          }
        } catch (relatedError) {
          // Continue
        }
      }
      
      return { success: false, message: 'No session found' };
    }

    return {
      success: true,
      data: session
    };

  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to get session'
    };
  }
}

async function handleGetRecentLogs(request, sender) {
  try {
    const { orgId, limit } = request;
    const logs = await debugLogManager.getRecentLogs(orgId, limit);
    return { success: true, data: logs };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to get recent logs'
    };
  }
}

async function handleGetLogContent(request, sender) {
  try {
    const { logId, sfHost } = request;
    
    if (!logId) {
      return { success: false, message: 'Log ID is required' };
    }

    const result = await directGetLogBody(logId, sfHost);
    return { success: true, data: result };
  } catch (error) {
    if (error.message === 'NO_OAUTH_TOKEN') {
      return { success: false, error: 'Access token required. Please generate an access token first.' };
    }
    return { success: false, error: error.message || 'Failed to get log content' };
  }
}

async function handleExecuteToolingQuery(request, sender) {
  try {
    const { query, sfHost } = request;
    
    if (!query) {
      return { success: false, message: 'Query is required' };
    }

    const result = await directToolingQuery(query, sfHost);
    return { success: true, data: result };
  } catch (error) {
    if (error.message === 'NO_OAUTH_TOKEN') {
      return { success: false, error: 'Access token required. Please generate an access token first.' };
    }
    return { success: false, error: error.message || 'Failed to execute tooling query' };
  }
}

async function handleToolingCreate(request, sender) {
  try {
    const { sobjectType, data, sfHost } = request;
    
    if (!sobjectType) {
      return { success: false, message: 'SObject type is required' };
    }
    
    if (!data) {
      return { success: false, message: 'Data is required' };
    }

    const result = await directToolingCreate(sobjectType, data, sfHost);
    return { success: true, data: result };
  } catch (error) {
    if (error.message === 'NO_OAUTH_TOKEN') {
      return { success: false, error: 'Access token required. Please generate an access token first.' };
    }
    return { success: false, error: error.message || 'Failed to create record via Tooling API' };
  }
}

async function handleToolingUpdate(request, sender) {
  try {
    const { sobjectType, recordId, data, sfHost } = request;
    
    if (!sobjectType) {
      return { success: false, message: 'SObject type is required' };
    }
    
    if (!recordId) {
      return { success: false, message: 'Record ID is required' };
    }
    
    if (!data) {
      return { success: false, message: 'Data is required' };
    }

    const result = await directToolingUpdate(sobjectType, recordId, data, sfHost);
    return { success: true, data: result };
  } catch (error) {
    if (error.message === 'NO_OAUTH_TOKEN') {
      return { success: false, error: 'Access token required. Please generate an access token first.' };
    }
    return { success: false, error: error.message || 'Failed to update record via Tooling API' };
  }
}

async function handleToolingDelete(request, sender) {
  try {
    const { sobjectType, recordId, sfHost } = request;
    
    if (!sobjectType) {
      return { success: false, message: 'SObject type is required' };
    }
    
    if (!recordId) {
      return { success: false, message: 'Record ID is required' };
    }

    const result = await directToolingDelete(sobjectType, recordId, sfHost);
    return { success: true, data: result };
  } catch (error) {
    if (error.message === 'NO_OAUTH_TOKEN') {
      return { success: false, error: 'Access token required. Please generate an access token first.' };
    }
    return { success: false, error: error.message || 'Failed to delete record via Tooling API' };
  }
}

async function handleToolingDescribe(request, sender) {
  try {
    const { sobjectType, sfHost } = request;
    
    if (!sobjectType) {
      return { success: false, message: 'SObject type is required' };
    }

    const result = await directToolingDescribe(sobjectType, sfHost);
    return { success: true, data: result };
  } catch (error) {
    if (error.message === 'NO_OAUTH_TOKEN') {
      return { success: false, error: 'Access token required. Please generate an access token first.' };
    }
    return { success: false, error: error.message || 'Failed to describe SObject via Tooling API' };
  }
}

async function handleDownloadLog(request, sender) {
  try {
    const { logId, session } = request;
    
    if (!logId || !session) {
      return { success: false, message: 'Log ID and session are required' };
    }

    await debugLogManager.downloadLogContent(logId, session);
    return { success: true, message: 'Log content downloaded successfully' };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to download log content'
    };
  }
}

// Apex Code Management Functions
async function handleSaveApexCode(request, sender) {
  try {
    const { name, code, orgId } = request;
    
    if (!name || !code) {
      return { success: false, message: 'Name and code are required' };
    }

    const saved = await saveApexCodeToStorage({
      name,
      code,
      orgId: orgId || 'unknown',
      timestamp: Date.now()
    });

    return { success: true, message: 'Apex code saved successfully', data: saved };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to save Apex code'
    };
  }
}

async function handleGetApexCodes(request, sender) {
  try {
    const { orgId } = request;
    const codes = await getApexCodesFromStorage(orgId);
    return { success: true, data: codes };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to get Apex codes'
    };
  }
}

async function handleUpdateApexCode(request, sender) {
  try {
    const { id, name, code, orgId } = request;
    
    if (!id || !name || !code) {
      return { success: false, message: 'ID, name and code are required' };
    }

    const updated = await updateApexCodeInStorage({
      id,
      name,
      code,
      orgId: orgId || 'unknown',
      timestamp: Date.now()
    });

    return { success: true, message: 'Apex code updated successfully', data: updated };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to update Apex code'
    };
  }
}

async function handleDeleteApexCode(request, sender) {
  try {
    const { id } = request;
    await deleteApexCodeFromStorage(id);
    return { success: true, message: 'Apex code deleted successfully' };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to delete Apex code'
    };
  }
}

async function handleExecuteAnonymous(request, sender) {
  try {
    const { code, sfHost } = request;
    
    if (!code) {
      return { success: false, message: 'Code is required' };
    }

    const result = await directExecuteAnonymous(code, sfHost);
    return { success: true, data: result };
  } catch (error) {
    if (error.message === 'NO_OAUTH_TOKEN') {
      return { success: false, error: 'Access token required. Please generate an access token first.' };
    }
    return { success: false, error: error.message || 'Failed to execute anonymous Apex' };
  }
}

async function handleGetUserInfo(request, sender) {
  try {
    const { sfHost } = request;
    const token = await getStoredOAuthToken(sfHost);
    if (!token) {
      return { success: false, error: 'No OAuth token available. Please generate an access token first.' };
    }
    
    // Extract user ID from token.id which is in format: https://login.salesforce.com/id/ORGID/USERID
    let userId = null;
    let orgId = null;
    
    if (token.id) {
      const parts = token.id.split('/');
      if (parts.length >= 2) {
        userId = parts[parts.length - 1];
        orgId = parts[parts.length - 2];
      }
    }
    
    return {
      success: true,
      data: {
        userId,
        orgId,
        instanceUrl: token.instanceUrl
      }
    };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to get user info' };
  }
}

// Check if OAuth token exists for the given org
async function handleCheckTokenStatus(request, sender) {
  try {
    const { sfHost } = request;
    const token = await getStoredOAuthToken(sfHost);
    
    if (!token) {
      return { 
        success: true, 
        data: { 
          hasToken: false,
          message: 'No access token for this org'
        } 
      };
    }
    
    // Token exists - check if it's still valid (not expired)
    const isExpired = isTokenExpired(token);
    
    return {
      success: true,
      data: {
        hasToken: true,
        isExpired: isExpired,
        instanceUrl: token.instanceUrl
      }
    };
  } catch (error) {
    return { 
      success: false, 
      error: error.message || 'Failed to check token status',
      data: { hasToken: false }
    };
  }
}

async function handleEnsureTraceFlag(request, sender) {
  try {
    const { sfHost } = request;
    const token = await getStoredOAuthToken(sfHost);
    if (!token) {
      return { success: false, error: 'No OAuth token available. Please generate an access token first.' };
    }
    
    // Extract user ID from token
    let userId = null;
    if (token.id) {
      const parts = token.id.split('/');
      if (parts.length >= 2) {
        userId = parts[parts.length - 1];
      }
    }
    
    if (!userId) {
      return { success: false, error: 'Could not determine user ID' };
    }
    
    // Check for existing active trace flag
    const checkQuery = `SELECT Id, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'USER_DEBUG' ORDER BY ExpirationDate DESC LIMIT 1`;
    const checkResult = await directToolingQuery(checkQuery, sfHost);
    
    if (checkResult.records && checkResult.records.length > 0) {
      const traceFlag = checkResult.records[0];
      const expiration = new Date(traceFlag.ExpirationDate);
      const now = new Date();
      
      // If still active, return success
      if (expiration > now) {
        return { success: true, data: { existing: true, traceFlagId: traceFlag.Id } };
      }
    }
    
    // Get default debug level (SFDC_DevConsole)
    const levelQuery = `SELECT Id FROM DebugLevel WHERE DeveloperName = 'SFDC_DevConsole' LIMIT 1`;
    const levelResult = await directToolingQuery(levelQuery, sfHost);
    
    let debugLevelId;
    if (levelResult.records && levelResult.records.length > 0) {
      debugLevelId = levelResult.records[0].Id;
    } else {
      // Get any available debug level
      const anyLevelQuery = `SELECT Id FROM DebugLevel LIMIT 1`;
      const anyLevelResult = await directToolingQuery(anyLevelQuery, sfHost);
      if (anyLevelResult.records && anyLevelResult.records.length > 0) {
        debugLevelId = anyLevelResult.records[0].Id;
      } else {
        return { success: false, error: 'No debug level found' };
      }
    }
    
    // Create new trace flag for 60 minutes
    const now = new Date();
    const expiration = new Date(now.getTime() + 60 * 60 * 1000);
    
    const traceFlagData = {
      TracedEntityId: userId,
      LogType: 'USER_DEBUG',
      DebugLevelId: debugLevelId,
      StartDate: now.toISOString(),
      ExpirationDate: expiration.toISOString()
    };
    
    const createResult = await directToolingCreate('TraceFlag', traceFlagData, sfHost);
    return { success: true, data: { created: true, traceFlagId: createResult.id } };
    
  } catch (error) {
    // If trace flag already exists error, consider it a success
    if (error.message && error.message.includes('already being traced')) {
      return { success: true, data: { existing: true } };
    }
    return { success: false, error: error.message || 'Failed to ensure trace flag' };
  }
}

async function handleSearchUsers(request, sender) {
  try {
    const { searchTerm, sfHost } = request;
    
    if (!searchTerm || searchTerm.trim().length < 2) {
      return { success: false, error: 'Search term must be at least 2 characters' };
    }
    
    // Search users by name or username (using standard REST API, not Tooling)
    const escapedTerm = searchTerm.replace(/'/g, "\\'");
    const query = `SELECT Id, Name, Username, Email FROM User WHERE (Name LIKE '%${escapedTerm}%' OR Username LIKE '%${escapedTerm}%') AND IsActive = true ORDER BY Name LIMIT 10`;
    
    const result = await directQuery(query, sfHost);
    return { success: true, data: result.records || [] };
    
  } catch (error) {
    if (error.message === 'NO_OAUTH_TOKEN') {
      return { success: false, error: 'Access token required. Please generate an access token first.' };
    }
    return { success: false, error: error.message || 'Failed to search users' };
  }
}

async function handleRevokeOAuthToken(request, sender) {
  try {
    const { sfHost } = request;
    
    // Determine storage keys to remove
    const keysToRemove = ['sfOAuthToken']; // Always remove default token
    
    if (sfHost) {
      const orgDomain = extractOrgDomain(sfHost);
      const storageKey = getTokenStorageKey(orgDomain);
      // Add org-specific key if different from default
      if (storageKey !== 'sfOAuthToken') {
        keysToRemove.push(storageKey);
      }
    }
    
    // Remove all token keys
    await chrome.storage.local.remove(keysToRemove);
    
    return { 
      success: true, 
      message: 'Access token revoked successfully'
    };
  } catch (error) {
    return { 
      success: false, 
      error: error.message || 'Failed to revoke token' 
    };
  }
}

// Storage Functions
async function saveApexCodeToStorage(apexData) {
  const id = `apex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const storageKey = `apexCodes_${apexData.orgId}`;
  
  const result = await chrome.storage.local.get(storageKey);
  const codes = result[storageKey] || [];
  
  const record = {
    id,
    ...apexData
  };
  codes.push(record);
  
  await chrome.storage.local.set({ [storageKey]: codes });
  return record;
}

async function getApexCodesFromStorage(orgId) {
  const storageKey = `apexCodes_${orgId}`;
  const result = await chrome.storage.local.get(storageKey);
  return result[storageKey] || [];
}

async function updateApexCodeInStorage(apexData) {
  const allKeys = await chrome.storage.local.get();
  
  for (const key of Object.keys(allKeys)) {
    if (key.startsWith('apexCodes_')) {
      const codes = allKeys[key];
      const codeIndex = codes.findIndex(code => code.id === apexData.id);
      
      if (codeIndex !== -1) {
        // Update existing code
        const updated = {
          ...codes[codeIndex],
          ...apexData,
          timestamp: Date.now() // Update timestamp
        };
        codes[codeIndex] = updated;
        await chrome.storage.local.set({ [key]: codes });
        return updated;
      }
    }
  }
  
  // If code not found, throw error
  throw new Error('Apex code not found for update');
}

async function deleteApexCodeFromStorage(id) {
  const allKeys = await chrome.storage.local.get();
  
  for (const key of Object.keys(allKeys)) {
    if (key.startsWith('apexCodes_')) {
      const codes = allKeys[key];
      const updatedCodes = codes.filter(code => code.id !== id);
      
      if (updatedCodes.length !== codes.length) {
        await chrome.storage.local.set({ [key]: updatedCodes });
        break;
      }
    }
  }
}
