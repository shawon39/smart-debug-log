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

DebugLogManagerUI.prototype.getOrCreateDefaultDebugLevel = async function () {
    const existing = this.debugLevels.find(d => d.DeveloperName === 'SFDC_DevConsole');
    if (existing) return existing.Id;
    if (this.debugLevels.length > 0) return this.debugLevels[0].Id;

    const data = {
        DeveloperName: 'ExtensionDebug',
        MasterLabel: 'Extension Debug',
        ApexCode: 'FINEST',
        ApexProfiling: 'INFO',
        Database: 'INFO',
        System: 'DEBUG',
        Workflow: 'INFO',
        Validation: 'INFO',
        Callout: 'INFO',
        Visualforce: 'INFO'
    };

    const created = await this.toolingCreate('DebugLevel', data);
    await this.listDebugLevels();
    return created.id;
};

DebugLogManagerUI.prototype.listTraceFlags = async function () {
    const query = `SELECT Id, TracedEntityId, TracedEntity.Name, LogType, 
                 StartDate, ExpirationDate, DebugLevelId, DebugLevel.DeveloperName
                 FROM TraceFlag 
                 WHERE LogType = 'USER_DEBUG'
                 ORDER BY ExpirationDate DESC
                 LIMIT 100`;
    const result = await this.toolingQuery(query);
    this.traceFlags = result.records || [];

    const targetUserId = this.getTargetUserId();
    this.currentTraceFlag = this.traceFlags.find(tf => tf.TracedEntityId === targetUserId);

    await this.updateStatusIndicator();
    return this.traceFlags;
};

DebugLogManagerUI.prototype.createOrExtendTraceFlag = async function (debugLevelId, durationMinutes = 45) {
    const targetUserId = this.getTargetUserId();
    if (!targetUserId) throw new Error('User ID not available');

    const now = new Date();
    const expiration = new Date(now.getTime() + durationMinutes * 60 * 1000);
    const isDevConsole = this.isDebugLevelDevConsole(debugLevelId);

    if (isDevConsole) {
        const existingFlag = this.traceFlags.find(tf =>
            tf.TracedEntityId === targetUserId && tf.DebugLevelId === debugLevelId
        );
        if (existingFlag) {
            if (new Date(existingFlag.ExpirationDate) > now) {
                await this.extendTraceFlag(existingFlag.Id, durationMinutes);
                return { extended: true };
            } else {
                await this.toolingUpdate('TraceFlag', existingFlag.Id, {
                    StartDate: now.toISOString(),
                    ExpirationDate: expiration.toISOString(),
                    DebugLevelId: debugLevelId
                });
                await this.listTraceFlags();
                return { updated: true };
            }
        }
    }

    const data = {
        TracedEntityId: targetUserId,
        LogType: 'USER_DEBUG',
        DebugLevelId: debugLevelId,
        StartDate: now.toISOString(),
        ExpirationDate: expiration.toISOString()
    };

    try {
        const result = await this.toolingCreate('TraceFlag', data);
        await this.listTraceFlags();
        return result;
    } catch (error) {
        if (error.message && error.message.includes('already being traced')) {
            await this.listTraceFlags();
            const refreshedFlag = this.traceFlags.find(tf =>
                tf.TracedEntityId === targetUserId && tf.DebugLevelId === debugLevelId
            );
            if (refreshedFlag) {
                await this.toolingUpdate('TraceFlag', refreshedFlag.Id, {
                    StartDate: now.toISOString(),
                    ExpirationDate: expiration.toISOString(),
                    DebugLevelId: debugLevelId
                });
                await this.listTraceFlags();
                return { updated: true };
            }
        }
        throw error;
    }
};

DebugLogManagerUI.prototype.createOrExtendTraceFlagWithExpiration = async function (debugLevelId, durationMinutes = 45, customExpiration = null, customStartDate = null) {
    const targetUserId = this.getTargetUserId();
    if (!targetUserId) throw new Error('User ID not available');

    const now = new Date();
    const startDate = customStartDate || now;
    const expiration = customExpiration || new Date(now.getTime() + durationMinutes * 60 * 1000);
    const isDevConsole = this.isDebugLevelDevConsole(debugLevelId);

    if (isDevConsole) {
        const existingFlag = this.traceFlags.find(tf =>
            tf.TracedEntityId === targetUserId && tf.DebugLevelId === debugLevelId
        );
        if (existingFlag) {
            await this.toolingUpdate('TraceFlag', existingFlag.Id, {
                StartDate: startDate.toISOString(),
                ExpirationDate: expiration.toISOString(),
                DebugLevelId: debugLevelId
            });
            await this.listTraceFlags();
            return { extended: true };
        }
    }

    const data = {
        TracedEntityId: targetUserId,
        LogType: 'USER_DEBUG',
        DebugLevelId: debugLevelId,
        StartDate: startDate.toISOString(),
        ExpirationDate: expiration.toISOString()
    };

    try {
        const result = await this.toolingCreate('TraceFlag', data);
        await this.listTraceFlags();
        return result;
    } catch (error) {
        if (error.message && error.message.includes('already being traced')) {
            await this.listTraceFlags();
            const refreshedFlag = this.traceFlags.find(tf =>
                tf.TracedEntityId === targetUserId && tf.DebugLevelId === debugLevelId
            );
            if (refreshedFlag) {
                await this.toolingUpdate('TraceFlag', refreshedFlag.Id, {
                    StartDate: startDate.toISOString(),
                    ExpirationDate: expiration.toISOString(),
                    DebugLevelId: debugLevelId
                });
                await this.listTraceFlags();
                return { updated: true };
            }
        }
        throw error;
    }
};

DebugLogManagerUI.prototype.extendTraceFlag = async function (traceFlagId, additionalMinutes = 45) {
    const traceFlag = this.traceFlags.find(tf => tf.Id === traceFlagId);
    if (!traceFlag) throw new Error('Trace flag not found');

    const currentExpiration = new Date(traceFlag.ExpirationDate);
    const now = new Date();
    const baseTime = currentExpiration > now ? currentExpiration : now;
    const newExpiration = new Date(baseTime.getTime() + additionalMinutes * 60 * 1000);

    await this.toolingUpdate('TraceFlag', traceFlagId, { ExpirationDate: newExpiration.toISOString() });
    await this.listTraceFlags();
};

DebugLogManagerUI.prototype.expireTraceFlag = async function (traceFlagId) {
    const traceFlag = this.traceFlags.find(tf => tf.Id === traceFlagId);
    if (!traceFlag) throw new Error('Trace flag not found');
    await this.toolingUpdate('TraceFlag', traceFlagId, { ExpirationDate: new Date().toISOString() });
    await this.listTraceFlags();
};

DebugLogManagerUI.prototype.reduceTraceFlag = async function (traceFlagId, reduceMinutes = 45) {
    const traceFlag = this.traceFlags.find(tf => tf.Id === traceFlagId);
    if (!traceFlag) throw new Error('Trace flag not found');

    const currentExpiration = new Date(traceFlag.ExpirationDate);
    const now = new Date();
    const remainingMs = currentExpiration - now;
    const reduceMs = reduceMinutes * 60 * 1000;

    if (remainingMs <= reduceMs) {
        await this.toolingUpdate('TraceFlag', traceFlagId, { ExpirationDate: now.toISOString() });
        await this.listTraceFlags();
        return { disabled: true };
    }

    const newExpiration = new Date(currentExpiration.getTime() - reduceMs);
    await this.toolingUpdate('TraceFlag', traceFlagId, { ExpirationDate: newExpiration.toISOString() });
    await this.listTraceFlags();
    return { disabled: false };
};

DebugLogManagerUI.prototype.deleteTraceFlag = async function (traceFlagId) {
    await this.toolingDelete('TraceFlag', traceFlagId);
    await this.listTraceFlags();
};

DebugLogManagerUI.prototype.createTraceFlagWithRetry = async function (data, maxRetries = 2) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await this.toolingCreate('TraceFlag', data);
        } catch (error) {
            lastError = error;
            if (error.message && error.message.includes('already being traced') && attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 500));
                await this.listTraceFlags();
                continue;
            }
            throw error;
        }
    }
    throw lastError;
};

DebugLogManagerUI.prototype.deleteAllDebugLogs = async function () {
    if (!this.userId) throw new Error('User ID not available');
    const query = `SELECT Id FROM ApexLog WHERE LogUserId = '${this.userId}' ORDER BY StartTime DESC LIMIT 500`;
    const result = await this.toolingQuery(query);
    const logs = result.records || [];
    if (logs.length === 0) return { deleted: 0 };

    const logIds = logs.map(log => log.Id);
    const BATCH_SIZE = 5;
    let deleted = 0;
    let errors = [];

    for (let i = 0; i < logs.length; i += BATCH_SIZE) {
        const batch = logs.slice(i, i + BATCH_SIZE);
        const deletePromises = batch.map(log =>
            this.toolingDelete('ApexLog', log.Id)
                .then(() => { deleted++; return true; })
                .catch(err => { errors.push(err.message); return false; })
        );
        await Promise.all(deletePromises);
    }
    return { deleted, total: logs.length, errors, logIds };
};
