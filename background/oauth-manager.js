/**
 * OAuth Manager Module
 * Handles Salesforce OAuth flows, token storage, and token lifecycle management.
 */

// OAuth Configuration

// Salesforce production edition
const OAUTH_CLIENT_ID = '3MVG95mg0lk4batiOPo696IEH2HgoU2UEozJEuCiCQBK_UmFAC0G.w2gvRdkxnG9exLIMvUqe6BNJKlr4vIYM';

// Scopes requested at login. To let "Incognito Login" use a one-time
// login link (/services/oauth2/singleaccess) instead of a link with the session ID, add 'web'
// here, but only after the connected app allows the web scope: login fails when the app does
// not allow every requested scope.
const OAUTH_SCOPES = 'api refresh_token';

// Optional consumer key of the user's own connected app or External Client App
const CLIENT_ID_STORAGE_KEY = 'oauthClientId';

// Older versions also kept a copy of the last token under this shared key
const LEGACY_TOKEN_KEY = 'sfOAuthToken';

const ADMIN_INSTALL_FIX = 'Ask your Salesforce admin to install the app: Setup > Connected Apps OAuth Usage > find the app > Install, then set who can use it.';

// Helper to extract org domain from instanceUrl or sfHost
export function extractOrgDomain(urlOrHost) {
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

// My Domain hosts accept OAuth logins as they are
const MY_DOMAIN_SUFFIXES = ['.my.salesforce.com', '.my.salesforce.mil', '.my.sfcrmproducts.cn'];
// Other org hosts map to their My Domain host by suffix, so .sandbox/.develop/.scratch stay
const LOGIN_HOST_SUFFIXES = [
    ['.lightning.force.com', '.my.salesforce.com'],
    ['.my.salesforce-setup.com', '.my.salesforce.com']
];

export function detectLoginBase(orgUrl) {
    if (!orgUrl) {
        return 'https://login.salesforce.com';
    }

    // Hostname only; Microsoft Defender for Cloud Apps proxies add ".mcas.ms"
    const host = extractOrgDomain(orgUrl).split('/')[0].replace(/\.mcas\.ms$/, '');

    if (MY_DOMAIN_SUFFIXES.some(suffix => host.endsWith(suffix))) {
        return `https://${host}`;
    }

    for (const [suffix, loginSuffix] of LOGIN_HOST_SUFFIXES) {
        if (host.endsWith(suffix)) {
            return `https://${host.slice(0, -suffix.length)}${loginSuffix}`;
        }
    }

    if (
        /(^|\.)(sandbox|scratch|develop)\./.test(host) ||
        /(^|\.)cs\d+\./.test(host) ||
        host === 'test.salesforce.com'
    ) {
        return 'https://test.salesforce.com';
    }

    return 'https://login.salesforce.com';
}

// Turns Salesforce OAuth error codes into a clear message that says how to fix it
function describeOAuthError(code, description) {
    const text = `${code || ''} ${description || ''}`;
    if (/OAUTH_APPROVAL_ERROR_GENERIC|OAUTH_APP_BLOCKED|OAUTH_APP_ACCESS_DENIED|must be installed|not admin approved/i.test(text)) {
        return `Salesforce blocked this app for your user. ${ADMIN_INSTALL_FIX} You can also use your own app (see OAuth setup).`;
    }
    if (/redirect_uri/i.test(text)) {
        return 'The callback URL of your app does not match. Copy the callback URL from OAuth setup into your app.';
    }
    if (/invalid_client_id|client identifier invalid/i.test(text)) {
        return 'Salesforce does not know this consumer key. Check the key in OAuth setup.';
    }
    if (/invalid client credentials|client secret/i.test(text)) {
        return 'Your app asks for a client secret. Turn off "Require secret" for the web server flow and for refresh.';
    }
    if (/invalid_scope/i.test(text)) {
        return 'Your app does not allow the api and refresh_token scopes. Add both scopes to the app.';
    }
    if (/end-user denied|access_denied/i.test(text)) {
        return 'Access was not allowed. Click Generate Token again and choose Allow.';
    }
    return `Salesforce login failed: ${description || code}`;
}

function describeAuthFlowFailure(error, redirectUri) {
    const message = (error && error.message) || String(error);
    if (/did not approve|closed|cancel/i.test(message)) {
        return 'The login window was closed before login finished.';
    }
    // Salesforce shows an error page instead of redirecting back, mostly for an unknown callback URL
    if (/Authorization page could not be loaded/i.test(message)) {
        return `Salesforce rejected the login request. Add this callback URL to the app (or check the consumer key in OAuth setup): ${redirectUri}`;
    }
    return `Could not open the Salesforce login page: ${message}`;
}

async function getClientIdSetting() {
    const { [CLIENT_ID_STORAGE_KEY]: customClientId } = await chrome.storage.local.get(CLIENT_ID_STORAGE_KEY);
    const usingCustomClientId = typeof customClientId === 'string' && customClientId.trim() !== '';
    return { clientId: usingCustomClientId ? customClientId.trim() : OAUTH_CLIENT_ID, usingCustomClientId };
}

export async function getOAuthConfig() {
    return { redirectUri: chrome.identity.getRedirectURL('salesforce'), ...(await getClientIdSetting()) };
}

// Saves the consumer key of the user's own app, or clears it (empty value) to use the default app
export async function setOAuthClientId(value) {
    const clientId = String(value || '').trim();
    if (!clientId) {
        await chrome.storage.local.remove(CLIENT_ID_STORAGE_KEY);
    } else if (!/^[\w.-]{10,255}$/.test(clientId)) {
        throw new Error('This does not look like a consumer key.');
    } else {
        await chrome.storage.local.set({ [CLIENT_ID_STORAGE_KEY]: clientId });
    }
    return getOAuthConfig();
}

export async function performOAuthLogin(orgUrl) {
    const loginBase = detectLoginBase(orgUrl);
    const redirectUri = chrome.identity.getRedirectURL('salesforce');
    const { clientId } = await getClientIdSetting();
    const state = generateRandomString(16);
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generatePKCEChallenge(codeVerifier);

    const authUrl = new URL(`${loginBase}/services/oauth2/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', OAUTH_SCOPES);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('code_challenge', codeChallenge);

    let redirectResponse;
    try {
        redirectResponse = await chrome.identity.launchWebAuthFlow({
            url: authUrl.toString(),
            interactive: true
        });
    } catch (error) {
        throw new Error(describeAuthFlowFailure(error, redirectUri));
    }

    if (!redirectResponse) {
        throw new Error('The login window was closed before login finished.');
    }

    const responseUrl = new URL(redirectResponse);

    // Salesforce reports login problems in the redirect; show them before the state check
    const error = responseUrl.searchParams.get('error');
    if (error) {
        throw new Error(describeOAuthError(error, responseUrl.searchParams.get('error_description')));
    }

    const returnedState = responseUrl.searchParams.get('state');

    if (returnedState !== state) {
        throw new Error('State mismatch - possible CSRF attack');
    }

    const code = responseUrl.searchParams.get('code');
    if (!code) {
        throw new Error('No authorization code returned from Salesforce');
    }

    const tokenResponse = await fetch(`${loginBase}/services/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            code: code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier
        })
    });

    if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        let errorBody = {};
        try { errorBody = JSON.parse(errorText); } catch { }
        throw new Error(errorBody.error
            ? describeOAuthError(errorBody.error, errorBody.error_description)
            : 'Token exchange failed: ' + errorText);
    }

    const tokens = await tokenResponse.json();

    const tokenData = {
        accessToken: tokens.access_token,
        instanceUrl: tokens.instance_url,
        refreshToken: tokens.refresh_token || null,
        issuedAt: Number(tokens.issued_at),
        tokenType: tokens.token_type,
        id: tokens.id,
        // Granted scopes (e.g. "web" enables one-time login links) and the app that issued the token
        scope: tokens.scope || null,
        clientId
    };

    const orgDomain = extractOrgDomain(tokens.instance_url);
    const storageKey = getTokenStorageKey(orgDomain);

    await chrome.storage.local.set({ [storageKey]: tokenData });

    return tokenData;
}

const TOKEN_EXPIRY_BUFFER = 5 * 60 * 1000;
const TOKEN_LIFETIME = 2 * 60 * 60 * 1000;

export function isTokenExpired(token) {
    if (!token || !token.issuedAt) return true;
    const expiresAt = token.issuedAt + TOKEN_LIFETIME - TOKEN_EXPIRY_BUFFER;
    return Date.now() > expiresAt;
}

// One refresh per org at a time: parallel callers share it, so a rotating refresh token is
// never sent twice
const refreshesInFlight = new Map();

function refreshAccessToken(token) {
    if (!token || !token.refreshToken || !token.instanceUrl) {
        return Promise.reject(new Error('NO_REFRESH_TOKEN'));
    }
    const orgDomain = extractOrgDomain(token.instanceUrl);
    if (!refreshesInFlight.has(orgDomain)) {
        refreshesInFlight.set(orgDomain, requestNewAccessToken(token).finally(() => refreshesInFlight.delete(orgDomain)));
    }
    return refreshesInFlight.get(orgDomain);
}

async function requestNewAccessToken(token) {
    const response = await fetch(`${token.instanceUrl}/services/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            // Refresh with the app that issued the token
            client_id: token.clientId || OAUTH_CLIENT_ID,
            refresh_token: token.refreshToken
        })
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        // Only a rejected refresh token ends the login; 5xx, 429 and network errors can pass
        if (response.status === 400 && errorBody.error === 'invalid_grant') {
            await chrome.storage.local.remove(getTokenStorageKey(extractOrgDomain(token.instanceUrl)));
            throw new Error('TOKEN_REVOKED');
        }
        throw new Error('TOKEN_REFRESH_FAILED');
    }

    const newTokens = await response.json();

    const updatedToken = {
        accessToken: newTokens.access_token,
        instanceUrl: newTokens.instance_url || token.instanceUrl,
        refreshToken: newTokens.refresh_token || token.refreshToken,
        issuedAt: Date.now(),
        tokenType: newTokens.token_type || token.tokenType,
        id: newTokens.id || token.id,
        scope: newTokens.scope || token.scope || null,
        clientId: token.clientId || OAUTH_CLIENT_ID
    };

    const orgDomainSnapshot = extractOrgDomain(updatedToken.instanceUrl);
    const storageKeySnapshot = getTokenStorageKey(orgDomainSnapshot);
    await chrome.storage.local.set({ [storageKeySnapshot]: updatedToken });

    return updatedToken;
}

// Called after Salesforce rejected an access token. If another call already refreshed it,
// use that token instead of spending the refresh token again.
export async function refreshAfterUnauthorized(staleToken) {
    const storageKey = getTokenStorageKey(extractOrgDomain(staleToken.instanceUrl));
    const stored = (await chrome.storage.local.get(storageKey))[storageKey];
    if (!stored) {
        throw new Error('NO_OAUTH_TOKEN');
    }
    if (stored.accessToken && stored.accessToken !== staleToken.accessToken) {
        return stored;
    }
    return refreshAccessToken(stored);
}

// Moves the shared legacy copy to its org key (unless that org already has a token) and
// removes it. Runs once per service worker start, before any token is read.
let legacyTokenMigration = null;

function migrateLegacyToken() {
    if (!legacyTokenMigration) {
        legacyTokenMigration = (async () => {
            const { [LEGACY_TOKEN_KEY]: legacyToken } = await chrome.storage.local.get(LEGACY_TOKEN_KEY);
            if (!legacyToken) return;
            if (legacyToken.instanceUrl) {
                const storageKey = getTokenStorageKey(extractOrgDomain(legacyToken.instanceUrl));
                const existing = (await chrome.storage.local.get(storageKey))[storageKey];
                if (!existing) {
                    await chrome.storage.local.set({ [storageKey]: legacyToken });
                }
            }
            await chrome.storage.local.remove(LEGACY_TOKEN_KEY);
        })().catch(error => console.debug('Legacy token migration failed:', error.message));
    }
    return legacyTokenMigration;
}

export async function getStoredOAuthToken(sfHost = null) {
    // Without an org we never guess: the old fallback used the last org you logged in to
    if (!sfHost) {
        return null;
    }

    try {
        await migrateLegacyToken();

        const orgDomain = extractOrgDomain(sfHost);
        const storageKey = getTokenStorageKey(orgDomain);
        const result = await chrome.storage.local.get(storageKey);
        let token = result[storageKey];

        if (!token || !token.accessToken || !token.instanceUrl) {
            return null;
        }

        // Final safety check: the token must match the host's domain
        const tokenDomain = extractOrgDomain(token.instanceUrl);
        if (tokenDomain !== orgDomain) {
            console.debug('Token domain mismatch for host:', sfHost);
            return null;
        }

        if (isTokenExpired(token)) {
            try {
                token = await refreshAccessToken(token);
            } catch (refreshError) {
                // The expiry is only a guess: keep the token unless it cannot be refreshed at all
                if (refreshError.message === 'TOKEN_REVOKED' || refreshError.message === 'NO_REFRESH_TOKEN') {
                    return null;
                }
            }
        }

        return token;
    } catch (error) {
        console.debug('Failed to get OAuth token:', error.message);
    }
    return null;
}

// Revokes the org's token at Salesforce, then always removes the local copy.
// Returns { warning } when Salesforce did not confirm the revoke.
export async function revokeOAuthToken(sfHost) {
    await migrateLegacyToken();

    const storageKey = getTokenStorageKey(extractOrgDomain(sfHost));
    const token = (await chrome.storage.local.get(storageKey))[storageKey];
    let warning = null;

    if (token && token.instanceUrl && (token.refreshToken || token.accessToken)) {
        try {
            const response = await fetch(`${token.instanceUrl}/services/oauth2/revoke`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                // Revoking the refresh token also revokes its access tokens
                body: new URLSearchParams({ token: token.refreshToken || token.accessToken })
            });
            if (!response.ok) {
                warning = `Salesforce did not confirm the revoke (HTTP ${response.status}). The token was removed from this browser.`;
            }
        } catch (error) {
            warning = `Could not reach Salesforce to revoke the token (${error.message}). The token was removed from this browser.`;
        }
    }

    await chrome.storage.local.remove(storageKey);
    return { warning };
}
