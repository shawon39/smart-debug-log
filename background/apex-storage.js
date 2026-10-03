/**
 * Apex Storage Module
 * Handles persistence of anonymous Apex code blocks.
 * Snippets are stored per org under `apexCodes_<15-character org ID>`.
 */

// Older versions could save snippets under these keys; they are merged into the 15-character key.
const UNKNOWN_ORG_KEY = 'apexCodes_unknown';

function newId() {
    return `apex_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

// The session cookie gives the 15-character org ID, the OAuth identity URL the 18-character one.
// Both start with the same 15 characters, so that prefix is the storage key.
export function normalizeOrgId(orgId) {
    const id = String(orgId || '').trim();
    return /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(id) ? id.substring(0, 15) : null;
}

function storageKeyFor(orgId) {
    const id15 = normalizeOrgId(orgId);
    if (!id15) throw new Error('Salesforce org ID is missing. Reopen the dashboard from a Salesforce tab.');
    return `apexCodes_${id15}`;
}

// Only these fields are stored; other request fields (type, sfHost, ...) are never saved.
function toRecord(data, orgId15) {
    return {
        id: data.id,
        name: typeof data.name === 'string' && data.name.trim() ? data.name : 'Untitled',
        code: typeof data.code === 'string' ? data.code : String(data.code ?? ''),
        orgId: orgId15,
        timestamp: data.timestamp || Date.now()
    };
}

// Reads the org's snippets. Snippets saved under the 18-character org ID or under "unknown"
// are merged in first; an old key is removed only after the merged list has been saved.
export async function getApexCodesFromStorage(orgId) {
    const storageKey = storageKeyFor(orgId);
    const orgId15 = normalizeOrgId(orgId);
    const fullId = String(orgId).trim();
    const legacyKeys = [UNKNOWN_ORG_KEY];
    if (fullId.length === 18) legacyKeys.push(`apexCodes_${fullId}`);

    const stored = await chrome.storage.local.get([storageKey, ...legacyKeys]);
    const codes = Array.isArray(stored[storageKey]) ? stored[storageKey] : [];
    const oldKeys = legacyKeys.filter(key => Array.isArray(stored[key]));
    if (oldKeys.length === 0) return codes;

    const merged = codes.slice();
    for (const key of oldKeys) {
        for (const record of stored[key]) {
            if (!record || typeof record !== 'object') continue;
            const sameId = merged.find(code => code.id === record.id);
            if (sameId && sameId.code === record.code && sameId.name === record.name) continue; // already there
            // Keep both versions when two different snippets share an id.
            merged.push(toRecord({ ...record, id: sameId || !record.id ? newId() : record.id }, orgId15));
        }
    }
    await chrome.storage.local.set({ [storageKey]: merged });
    await chrome.storage.local.remove(oldKeys);
    return merged;
}

// Saves one snippet ({ name, code, orgId }), or every snippet in { orgId, items: [{ name, code }] }
// with a single storage write (used by import). A new id is always generated.
export async function saveApexCodeToStorage(apexData) {
    const storageKey = storageKeyFor(apexData.orgId);
    const orgId15 = normalizeOrgId(apexData.orgId);
    const isBatch = Array.isArray(apexData.items);
    const items = isBatch ? apexData.items : [apexData];

    const codes = await getApexCodesFromStorage(apexData.orgId);
    const records = items.map(item => toRecord({ name: item?.name, code: item?.code, id: newId(), timestamp: Date.now() }, orgId15));

    await chrome.storage.local.set({ [storageKey]: codes.concat(records) });
    return isBatch ? records : records[0];
}

export async function updateApexCodeInStorage(apexData, orgId) {
    const storageKey = storageKeyFor(orgId);
    const codes = await getApexCodesFromStorage(orgId);
    const codeIndex = codes.findIndex(code => code.id === apexData.id);
    if (codeIndex === -1) throw new Error('Apex code not found for update');

    const updated = toRecord({
        ...codes[codeIndex],
        name: apexData.name,
        code: apexData.code,
        timestamp: Date.now()
    }, normalizeOrgId(orgId));
    codes[codeIndex] = updated;
    await chrome.storage.local.set({ [storageKey]: codes });
    return updated;
}

export async function deleteApexCodeFromStorage(id, orgId) {
    const storageKey = storageKeyFor(orgId);
    const codes = await getApexCodesFromStorage(orgId);
    const updatedCodes = codes.filter(code => code.id !== id);

    if (updatedCodes.length !== codes.length) {
        await chrome.storage.local.set({ [storageKey]: updatedCodes });
    }
}
