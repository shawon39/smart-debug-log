/**
 * Trace Flag Manager Module
 * Handles lifecycle of trace flags and associated log cleanups.
 */

import { directToolingQuery, directToolingDelete } from './api-client.js';
import { getStoredOAuthToken } from './oauth-manager.js';
import DebugLogManager from './debug-log-manager.js';

const debugLogManager = new DebugLogManager();

// Auto Trace Flag Storage Functions
export async function storeAutoTraceFlagMetadata(data) {
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

export async function getAutoTraceFlagMetadata() {
    try {
        const result = await chrome.storage.local.get('autoTraceFlags');
        return result.autoTraceFlags || [];
    } catch (error) {
        console.error('Failed to get auto trace flag metadata:', error);
        return [];
    }
}

export async function removeAutoTraceFlagMetadata(traceFlagId) {
    try {
        const result = await chrome.storage.local.get('autoTraceFlags');
        const autoTraceFlags = result.autoTraceFlags || [];
        const updatedFlags = autoTraceFlags.filter(tf => tf.traceFlagId !== traceFlagId);
        await chrome.storage.local.set({ autoTraceFlags: updatedFlags });
    } catch (error) {
        console.error('Failed to remove auto trace flag metadata:', error);
    }
}

// Cleanup logs for expired auto trace flag
export async function cleanupExpiredTraceFlagLogs(traceFlagId) {
    try {
        const autoTraceFlags = await getAutoTraceFlagMetadata();
        const metadata = autoTraceFlags.find(tf => tf.traceFlagId === traceFlagId);

        if (!metadata) {
            await chrome.alarms.clear(`cleanup_traceflag_${traceFlagId}`);
            return;
        }

        const { userId, startTime, expirationDate, orgDomain } = metadata;
        const query = `SELECT Id FROM ApexLog WHERE LogUserId = '${userId}' AND StartTime >= ${startTime} AND StartTime <= ${expirationDate} ORDER BY StartTime DESC LIMIT 200`;

        try {
            const result = await directToolingQuery(query, orgDomain);
            const logs = result.records || [];

            if (logs.length === 0) {
                await removeAutoTraceFlagMetadata(traceFlagId);
                await chrome.alarms.clear(`cleanup_traceflag_${traceFlagId}`);
                return;
            }

            const logIds = logs.map(log => log.Id);
            const BATCH_SIZE = 5;

            for (let i = 0; i < logs.length; i += BATCH_SIZE) {
                const batch = logs.slice(i, i + BATCH_SIZE);
                const deletePromises = batch.map(log =>
                    directToolingDelete('ApexLog', log.Id, orgDomain)
                        .catch(err => { console.error(`Failed to delete log ${log.Id}:`, err.message); return false; })
                );
                await Promise.all(deletePromises);
            }

            try {
                const token = await getStoredOAuthToken(orgDomain);
                if (token && token.id) {
                    const parts = token.id.split('/');
                    if (parts.length >= 2) {
                        const orgId = parts[parts.length - 2];
                        await debugLogManager.initialize(); // Ensure initialized
                        await debugLogManager.removeLogsByIds(orgId, logIds);
                    }
                }
            } catch (cacheError) {
                console.error('Failed to remove logs from chrome.storage cache:', cacheError);
            }

            try {
                chrome.runtime.sendMessage({
                    type: 'LOGS_DELETED',
                    logIds: logIds,
                    orgDomain: orgDomain
                }).catch(() => { });
            } catch (broadcastError) { }

        } catch (queryError) {
            console.error('Failed to query logs for cleanup:', queryError.message);
        }

        await removeAutoTraceFlagMetadata(traceFlagId);
        await chrome.alarms.clear(`cleanup_traceflag_${traceFlagId}`);

    } catch (error) {
        console.error('Cleanup failed for trace flag:', traceFlagId, error);
    }
}
