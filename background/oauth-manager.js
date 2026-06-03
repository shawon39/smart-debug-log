/**
 * OAuth Manager Module
 * Handles Salesforce OAuth flows, token storage, and token lifecycle management.
 */

// OAuth Configuration

// Salesforce production edition
const OAUTH_CLIENT_ID = '3MVG95mg0lk4batiOPo696IEH2HgoU2UEozJEuCiCQBK_UmFAC0G.w2gvRdkxnG9exLIMvUqe6BNJKlr4vIYM';

// Salesforce developer edition
// const OAUTH_CLIENT_ID = '3MVG95mg0lk4batiOPo696IEH2CKKjz0rft6yvoueOIdkjyYyOCS1zj3EzVIKrc5Y25ekBWEZ4omoLZ8T8t79';

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
export function getTokenStorageKey(orgDomain) {
    if (!orgDomain) return 'sfOAuthToken'; // Fallback for backwards compatibility
    return `sfOAuthToken_${orgDomain}`;
}

// PKCE Utilities
export function generateRandomString(length = 43) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, x => chars[x % chars.length]).join('');
}

export async function generatePKCEChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function detectLoginBase(orgUrl) {
    if (!orgUrl) {
        return 'https://login.salesforce.com';
    }

    const lowerUrl = orgUrl.toLowerCase();

    const myDomainMatch = lowerUrl.match(/([a-z0-9-]+(?:--[a-z0-9-]+)?(?:\.sandbox|\.scratch|\.develop)?\.my\.salesforce\.com)/i);
    if (myDomainMatch) {
        return `https://${myDomainMatch[1]}`;
    }

    const lightningMatch = lowerUrl.match(/([a-z0-9-]+(?:--[a-z0-9-]+)?)\.lightning\.force\.com/i);
    if (lightningMatch) {
        const domain = lightningMatch[1];
        return `https://${domain}.my.salesforce.com`;
    }

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

export async function performOAuthLogin(orgUrl) {
    const loginBase = detectLoginBase(orgUrl);
    const redirectUri = chrome.identity.getRedirectURL('salesforce');
    const state = generateRandomString(16);
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generatePKCEChallenge(codeVerifier);

    const authUrl = new URL(`${loginBase}/services/oauth2/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', OAUTH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'api refresh_token');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('code_challenge', codeChallenge);

    const redirectResponse = await chrome.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true
    });

    if (!redirectResponse) {
        throw new Error('User closed the authentication window or auth failed');
    }

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

    const tokenData = {
        accessToken: tokens.access_token,
        instanceUrl: tokens.instance_url,
        refreshToken: tokens.refresh_token || null,
        issuedAt: Number(tokens.issued_at),
        tokenType: tokens.token_type,
        id: tokens.id
    };

    const orgDomain = extractOrgDomain(tokens.instance_url);
    const storageKey = getTokenStorageKey(orgDomain);

    await chrome.storage.local.set({ [storageKey]: tokenData, sfOAuthToken: tokenData });

    return tokenData;
}

const TOKEN_EXPIRY_BUFFER = 5 * 60 * 1000;
const TOKEN_LIFETIME = 2 * 60 * 60 * 1000;

export function isTokenExpired(token) {
    if (!token || !token.issuedAt) return true;
    const expiresAt = token.issuedAt + TOKEN_LIFETIME - TOKEN_EXPIRY_BUFFER;
    return Date.now() > expiresAt;
}

export async function refreshAccessToken(token) {
    if (!token || !token.refreshToken || !token.instanceUrl) {
        throw new Error('NO_REFRESH_TOKEN');
    }

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
        const orgDomain = extractOrgDomain(token.instanceUrl);
        const storageKey = getTokenStorageKey(orgDomain);
        await chrome.storage.local.remove([storageKey, 'sfOAuthToken']);
        throw new Error('TOKEN_REFRESH_FAILED');
    }

    const newTokens = await response.json();

    const updatedToken = {
        accessToken: newTokens.access_token,
        instanceUrl: newTokens.instance_url || token.instanceUrl,
        refreshToken: newTokens.refresh_token || token.refreshToken,
        issuedAt: Date.now(),
        tokenType: newTokens.token_type || token.tokenType,
        id: newTokens.id || token.id
    };

    const orgDomainSnapshot = extractOrgDomain(updatedToken.instanceUrl);
    const storageKeySnapshot = getTokenStorageKey(orgDomainSnapshot);
    await chrome.storage.local.set({ [storageKeySnapshot]: updatedToken, sfOAuthToken: updatedToken });

    return updatedToken;
}

export async function getStoredOAuthToken(sfHost = null) {
    try {
        let token = null;

        if (sfHost) {
            const orgDomain = extractOrgDomain(sfHost);
            const storageKey = getTokenStorageKey(orgDomain);
            const result = await chrome.storage.local.get(storageKey);
            token = result[storageKey];

            if (!token) {
                const defaultResult = await chrome.storage.local.get('sfOAuthToken');
                const defaultToken = defaultResult.sfOAuthToken;
                if (defaultToken && defaultToken.instanceUrl) {
                    const defaultDomain = extractOrgDomain(defaultToken.instanceUrl);
                    if (defaultDomain === orgDomain) {
                        token = defaultToken;
                    }
                }
            }

            if (token && token.instanceUrl) {
                const tokenDomain = extractOrgDomain(token.instanceUrl);
                if (tokenDomain !== orgDomain) {
                    return null;
                }
            }
        } else {
            const result = await chrome.storage.local.get('sfOAuthToken');
            token = result.sfOAuthToken;
        }

        if (!token || !token.accessToken || !token.instanceUrl) {
            return null;
        }

        // Final safety check: if we have a host, the token must match the host's domain
        if (sfHost) {
            const orgDomain = extractOrgDomain(sfHost);
            const tokenDomain = extractOrgDomain(token.instanceUrl);
            if (tokenDomain !== orgDomain) {
                console.debug('Token domain mismatch for host:', sfHost);
                return null;
            }
        }

        if (isTokenExpired(token)) {
            try {
                token = await refreshAccessToken(token);
            } catch (refreshError) {
                return null;
            }
        }

        return token;
    } catch (error) {
        console.debug('Failed to get OAuth token:', error.message);
    }
    return null;
}
