/**
 * Debug Log Manager UI - Trace Flags Methods
 * Extends DebugLogManagerUI prototype with Trace Flag and Debug Level management.
 */

DebugLogManagerUI.prototype.listDebugLevels = async function () {
    const query = `SELECT Id, DeveloperName, MasterLabel, ApexCode, Database, System, Workflow, Visualforce, Callout
                 FROM DebugLevel
                 ORDER BY MasterLabel
                 LIMIT 100`;
    const result = await this.toolingQuery(query);
    this.debugLevels = result.records || [];
    return this.debugLevels;
};

// Lists user, Developer Console and class/trigger trace flags. Salesforce allows one trace flag at a
// time per traced entity and log type, so conflict checks only compare flags of the same LogType.
DebugLogManagerUI.prototype.listTraceFlags = async function () {
    const query = `SELECT Id, TracedEntityId, TracedEntity.Name, LogType,
                 StartDate, ExpirationDate, DebugLevelId, DebugLevel.DeveloperName, CreatedBy.Name
                 FROM TraceFlag
                 WHERE LogType IN ('USER_DEBUG', 'DEVELOPER_LOG', 'CLASS_TRACING')
                 ORDER BY ExpirationDate DESC
                 LIMIT 100`;
    const result = await this.toolingQuery(query);
    this.traceFlags = result.records || [];

    await this.updateStatusIndicator();
    return this.traceFlags;
};

// A USER_DEBUG flag of this user and debug level may be reused only when changing it cannot cut
// other tracing short: it has expired, or it overlaps the requested time anyway.
DebugLogManagerUI.prototype.findReusableTraceFlag = function (userId, debugLevelId, start, end, now = new Date()) {
    return this.traceFlags.find(tf => {
        if (tf.LogType !== 'USER_DEBUG' || tf.TracedEntityId !== userId || tf.DebugLevelId !== debugLevelId) return false;
        const tfStart = new Date(tf.StartDate), tfEnd = new Date(tf.ExpirationDate);
        return tfEnd <= now || (start < tfEnd && end > tfStart);
    });
};

DebugLogManagerUI.prototype.createOrExtendTraceFlagWithExpiration = async function (debugLevelId, durationMinutes = 45, customExpiration = null, customStartDate = null) {
    const targetUserId = this.getTargetUserId();
    if (!targetUserId) throw new Error('User ID not available');

    const now = new Date();
    const startDate = customStartDate || now;
    const expiration = customExpiration || new Date(now.getTime() + durationMinutes * 60 * 1000);
    const dates = {
        StartDate: startDate.toISOString(),
        ExpirationDate: expiration.toISOString(),
        DebugLevelId: debugLevelId
    };

    if (this.isDebugLevelDevConsole(debugLevelId)) {
        const existingFlag = this.findReusableTraceFlag(targetUserId, debugLevelId, startDate, expiration, now);
        if (existingFlag) return await this.updateTraceFlagDates(existingFlag, dates, now);
    }

    try {
        const result = await this.toolingCreate('TraceFlag', { TracedEntityId: targetUserId, LogType: 'USER_DEBUG', ...dates });
        await this.listTraceFlags();
        return result;
    } catch (error) {
        if (error.message && error.message.includes('already being traced')) {
            await this.listTraceFlags();
            const refreshedFlag = this.findReusableTraceFlag(targetUserId, debugLevelId, startDate, expiration, now);
            if (refreshedFlag) return await this.updateTraceFlagDates(refreshedFlag, dates, now);
        }
        throw error;
    }
};

// Moves an existing flag to new dates. `replaced` tells the caller a flag that was still running
// or scheduled was changed (not just an expired one reused).
DebugLogManagerUI.prototype.updateTraceFlagDates = async function (traceFlag, dates, now) {
    const wasExpired = new Date(traceFlag.ExpirationDate) <= now;
    await this.toolingUpdate('TraceFlag', traceFlag.Id, dates);
    await this.listTraceFlags();
    return { updated: true, replaced: !wasExpired };
};

// Salesforce rejects a trace flag that ends more than 24 hours after its StartDate. When an
// extension would pass that, the flag restarts now and ends at most 24 hours from now.
DebugLogManagerUI.prototype.computeExtension = function (traceFlag, additionalMinutes, now = new Date()) {
    const MAX_SPAN_MS = 24 * 60 * 60 * 1000;
    const currentExpiration = new Date(traceFlag.ExpirationDate);
    const baseTime = currentExpiration > now ? currentExpiration : now;
    const expiration = new Date(baseTime.getTime() + additionalMinutes * 60 * 1000);

    if (expiration - new Date(traceFlag.StartDate) <= MAX_SPAN_MS) {
        return { data: { ExpirationDate: expiration.toISOString() }, expiration, capped: false };
    }
    const cappedExpiration = new Date(Math.min(expiration.getTime(), now.getTime() + MAX_SPAN_MS));
    return {
        data: { StartDate: now.toISOString(), ExpirationDate: cappedExpiration.toISOString() },
        expiration: cappedExpiration,
        capped: cappedExpiration < expiration
    };
};

DebugLogManagerUI.prototype.extendTraceFlag = async function (traceFlagId, additionalMinutes = 45) {
    const traceFlag = this.traceFlags.find(tf => tf.Id === traceFlagId);
    if (!traceFlag) throw new Error('Trace flag not found');

    const extension = this.computeExtension(traceFlag, additionalMinutes);
    await this.toolingUpdate('TraceFlag', traceFlagId, extension.data);
    await this.listTraceFlags();
    return extension;
};

// When less time is left than the reduction, the flag ends now (never a time in the past).
DebugLogManagerUI.prototype.reduceTraceFlag = async function (traceFlagId, reduceMinutes = 45) {
    const traceFlag = this.traceFlags.find(tf => tf.Id === traceFlagId);
    if (!traceFlag) throw new Error('Trace flag not found');

    const now = new Date();
    const newExpiration = new Date(new Date(traceFlag.ExpirationDate).getTime() - reduceMinutes * 60 * 1000);
    const endsNow = newExpiration <= now;
    await this.toolingUpdate('TraceFlag', traceFlagId, { ExpirationDate: (endsNow ? now : newExpiration).toISOString() });
    await this.listTraceFlags();
    return { disabled: endsNow };
};

// Changes a flag in place (debug level and time). Unlike delete + create, a failed
// change leaves the old flag as it was, so tracing never stops by accident.
DebugLogManagerUI.prototype.replaceTraceFlag = async function (traceFlagId, debugLevelId, startDate, expirationDate) {
    await this.toolingUpdate('TraceFlag', traceFlagId, {
        DebugLevelId: debugLevelId,
        StartDate: startDate.toISOString(),
        ExpirationDate: expirationDate.toISOString()
    });
    await this.listTraceFlags();
};

DebugLogManagerUI.prototype.deleteTraceFlag = async function (traceFlagId) {
    await this.toolingDelete('TraceFlag', traceFlagId);
    await this.listTraceFlags();
};

// Deletes every debug log of one user in this org with one background call.
// Returns { deleted, failed, errors, deletedIds }.
DebugLogManagerUI.prototype.deleteAllDebugLogs = async function (userId) {
    if (!userId) throw new Error('User ID not available');
    return await this.deleteApexLogs(userId);
};
