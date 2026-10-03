/**
 * API Client Module
 * Provides direct access to Salesforce Tooling and REST APIs.
 */

import { getStoredOAuthToken, refreshAfterUnauthorized, extractOrgDomain } from './oauth-manager.js';

export const API_VERSION = 'v62.0';

// Record IDs (15 or 18 chars) and sObject API names are checked before they go into URL paths
const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const SOBJECT_TYPE_PATTERN = /^\w+$/;

export function isValidSalesforceId(id) {
    return typeof id === 'string' && SALESFORCE_ID_PATTERN.test(id);
}

function assertRecordId(recordId) {
    if (!isValidSalesforceId(recordId)) {
        throw new Error('Invalid Salesforce record ID');
    }
}

function assertSObjectType(sobjectType) {
    if (typeof sobjectType !== 'string' || !SOBJECT_TYPE_PATTERN.test(sobjectType)) {
        throw new Error('Invalid object type');
    }
}

// Sends a request with the org's OAuth token. The 2-hour token expiry is only a guess, so when
// Salesforce rejects the session we refresh the token once and retry the request once.
async function authorizedFetch(sfHost, buildRequest) {
    const token = await getStoredOAuthToken(sfHost);
    if (!token) {
        throw new Error('NO_OAUTH_TOKEN');
    }

    const response = await fetch(...buildRequest(token));
    if (!token.refreshToken || !(await isSessionRejected(response))) {
        return response;
    }

    let freshToken;
    try {
        freshToken = await refreshAfterUnauthorized(token);
    } catch (error) {
        return response;
    }
    return fetch(...buildRequest(freshToken));
}

async function isSessionRejected(response) {
    if (response.status === 401) {
        return true;
    }
    // The SOAP API reports an invalid session as an HTTP 500 fault
    if (response.status === 500 && (response.headers.get('content-type') || '').includes('xml')) {
        return (await response.clone().text()).includes('INVALID_SESSION_ID');
    }
    return false;
}

export async function directToolingQuery(query, sfHost = null) {
    const response = await authorizedFetch(sfHost, token => [
        `${token.instanceUrl}/services/data/${API_VERSION}/tooling/query/?q=${encodeURIComponent(query)}`,
        {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token.accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        }
    ]);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tooling query failed: ${response.status} - ${errorText}`);
    }

    return response.json();
}

export async function directToolingCreate(sobjectType, data, sfHost = null) {
    assertSObjectType(sobjectType);

    const response = await authorizedFetch(sfHost, token => [
        `${token.instanceUrl}/services/data/${API_VERSION}/tooling/sobjects/${sobjectType}/`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token.accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(data)
        }
    ]);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tooling create failed: ${response.status} - ${errorText}`);
    }

    return response.json();
}

export async function directToolingUpdate(sobjectType, recordId, data, sfHost = null) {
    assertSObjectType(sobjectType);
    assertRecordId(recordId);

    const response = await authorizedFetch(sfHost, token => [
        `${token.instanceUrl}/services/data/${API_VERSION}/tooling/sobjects/${sobjectType}/${recordId}`,
        {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token.accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(data)
        }
    ]);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tooling update failed: ${response.status} - ${errorText}`);
    }

    return { success: true };
}

export async function directToolingDelete(sobjectType, recordId, sfHost = null) {
    assertSObjectType(sobjectType);
    assertRecordId(recordId);

    const response = await authorizedFetch(sfHost, token => [
        `${token.instanceUrl}/services/data/${API_VERSION}/tooling/sobjects/${sobjectType}/${recordId}`,
        {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token.accessToken}`,
                'Accept': 'application/json'
            }
        }
    ]);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tooling delete failed: ${response.status} - ${errorText}`);
    }

    if (sobjectType === 'ApexLog') {
        forgetCachedLogBodies(sfHost, [recordId]);
    }
    return { success: true };
}

export async function directToolingDescribe(sobjectType, sfHost = null) {
    assertSObjectType(sobjectType);

    const response = await authorizedFetch(sfHost, token => [
        `${token.instanceUrl}/services/data/${API_VERSION}/tooling/sobjects/${sobjectType}/describe/`,
        {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token.accessToken}`,
                'Accept': 'application/json'
            }
        }
    ]);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tooling describe failed: ${response.status} - ${errorText}`);
    }

    return response.json();
}

// Log bodies are cached in memory, capped by total size (a single log can be 20 MB)
const LOG_CACHE_MAX_BYTES = 50 * 1024 * 1024;
const LOG_CACHE_MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const logBodyCache = new Map();
let logBodyCacheBytes = 0;

function logBodyCachePrefix(sfHost) {
    return `${extractOrgDomain(sfHost) || 'default'}-`;
}

function cacheLogBody(cacheKey, result) {
    const size = result.content.length;
    if (size > LOG_CACHE_MAX_ENTRY_BYTES) {
        return;
    }
    removeCachedLogBody(cacheKey);
    logBodyCache.set(cacheKey, result);
    logBodyCacheBytes += size;
    // A Map keeps insertion order, so the oldest entries go first
    for (const oldestKey of logBodyCache.keys()) {
        if (logBodyCacheBytes <= LOG_CACHE_MAX_BYTES) break;
        removeCachedLogBody(oldestKey);
    }
}

function removeCachedLogBody(cacheKey) {
    const entry = logBodyCache.get(cacheKey);
    if (!entry) return;
    logBodyCacheBytes -= entry.content.length;
    logBodyCache.delete(cacheKey);
}

// Drops cached bodies of one org: all of them (token revoked) or only the given (deleted) logs
export function forgetCachedLogBodies(sfHost, logIds = null) {
    const prefix = logBodyCachePrefix(sfHost);
    const keys = logIds
        ? logIds.map(logId => prefix + logId)
        : [...logBodyCache.keys()].filter(key => key.startsWith(prefix));
    keys.forEach(removeCachedLogBody);
}

export async function directGetLogBody(logId, sfHost = null) {
    assertRecordId(logId);

    // Check cache first
    const cacheKey = logBodyCachePrefix(sfHost) + logId;
    if (logBodyCache.has(cacheKey)) {
        return logBodyCache.get(cacheKey);
    }

    const response = await authorizedFetch(sfHost, token => [
        `${token.instanceUrl}/services/data/${API_VERSION}/tooling/sobjects/ApexLog/${logId}/Body/`,
        {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token.accessToken}`,
                'Accept': 'text/plain'
            }
        }
    ]);

    if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 404) {
            throw new Error(`Debug log not found or expired. Log ID: ${logId}`);
        }
        throw new Error(`Failed to fetch log body: ${response.status} - ${errorText}`);
    }

    const content = await response.text();
    const result = { content, logId };
    cacheLogBody(cacheKey, result);

    return result;
}

// executeAnonymous over REST puts the code in the URL. Long code goes over the SOAP API
// (POST) instead, so it does not hit URL length limits (414/431).
const MAX_GET_URL_LENGTH = 7500;
const EXECUTE_ANONYMOUS_FIELDS = ['compiled', 'success', 'line', 'column', 'compileProblem', 'exceptionMessage', 'exceptionStackTrace'];

function escapeXml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function decodeXmlEntities(text) {
    return text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (match, entity) => {
        const named = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
        if (named[entity]) return named[entity];
        const codePoint = entity[1] === 'x' || entity[1] === 'X'
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return String.fromCodePoint(codePoint);
    });
}

export function buildExecuteAnonymousEnvelope(code, sessionId) {
    return '<?xml version="1.0" encoding="UTF-8"?>' +
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:apex="http://soap.sforce.com/2006/08/apex">' +
        `<soapenv:Header><apex:SessionHeader><apex:sessionId>${escapeXml(sessionId)}</apex:sessionId></apex:SessionHeader></soapenv:Header>` +
        `<soapenv:Body><apex:executeAnonymous><apex:String>${escapeXml(code)}</apex:String></apex:executeAnonymous></soapenv:Body>` +
        '</soapenv:Envelope>';
}

// The service worker has no DOMParser, so read the few known result fields with a regex.
// Returns the same shape as the REST executeAnonymous response.
export function parseExecuteAnonymousResponse(xml) {
    const readField = (name) => {
        const match = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`));
        if (!match || match[2] === undefined || /xsi:nil="true"/.test(match[1] || '')) return null;
        return decodeXmlEntities(match[2]);
    };
    const values = Object.fromEntries(EXECUTE_ANONYMOUS_FIELDS.map(name => [name, readField(name)]));
    const toNumber = (value) => (value === null || isNaN(parseInt(value, 10)) ? -1 : parseInt(value, 10));
    return {
        compiled: values.compiled === 'true',
        success: values.success === 'true',
        line: toNumber(values.line),
        column: toNumber(values.column),
        compileProblem: values.compileProblem,
        exceptionMessage: values.exceptionMessage,
        exceptionStackTrace: values.exceptionStackTrace
    };
}

export async function directExecuteAnonymous(code, sfHost = null) {
    const restPath = `/services/data/${API_VERSION}/tooling/executeAnonymous/?anonymousBody=${encodeURIComponent(code)}`;
    let useSoap = false;

    const response = await authorizedFetch(sfHost, token => {
        useSoap = (token.instanceUrl + restPath).length >= MAX_GET_URL_LENGTH;
        if (!useSoap) {
            return [`${token.instanceUrl}${restPath}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token.accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }];
        }
        return [`${token.instanceUrl}/services/Soap/s/${API_VERSION.replace(/^v/, '')}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=UTF-8',
                'SOAPAction': '""'
            },
            body: buildExecuteAnonymousEnvelope(code, token.accessToken)
        }];
    });

    if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401 || errorText.includes('INVALID_SESSION_ID')) {
            throw new Error('Authentication failed. Please regenerate your access token.');
        }
        if (response.status === 403) {
            throw new Error('Insufficient permissions to execute anonymous Apex.');
        }
        const fault = useSoap ? errorText.match(/<faultstring>([\s\S]*?)<\/faultstring>/) : null;
        throw new Error(`Execute anonymous failed: ${response.status} - ${fault ? decodeXmlEntities(fault[1]) : errorText}`);
    }

    return useSoap ? parseExecuteAnonymousResponse(await response.text()) : response.json();
}

export async function directQuery(query, sfHost = null) {
    const response = await authorizedFetch(sfHost, token => [
        `${token.instanceUrl}/services/data/${API_VERSION}/query/?q=${encodeURIComponent(query)}`,
        {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token.accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        }
    ]);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Query failed: ${response.status} - ${errorText}`);
    }

    return response.json();
}

// Deleting ApexLog records: composite API in chunks of 200; if that call fails as a whole,
// one Tooling DELETE per record, 5 at a time
const COMPOSITE_DELETE_LIMIT = 200;
const TOOLING_DELETE_CONCURRENCY = 5;
const MAX_DELETE_ERRORS = 10;

function newDeleteSummary() {
    return { deleted: 0, failed: 0, errors: [], deletedIds: [] };
}

function addDeleteError(summary, message) {
    if (summary.errors.length < MAX_DELETE_ERRORS && !summary.errors.includes(message)) {
        summary.errors.push(message);
    }
}

async function compositeDelete(ids, sfHost) {
    const response = await authorizedFetch(sfHost, token => [
        `${token.instanceUrl}/services/data/${API_VERSION}/composite/sobjects?ids=${ids.join(',')}&allOrNone=false`,
        {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token.accessToken}`,
                'Accept': 'application/json'
            }
        }
    ]);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Composite delete failed: ${response.status} - ${errorText}`);
    }

    // Results come back in the same order as the IDs
    const results = await response.json();
    return ids.map((id, index) => {
        const errors = (results[index] && results[index].errors) || [];
        // A log that is already gone counts as deleted
        const success = (results[index] && results[index].success === true) ||
            errors.some(error => error.statusCode === 'ENTITY_IS_DELETED');
        return { id, success, error: success ? null : (errors[0] && errors[0].message) || 'Unknown error' };
    });
}

async function toolingDeleteEach(ids, sfHost) {
    const results = [];
    for (let i = 0; i < ids.length; i += TOOLING_DELETE_CONCURRENCY) {
        const batch = ids.slice(i, i + TOOLING_DELETE_CONCURRENCY);
        results.push(...await Promise.all(batch.map(id =>
            directToolingDelete('ApexLog', id, sfHost)
                .then(() => ({ id, success: true, error: null }))
                .catch(error => ({ id, success: error.message.includes('ENTITY_IS_DELETED'), error: error.message }))
        )));
    }
    return results;
}

// Returns { deleted, failed, errors (max 10 unique), deletedIds }
export async function directDeleteApexLogs(logIds, sfHost) {
    logIds.forEach(assertRecordId);
    const summary = newDeleteSummary();

    for (let i = 0; i < logIds.length; i += COMPOSITE_DELETE_LIMIT) {
        const chunk = logIds.slice(i, i + COMPOSITE_DELETE_LIMIT);
        let results;
        try {
            results = await compositeDelete(chunk, sfHost);
        } catch (error) {
            if (error.message === 'NO_OAUTH_TOKEN') throw error;
            results = await toolingDeleteEach(chunk, sfHost);
        }
        for (const result of results) {
            if (result.success) {
                summary.deleted++;
                summary.deletedIds.push(result.id);
            } else {
                summary.failed++;
                addDeleteError(summary, result.error);
            }
        }
    }

    forgetCachedLogBodies(sfHost, summary.deletedIds);
    return summary;
}

// Deletes every ApexLog that matches the SOQL condition, 200 per round. Pages by Id, so logs
// that fail to delete are not fetched again and the loop always ends.
export async function deleteApexLogsWhere(condition, sfHost, maxRounds = 50) {
    const summary = newDeleteSummary();
    let lastId = null;

    for (let round = 0; round < maxRounds; round++) {
        const afterLastId = lastId ? ` AND Id > '${lastId}'` : '';
        const result = await directToolingQuery(
            `SELECT Id FROM ApexLog WHERE ${condition}${afterLastId} ORDER BY Id LIMIT ${COMPOSITE_DELETE_LIMIT}`,
            sfHost
        );
        const ids = (result.records || []).map(record => record.Id);
        if (ids.length === 0) break;

        const roundSummary = await directDeleteApexLogs(ids, sfHost);
        summary.deleted += roundSummary.deleted;
        summary.failed += roundSummary.failed;
        summary.deletedIds.push(...roundSummary.deletedIds);
        roundSummary.errors.forEach(message => addDeleteError(summary, message));

        lastId = ids[ids.length - 1];
        if (ids.length < COMPOSITE_DELETE_LIMIT) break;
    }

    return summary;
}

// Org debug log storage (Salesforce stops new trace flags above 1,000 MB)
export async function directGetLogStorage(sfHost) {
    const result = await directToolingQuery('SELECT SUM(LogLength) totalBytes, COUNT(Id) logCount FROM ApexLog', sfHost);
    const row = (result.records || [])[0] || {};
    return {
        totalBytes: Number(row.totalBytes) || 0,
        logCount: Number(row.logCount) || 0,
        limitBytes: 1000 * 1024 * 1024
    };
}

// One-time login link (works once, for about a minute) instead of a link with the session ID.
// Needs a token with the "web" or "full" scope; returns null when the token has neither.
export async function directGetSingleAccessUrl(sfHost) {
    const token = await getStoredOAuthToken(sfHost);
    if (!token) {
        throw new Error('NO_OAUTH_TOKEN');
    }
    if (!/(^|\s)(web|full)(\s|$)/.test(token.scope || '')) {
        return null;
    }

    const response = await authorizedFetch(sfHost, freshToken => [
        `${freshToken.instanceUrl}/services/oauth2/singleaccess`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${freshToken.accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: new URLSearchParams({ redirect_uri: '/' }).toString()
        }
    ]);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Single access request failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.frontdoor_uri || null;
}
