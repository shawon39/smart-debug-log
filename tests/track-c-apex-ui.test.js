'use strict';
// Execute Apex modal: D5 snippet selection and unsaved changes, L5 compile error display,
// L8 listeners bound once, F9 save/import errors and limits, S8 names/ids as text, C6 no session sent.
const test = require('node:test');
const assert = require('node:assert');
const { loadScripts, dashboardBody, flush } = require('./track-c-dom');

const APEX_FILES = ['js/core/icons.js', 'js/core/basic-utilities.js', 'js/apex/apex-storage-service.js', 'js/apex/apex-code-manager.js',
  'js/apex/apex-code-ui.js', 'js/apex/apex-executor.js'];
const ORG = '00D5g000004XyZaEAQ';
const SNIPPETS = [
  { id: 'apex_A', name: 'Reset accounts', code: 'update accs;', orgId: ORG, timestamp: 1 },
  { id: 'apex_B', name: 'Check limits', code: 'System.debug(Limits.getQueries());', orgId: ORG, timestamp: 2 }
];

async function setup({ snippets = SNIPPETS, respond, confirm } = {}) {
  const env = loadScripts(APEX_FILES, {
    html: dashboardBody(),
    confirm,
    handler: async message => {
      const custom = respond && await respond(message);
      if (custom) return custom;
      if (message.type === 'GET_APEX_CODES') return { success: true, data: snippets };
      if (message.type === 'UPDATE_APEX_CODE') return { success: true, data: { ...snippets.find(s => s.id === message.id), name: message.name, code: message.code } };
      if (message.type === 'SAVE_APEX_CODE') return { success: true, data: message.items ? message.items.map((it, i) => ({ id: `apex_new${i}`, ...it })) : { id: 'apex_new', name: message.name, code: message.code } };
      return { success: true, data: {} };
    }
  });
  const manager = env.ctx.apexCodeManager;
  manager.setupModalEventListeners();
  await manager.initialize(ORG);
  manager.openModal();
  env.runTimeouts(); // older versions bound the editor listeners in a timeout
  return { env, manager, doc: env.document, editor: env.document.getElementById('apexCodeEditor') };
}

const listItem = (doc, id) => doc.querySelectorAll('.apex-code-item').find(item => item.dataset.id === id);
const sentOfType = (env, type) => env.sent.filter(m => m.type === type);

test('D5: emptying the editor keeps the snippet selected, so Save updates it', async () => {
  const { env, manager, doc, editor } = await setup();
  listItem(doc, 'apex_A').click();
  env.input(editor, '');
  assert.strictEqual(manager.currentSelectedCode.id, 'apex_A');
  assert.ok(listItem(doc, 'apex_A').classList.contains('selected'));

  env.input(editor, 'update accs; // new');
  await manager.saveOrUpdateCurrentCode();
  assert.strictEqual(sentOfType(env, 'SAVE_APEX_CODE').length, 0, 'no duplicate snippet');
  const [update] = sentOfType(env, 'UPDATE_APEX_CODE');
  assert.strictEqual(update.id, 'apex_A');
  assert.strictEqual(update.code, 'update accs; // new');
});

test('D5: unsaved changes are kept unless the user agrees to drop them', async () => {
  let answer = false;
  const { env, manager, doc, editor } = await setup({ confirm: () => answer });
  listItem(doc, 'apex_A').click();
  env.input(editor, 'update accs; // edited');
  assert.strictEqual(env.windowTarget.listenerCount('beforeunload'), 1, 'closing the tab asks first');

  listItem(doc, 'apex_B').click();
  manager.addNewCodeBlock();
  assert.strictEqual(editor.value, 'update accs; // edited');
  assert.strictEqual(manager.currentSelectedCode.id, 'apex_A');
  assert.strictEqual(env.confirms.length, 2);

  answer = true;
  listItem(doc, 'apex_B').click();
  assert.strictEqual(manager.currentSelectedCode.id, 'apex_B');
  assert.strictEqual(editor.value, SNIPPETS[1].code);
  assert.strictEqual(env.windowTarget.listenerCount('beforeunload'), 0, 'no prompt once nothing is unsaved');
});

test('D5: closing and reopening the modal keeps the editor content', async () => {
  const { env, manager, editor } = await setup();
  env.input(editor, 'System.debug(42);');
  manager.closeModal();
  manager.openModal();
  assert.strictEqual(editor.value, 'System.debug(42);');
  assert.strictEqual(manager.hasUnsavedChanges, true);
});

test('L8: opening the modal many times binds the editor and search listeners once', async () => {
  const { env, manager, doc, editor } = await setup();
  for (let i = 0; i < 5; i++) { manager.closeModal(); manager.openModal(); env.runTimeouts(); }
  assert.strictEqual(editor.listenerCount('input'), 1);
  assert.strictEqual(doc.getElementById('apexSearchInput').listenerCount('input'), 1);
  assert.strictEqual(doc.getElementById('editApexTitleBtn').listenerCount('click'), 1);
});

test('L5: a compile error shows its line and column and marks the line', async () => {
  const { env, doc, editor } = await setup();
  env.input(editor, '\n\nInteger x = ;\nSystem.debug(x);');
  env.ctx.apexExecutor.displayExecutionResult({ compiled: false, success: false, line: 3, column: 13, compileProblem: 'Unexpected token \';\'.' });

  const results = doc.getElementById('resultsContent');
  assert.strictEqual(results.querySelector('.result-title').textContent, 'Compile error at line 3, column 13');
  assert.match(results.textContent, /Unexpected token ';'\./);
  const lines = doc.querySelectorAll('#lineNumbers .line-number');
  assert.deepStrictEqual(lines.map(l => l.classList.contains('error-line')), [false, false, true, false]);
  assert.deepStrictEqual([editor.selectionStart, editor.selectionEnd], [2, 2 + 'Integer x = ;'.length]);
});

test('L5: success and runtime errors never show "-1" positions', async () => {
  const { env, doc } = await setup();
  const results = doc.getElementById('resultsContent');

  env.ctx.apexExecutor.displayExecutionResult({ compiled: true, success: true, line: -1, column: -1, compileProblem: null });
  assert.strictEqual(results.querySelector('.result-title').textContent, 'Execution Successful');
  assert.doesNotMatch(results.textContent, /-1|Line/);

  env.ctx.apexExecutor.displayExecutionResult({ compiled: true, success: false, line: 2, column: 1, exceptionMessage: 'System.NullPointerException: Attempt to de-reference a null object', exceptionStackTrace: 'AnonymousBlock: line 2, column 1' });
  assert.strictEqual(results.querySelector('.result-title').textContent, 'Runtime exception');
  assert.match(results.textContent, /NullPointerException/);

  env.ctx.apexExecutor.displayExecutionResult({ compiled: false, success: false, line: -1, column: -1, compileProblem: 'Something is wrong' });
  assert.strictEqual(results.querySelector('.result-title').textContent, 'Compile error');
});

test('L5 / C6: execution keeps leading lines and sends no session', async () => {
  const { env } = await setup({ respond: m => m.type === 'EXECUTE_ANONYMOUS' ? { success: true, data: { compiled: true, success: true, line: -1, column: -1 } } : null });
  await env.ctx.apexExecutor.executeApexCode('\n\nSystem.debug(1);\n  \n');
  const [run] = sentOfType(env, 'EXECUTE_ANONYMOUS');
  assert.deepStrictEqual(run, { type: 'EXECUTE_ANONYMOUS', code: '\n\nSystem.debug(1);', sfHost: 'acme.my.salesforce.com' });
});

test('F9: a failed save gives the reason (storage full is explained)', async () => {
  const { env, manager, editor } = await setup({ respond: m => m.type === 'SAVE_APEX_CODE' ? { success: false, error: 'QUOTA_BYTES quota exceeded' } : null });
  manager.addNewCodeBlock();
  env.input(editor, 'System.debug(1);');
  await assert.rejects(manager.saveOrUpdateCurrentCode(), /Extension storage is full/);

  manager.currentOrgId = null;
  await assert.rejects(manager.saveOrUpdateCurrentCode(), /Salesforce org not found/);
});

test('F9: import skips duplicates and very large snippets and saves with one message', async () => {
  const { env, manager } = await setup();
  const json = JSON.stringify({ snippets: [
    { name: 'Reset accounts', code: 'update accs;' },          // already saved
    { name: 'New one', code: 'System.debug(7);\r\n' },          // imported (line ending normalised)
    { name: 'New one', code: 'System.debug(7);' },              // repeated in the file
    { name: 'Huge', code: 'x'.repeat(100001) },                 // too large
    { name: 'Empty', code: '   ' }                              // empty
  ] });
  await manager.importApexCodes({ size: Buffer.byteLength(json), text: async () => json });

  const saves = sentOfType(env, 'SAVE_APEX_CODE');
  assert.strictEqual(saves.length, 1);
  assert.deepStrictEqual(saves[0].items, [{ name: 'New one', code: 'System.debug(7);' }]);
  assert.strictEqual(env.alerts.at(-1), 'Imported 1 code block(s). Skipped 3 empty or already saved. Skipped 1 larger than 100,000 characters.');

  await manager.importApexCodes({ size: 3 * 1024 * 1024, text: async () => json });
  assert.strictEqual(sentOfType(env, 'SAVE_APEX_CODE').length, 1);
  assert.strictEqual(env.alerts.at(-1), 'Import failed: The file is larger than 2 MB');
});

test('S8: snippet names and ids are never turned into HTML', async () => {
  const evil = { id: 'apex_1" onclick="alert(1)', name: '<img src=x onerror=alert(1)>', code: 'x', orgId: ORG, timestamp: 1 };
  const { doc } = await setup({ snippets: [evil] });
  const list = doc.getElementById('apexCodeList');
  assert.strictEqual(list.querySelectorAll('img').length, 0);
  assert.strictEqual(list.querySelector('.apex-code-name').textContent, evil.name);
  assert.ok(list.querySelectorAll('*').every(el => !el.hasAttribute('onclick')));
  assert.strictEqual(list.querySelector('.apex-code-item').dataset.id, evil.id);
});

test('L9: without an org the list says so instead of looking empty', async () => {
  const env = loadScripts(APEX_FILES, { html: dashboardBody() });
  await env.ctx.apexCodeManager.initialize(null);
  assert.match(env.document.getElementById('apexCodeList').textContent, /Org not found/);
});
