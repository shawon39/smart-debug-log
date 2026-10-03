'use strict';
// L9 / C6 / F9: Apex snippet storage in background/apex-storage.js.
// - snippets are keyed by the 15-character org ID (session cookie) even when the 18-character
//   ID (OAuth identity URL) is passed; old 18-character and "unknown" keys are merged in safely
// - only whitelisted fields are stored and a new id is always generated
// - an import is saved with one storage write; there is no scan of all storage
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ORG15 = '00D5g000004XyZa';
const ORG18 = `${ORG15}EAQ`;
const KEY = `apexCodes_${ORG15}`;

function installChrome(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  const calls = { get: [], set: 0, remove: [] };
  globalThis.chrome = {
    storage: {
      local: {
        get: async keys => {
          calls.get.push(keys);
          if (keys == null) return JSON.parse(JSON.stringify(data));
          const out = {};
          [].concat(keys).forEach(k => { if (k in data) out[k] = JSON.parse(JSON.stringify(data[k])); });
          return out;
        },
        set: async items => { calls.set++; Object.assign(data, JSON.parse(JSON.stringify(items))); },
        remove: async keys => { calls.remove.push(keys); [].concat(keys).forEach(k => { delete data[k]; }); }
      }
    }
  };
  return { data, calls };
}

const storagePromise = import(pathToFileURL(path.join(__dirname, '..', 'background', 'apex-storage.js')).href);
const snippet = (id, name, code, extra = {}) => ({ id, name, code, orgId: ORG15, timestamp: 1700000000000, ...extra });

test('L9: org IDs are normalised to the 15-character prefix', async () => {
  const { normalizeOrgId } = await storagePromise;
  assert.strictEqual(normalizeOrgId(ORG18), ORG15);
  assert.strictEqual(normalizeOrgId(ORG15), ORG15);
  for (const bad of ['unknown', '', null, undefined, '00D5g', `${ORG18}X`, 'acme.my.salesforce.com']) {
    assert.strictEqual(normalizeOrgId(bad), null, String(bad));
  }
});

test('L9: existing snippets (15-character key) load with the 18-character OAuth org ID, nothing is rewritten', async () => {
  const { getApexCodesFromStorage } = await storagePromise;
  const existing = [snippet('apex_1', 'Reset', 'update accs;')];
  const { calls } = installChrome({ [KEY]: existing });
  assert.deepStrictEqual(await getApexCodesFromStorage(ORG18), existing);
  assert.deepStrictEqual(await getApexCodesFromStorage(ORG15), existing);
  assert.strictEqual(calls.set, 0);
  assert.deepStrictEqual(calls.remove, []);
});

test('L9: 18-character and "unknown" keys are merged into the 15-character key without losing data', async () => {
  const { getApexCodesFromStorage } = await storagePromise;
  const current = snippet('apex_1', 'Reset', 'update accs;');
  const same = snippet('apex_1', 'Reset', 'update accs;', { orgId: ORG18 }); // same snippet saved twice
  const clash = snippet('apex_2', 'Other', 'System.debug(2);', { orgId: ORG18 });
  const sameIdDifferent = snippet('apex_1', 'Reset v2', 'update accs; // changed', { orgId: ORG18 });
  const unknown = snippet('apex_3', 'From unknown org', 'System.debug(3);', { orgId: 'unknown', type: 'SAVE_APEX_CODE' });
  const { data, calls } = installChrome({
    [KEY]: [current],
    [`apexCodes_${ORG18}`]: [same, clash, sameIdDifferent],
    apexCodes_unknown: [unknown],
    apexCodes_00D000000000001: [snippet('apex_9', 'Another org', 'x')]
  });

  const codes = await getApexCodesFromStorage(ORG18);

  assert.deepStrictEqual(codes.map(c => c.code).sort(), [
    'System.debug(2);', 'System.debug(3);', 'update accs;', 'update accs; // changed'
  ]);
  assert.strictEqual(new Set(codes.map(c => c.id)).size, codes.length, 'ids stay unique');
  assert.ok(codes.every(c => c.orgId === ORG15));
  assert.ok(codes.every(c => Object.keys(c).sort().join() === 'code,id,name,orgId,timestamp'), 'stray fields dropped');
  assert.deepStrictEqual(data[KEY], codes, 'merged list is saved under the 15-character key');
  assert.ok(!(`apexCodes_${ORG18}` in data) && !('apexCodes_unknown' in data), 'old keys removed after saving');
  assert.strictEqual(data.apexCodes_00D000000000001.length, 1, 'other orgs are untouched');
  assert.ok(calls.get.every(keys => keys != null), 'never reads all of storage');
});

test('L9: old keys are kept when saving the merged list fails', async () => {
  const { getApexCodesFromStorage } = await storagePromise;
  const { data } = installChrome({ apexCodes_unknown: [snippet('apex_3', 'Keep me', 'x')] });
  chrome.storage.local.set = async () => { throw new Error('QUOTA_BYTES quota exceeded'); };
  await assert.rejects(getApexCodesFromStorage(ORG18), /quota/);
  assert.strictEqual(data.apexCodes_unknown.length, 1);
});

test('C6: a save stores only the snippet fields and always generates the id', async () => {
  const { saveApexCodeToStorage } = await storagePromise;
  const { data } = installChrome({});
  const record = await saveApexCodeToStorage({ type: 'SAVE_APEX_CODE', id: 'apex_chosen_by_caller', name: 'Check', code: 'System.debug(1);', orgId: ORG18, sfHost: 'acme' });

  assert.deepStrictEqual(Object.keys(record).sort(), ['code', 'id', 'name', 'orgId', 'timestamp']);
  assert.notStrictEqual(record.id, 'apex_chosen_by_caller');
  assert.match(record.id, /^apex_\d+_[a-z0-9]+$/);
  assert.strictEqual(record.orgId, ORG15);
  assert.deepStrictEqual(data[KEY], [record]);
});

test('F9: an import is saved with one storage write', async () => {
  const { saveApexCodeToStorage } = await storagePromise;
  const { data, calls } = installChrome({ [KEY]: [snippet('apex_1', 'Reset', 'update accs;')] });
  const items = [{ name: 'A', code: 'a' }, { name: 'B', code: 'b' }, { name: 'C', code: 'c' }];
  const records = await saveApexCodeToStorage({ orgId: ORG15, items });

  assert.strictEqual(calls.set, 1);
  assert.deepStrictEqual(records.map(r => r.name), ['A', 'B', 'C']);
  assert.strictEqual(new Set(records.map(r => r.id)).size, 3);
  assert.strictEqual(data[KEY].length, 4);
});

test('C6: update and delete need the org ID and never scan all of storage', async () => {
  const { updateApexCodeInStorage, deleteApexCodeFromStorage } = await storagePromise;
  const { data, calls } = installChrome({ [KEY]: [snippet('apex_1', 'Reset', 'old', { type: 'SAVE_APEX_CODE' })] });

  const updated = await updateApexCodeInStorage({ id: 'apex_1', name: 'Reset 2', code: 'new', type: 'UPDATE_APEX_CODE' }, ORG18);
  assert.deepStrictEqual(Object.keys(updated).sort(), ['code', 'id', 'name', 'orgId', 'timestamp']);
  assert.strictEqual(data[KEY][0].code, 'new');
  await assert.rejects(updateApexCodeInStorage({ id: 'apex_missing', name: 'x', code: 'x' }, ORG15), /not found/);

  await assert.rejects(deleteApexCodeFromStorage('apex_1', null), /org ID is missing/);
  await deleteApexCodeFromStorage('apex_1', ORG15);
  assert.deepStrictEqual(data[KEY], []);
  assert.ok(calls.get.every(keys => keys != null), 'never reads all of storage');
});
