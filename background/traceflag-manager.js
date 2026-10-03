/**
 * Trace Flag Manager Module
 * Handles lifecycle of trace flags and associated log cleanups.
 */

import {
    directToolingQuery,
    directToolingCreate,
    directToolingUpdate,
    deleteApexLogsWhere,
    isValidSalesforceId
} from './api-client.js';
import { getStoredOAuthToken, extractOrgDomain } from './oauth-manager.js';

// Log cleanup after an auto trace flag expires is opt-in (default off)
const AUTO_CLEANUP_SETTING_KEY = 'autoCleanupLogs';
const MAX_CLEANUP_ATTEMPTS = 3;
const CLEANUP_RETRY_DELAY_MS = 15 * 60 * 1000;
const METADATA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Salesforce rejects trace flags that span more than 24 hours
const MAX_TRACE_FLAG_SPAN_MS = 24 * 60 * 60 * 1000;

// Used when the org has no SFDC_DevConsole debug level (created once per org)
const FALLBACK_DEBUG_LEVEL = {
    DeveloperName: 'SmartDebugLog',
    MasterLabel: 'Smart Debug Log',
    ApexCode: 'FINEST',
    ApexProfiling: 'INFO',
    Callout: 'INFO',
    Database: 'INFO',
    System: 'DEBUG',
    Validation: 'INFO',
    Visualforce: 'INFO',
    Workflow: 'INFO'
};

function cleanupAlarmName(traceFlagId) {
    return `cleanup_traceflag_${traceFlagId}`;
}

// The token id is https://login.salesforce.com/id/<orgId>/<userId>
function getUserIdFromToken(token) {
    const parts = (token && token.id ? token.id : '').split('/');
    const userId = parts.length >= 2 ? parts[parts.length - 1] : null;
    return isValidSalesforceId(userId) ? userId : null;
}

// Auto Trace Flag Storage Functions
async function storeAutoTraceFlagMetadata(data) {
    try {
        const result = await chrome.storage.local.get('autoTraceFlags');
        const autoTraceFlags = result.autoTraceFlags || [];

        const exists = autoTraceFlags.find(tf => tf.traceFlagId === data.traceFlagId);
        if (!exists) {
            autoTraceFlags.push(data);
            await chrome.storage.local.set({ autoTraceFlags });
        }
    } catch (error) {
        console.error('Failed to store auto trace flag metadata:', error);
    }
}

async function getAutoTraceFlagMetadata() {
    try {
        const result = await chrome.storage.local.get('autoTraceFlags');
        return result.autoTraceFlags || [];
    } catch (error) {
        console.error('Failed to get auto trace flag metadata:', error);
        return [];
    }
}

async function removeAutoTraceFlagMetadata(traceFlagId) {
    try {
        const result = await chrome.storage.local.get('autoTraceFlags');
        const autoTraceFlags = result.autoTraceFlags || [];
        const updatedFlags = autoTraceFlags.filter(tf => tf.traceFlagId !== traceFlagId);
        await chrome.storage.local.set({ autoTraceFlags: updatedFlags });
    } catch (error) {
        console.error('Failed to remove auto trace flag metadata:', error);
    }
}

// The flag was deleted (or replaced): stop tracking it. Its logs are kept.
export async function forgetAutoTraceFlag(traceFlagId) {
    await removeAutoTraceFlagMetadata(traceFlagId);
    await chrome.alarms.clear(cleanupAlarmName(traceFlagId));
}

// The flag's end time changed (Extend, Reduce, expire now): keep metadata and alarm in step.
// Never deletes logs; cleanup only runs when the flag runs out on its own.
export async function updateAutoTraceFlagWindow(traceFlagId, expirationDate) {
    const metadata = (await getAutoTraceFlagMetadata()).find(tf => tf.traceFlagId === traceFlagId);
    if (!metadata) return;

    const newExpiration = new Date(expirationDate);
    if (!(newExpiration > new Date())) {
        await forgetAutoTraceFlag(traceFlagId);
        return;
    }

    await removeAutoTraceFlagMetadata(traceFlagId);
    await storeAutoTraceFlagMetadata({ ...metadata, expirationDate: newExpiration.toISOString() });
    await chrome.alarms.clear(cleanupAlarmName(traceFlagId));
    await chrome.alarms.create(cleanupAlarmName(traceFlagId), { when: newExpiration.getTime() });
}

// Runs when an auto trace flag expires. Deletes logs only when the user turned on
// "autoCleanupLogs", and then only this user's Monitoring logs from the flag's time window.
export async function cleanupExpiredTraceFlagLogs(traceFlagId) {
    const alarmName = cleanupAlarmName(traceFlagId);
    try {
        const autoTraceFlags = await getAutoTraceFlagMetadata();
        const metadata = autoTraceFlags.find(tf => tf.traceFlagId === traceFlagId);

        if (!metadata) {
            await chrome.alarms.clear(alarmName);
            return;
        }

        const { [AUTO_CLEANUP_SETTING_KEY]: autoCleanupLogs } = await chrome.storage.local.get(AUTO_CLEANUP_SETTING_KEY);
        const { userId, orgDomain } = metadata;
        const start = new Date(metadata.startTime);
        const end = new Date(metadata.expirationDate);

        if (autoCleanupLogs === true && orgDomain && isValidSalesforceId(userId) && !isNaN(start) && !isNaN(end)) {
            try {
                const result = await deleteApexLogsWhere(
                    `LogUserId = '${userId}' AND Location = 'Monitoring' AND StartTime >= ${start.toISOString()} AND StartTime <= ${end.toISOString()}`,
                    orgDomain
                );
                if (result.deletedIds.length > 0) {
                    chrome.runtime.sendMessage({
                        type: 'LOGS_DELETED',
                        logIds: result.deletedIds,
                        orgDomain: orgDomain
                    }).catch(() => { });
                }
            } catch (queryError) {
                // Keep the metadata so a later run can retry, a few times at most
                const attempts = (metadata.cleanupAttempts || 0) + 1;
                if (attempts < MAX_CLEANUP_ATTEMPTS) {
                    await removeAutoTraceFlagMetadata(traceFlagId);
                    await storeAutoTraceFlagMetadata({ ...metadata, cleanupAttempts: attempts });
                    await chrome.alarms.create(alarmName, { when: Date.now() + CLEANUP_RETRY_DELAY_MS });
                    return;
                }
                console.error('Giving up log cleanup for trace flag:', traceFlagId, queryError.message);
            }
        }

        await removeAutoTraceFlagMetadata(traceFlagId);
        await chrome.alarms.clear(alarmName);

    } catch (error) {
        console.error('Cleanup failed for trace flag:', traceFlagId, error);
    }
}

// Chrome may drop alarms on update or restart: run the cleanup for flags that ran out in the
// meantime, re-create alarms for the others, and forget entries that expired over 7 days ago.
export async function reconcileAutoTraceFlags(now = Date.now()) {
    const autoTraceFlags = await getAutoTraceFlagMetadata();
    const recentFlags = autoTraceFlags.filter(tf => now - new Date(tf.expirationDate).getTime() <= METADATA_MAX_AGE_MS);
    if (recentFlags.length !== autoTraceFlags.length) {
        await chrome.storage.local.set({ autoTraceFlags: recentFlags });
    }

    for (const tf of recentFlags) {
        const expiresAt = new Date(tf.expirationDate).getTime();
        if (expiresAt <= now) {
            await cleanupExpiredTraceFlagLogs(tf.traceFlagId);
        } else {
            await chrome.alarms.create(cleanupAlarmName(tf.traceFlagId), { when: expiresAt });
        }
    }
}

async function getDefaultDebugLevelId(sfHost) {
    const result = await directToolingQuery(
        `SELECT Id, DeveloperName FROM DebugLevel WHERE DeveloperName IN ('SFDC_DevConsole', '${FALLBACK_DEBUG_LEVEL.DeveloperName}')`,
        sfHost
    );
    const levels = result.records || [];
    const level = levels.find(l => l.DeveloperName === 'SFDC_DevConsole') ||
        levels.find(l => l.DeveloperName === FALLBACK_DEBUG_LEVEL.DeveloperName);
    if (level) return level.Id;

    const created = await directToolingCreate('DebugLevel', FALLBACK_DEBUG_LEVEL, sfHost);
    return created.id;
}

// Turns on USER_DEBUG logging for the token's user (popup, dashboard and keyboard shortcut).
// Looks at every USER_DEBUG flag of the user (any debug level): an active one is kept unless
// forced; otherwise that flag is updated in place, or a new one is created.
export async function ensureTraceFlag(sfHost, { force = false, durationMinutes = 45 } = {}) {
    const token = await getStoredOAuthToken(sfHost);
    if (!token) return { success: false, error: 'No OAuth token available' };

    const userId = getUserIdFromToken(token);
    if (!userId) return { success: false, error: 'Could not determine user ID' };

    const now = new Date();
    const expiration = new Date(now.getTime() + Math.min(durationMinutes * 60 * 1000, MAX_TRACE_FLAG_SPAN_MS));
    const checkQuery = `SELECT Id, StartDate, ExpirationDate, DebugLevelId FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'USER_DEBUG' ORDER BY ExpirationDate DESC LIMIT 20`;
    const flags = (await directToolingQuery(checkQuery, sfHost)).records || [];

    const activeFlag = flags.find(tf => new Date(tf.StartDate) <= now && new Date(tf.ExpirationDate) > now);
    if (activeFlag && !force) {
        return { success: true, data: { existing: true, traceFlagId: activeFlag.Id } };
    }

    let traceFlagId;
    const existingFlag = activeFlag || flags[0];
    if (existingFlag) {
        // Keep the flag's start unless it lies in the future or the new end would be over 24 h after it
        const start = new Date(existingFlag.StartDate);
        const keepStart = start <= now && expiration - start <= MAX_TRACE_FLAG_SPAN_MS;
        const update = { ExpirationDate: expiration.toISOString() };
        if (!keepStart) update.StartDate = now.toISOString();
        if (!existingFlag.DebugLevelId) update.DebugLevelId = await getDefaultDebugLevelId(sfHost);
        await directToolingUpdate('TraceFlag', existingFlag.Id, update, sfHost);
        traceFlagId = existingFlag.Id;
    } else {
        const debugLevelId = await getDefaultDebugLevelId(sfHost);
        const createResult = await directToolingCreate('TraceFlag', {
            TracedEntityId: userId,
            LogType: 'USER_DEBUG',
            DebugLevelId: debugLevelId,
            StartDate: now.toISOString(),
            ExpirationDate: expiration.toISOString()
        }, sfHost);
        traceFlagId = createResult.id;
    }

    // Remove any stale metadata for this flag first so the stored expiration always
    // reflects the latest window (store is a no-op when the id already exists).
    await removeAutoTraceFlagMetadata(traceFlagId);
    await storeAutoTraceFlagMetadata({
        traceFlagId,
        userId,
        startTime: now.toISOString(),
        expirationDate: expiration.toISOString(),
        orgDomain: extractOrgDomain(sfHost)
    });
    await chrome.alarms.create(cleanupAlarmName(traceFlagId), { when: expiration.getTime() });
    return { success: true, data: { traceFlagId, expirationDate: expiration.toISOString() } };
}

// Real trace flags of the token's user (any LogType), active now or scheduled
export async function getTraceFlagStatus(sfHost, now = new Date()) {
    const token = await getStoredOAuthToken(sfHost);
    if (!token) throw new Error('NO_OAUTH_TOKEN');

    const userId = getUserIdFromToken(token);
    if (!userId) throw new Error('Could not determine user ID');

    const query = `SELECT Id, LogType, StartDate, ExpirationDate, DebugLevel.DeveloperName FROM TraceFlag WHERE TracedEntityId = '${userId}' AND ExpirationDate > ${now.toISOString()} ORDER BY StartDate ASC LIMIT 50`;
    const flags = (await directToolingQuery(query, sfHost)).records || [];

    // The active flag that runs longest, else the next scheduled one
    const activeFlag = flags
        .filter(tf => new Date(tf.StartDate) <= now)
        .sort((a, b) => new Date(b.ExpirationDate) - new Date(a.ExpirationDate))[0];
    const flag = activeFlag || flags[0];
    if (!flag) return { active: false };

    return {
        active: !!activeFlag,
        scheduled: !activeFlag,
        startTime: flag.StartDate,
        expirationDate: flag.ExpirationDate,
        logType: flag.LogType,
        debugLevel: (flag.DebugLevel && flag.DebugLevel.DeveloperName) || null
    };
}

// Fallback when Salesforce cannot be asked: flags this extension created for this org
export async function getLocalTraceFlagStatus(sfHost, now = Date.now()) {
    const orgDomain = extractOrgDomain(sfHost);
    const flags = await getAutoTraceFlagMetadata();

    // Pick the one expiring latest that is still in the future.
    const active = flags
        .filter(tf => orgDomain && tf.orgDomain === orgDomain)
        .filter(tf => new Date(tf.expirationDate).getTime() > now)
        .sort((a, b) => new Date(b.expirationDate) - new Date(a.expirationDate))[0];

    if (!active) return { active: false };

    return {
        active: true,
        startTime: active.startTime,
        expirationDate: active.expirationDate,
        logType: 'USER_DEBUG',
        debugLevel: null
    };
}
