/**
 * API Client Module
 * Provides direct access to Salesforce Tooling and REST APIs.
 */

import { getStoredOAuthToken } from './oauth-manager.js';

export const API_VERSION = 'v62.0';

export async function directToolingQuery(query, sfHost = null) {
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

export async function directToolingCreate(sobjectType, data, sfHost = null) {
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

export async function directToolingUpdate(sobjectType, recordId, data, sfHost = null) {
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

    return { success: true };
}

export async function directToolingDelete(sobjectType, recordId, sfHost = null) {
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

    return { success: true };
}

export async function directToolingDescribe(sobjectType, sfHost = null) {
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

export async function directGetLogBody(logId, sfHost = null) {
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

export async function directExecuteAnonymous(code, sfHost = null) {
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

export async function directQuery(query, sfHost = null) {
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
