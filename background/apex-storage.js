/**
 * Apex Storage Module
 * Handles persistence of anonymous Apex code blocks.
 */

export async function saveApexCodeToStorage(apexData) {
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

export async function getApexCodesFromStorage(orgId) {
    const storageKey = `apexCodes_${orgId}`;
    const result = await chrome.storage.local.get(storageKey);
    return result[storageKey] || [];
}

export async function updateApexCodeInStorage(apexData, orgId = null) {
    if (orgId) {
        const storageKey = `apexCodes_${orgId}`;
        const result = await chrome.storage.local.get(storageKey);
        const codes = result[storageKey] || [];
        const codeIndex = codes.findIndex(code => code.id === apexData.id);

        if (codeIndex !== -1) {
            const updated = {
                ...codes[codeIndex],
                ...apexData,
                timestamp: Date.now()
            };
            codes[codeIndex] = updated;
            await chrome.storage.local.set({ [storageKey]: codes });
            return updated;
        }
    }

    // Fallback: search all (legacy support or if orgId missing)
    const allStorage = await chrome.storage.local.get(null);
    for (const key of Object.keys(allStorage)) {
        if (key.startsWith('apexCodes_')) {
            const codes = allStorage[key];
            const codeIndex = codes.findIndex(code => code.id === apexData.id);

            if (codeIndex !== -1) {
                const updated = {
                    ...codes[codeIndex],
                    ...apexData,
                    timestamp: Date.now()
                };
                codes[codeIndex] = updated;
                await chrome.storage.local.set({ [key]: codes });
                return updated;
            }
        }
    }

    throw new Error('Apex code not found for update');
}

export async function deleteApexCodeFromStorage(id, orgId = null) {
    if (orgId) {
        const storageKey = `apexCodes_${orgId}`;
        const result = await chrome.storage.local.get(storageKey);
        const codes = result[storageKey] || [];
        const updatedCodes = codes.filter(code => code.id !== id);

        if (updatedCodes.length !== codes.length) {
            await chrome.storage.local.set({ [storageKey]: updatedCodes });
            return;
        }
    }

    // Fallback search
    const allStorage = await chrome.storage.local.get(null);
    for (const key of Object.keys(allStorage)) {
        if (key.startsWith('apexCodes_')) {
            const codes = allStorage[key];
            const updatedCodes = codes.filter(code => code.id !== id);

            if (updatedCodes.length !== codes.length) {
                await chrome.storage.local.set({ [key]: updatedCodes });
                break;
            }
        }
    }
}
