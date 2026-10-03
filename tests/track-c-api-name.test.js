'use strict';
// L7: debug level API names must follow Salesforce's DeveloperName rules, the create form must offer
// DataAccess, Nba and Wave, and a failed create must show Salesforce's own error text.
const test = require('node:test');
const assert = require('node:assert');
const { loadScripts, dashboardBody, flush } = require('./track-c-dom');

const MANAGER_FILES = ['js/icons.js', 'js/basic-utilities.js', 'js/debug-level-creator.js', 'js/debug-log-manager-ui.js',
  'js/debug-log-ui-api.js', 'js/debug-log-ui-traceflags.js', 'js/debug-log-ui-rendering.js'];
const CATEGORIES = ['ApexCode', 'ApexProfiling', 'Database', 'System', 'Workflow', 'Validation', 'Callout', 'Visualforce', 'DataAccess', 'Nba', 'Wave'];
const LEVELS = ['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'FINE', 'FINER', 'FINEST'];

function describeWith(fields) {
  return { fields: fields.map(name => ({ name, picklistValues: LEVELS.map(value => ({ value, label: value, active: true })) })) };
}

function setup({ describe = describeWith(CATEGORIES), createResponse = { success: true, data: { id: '7dlNEW' } } } = {}) {
  const env = loadScripts(MANAGER_FILES, {
    html: dashboardBody(),
    handler: async message => {
      if (message.type === 'TOOLING_DESCRIBE') return { success: true, data: describe };
      if (message.type === 'TOOLING_CREATE') return createResponse;
      if (message.type === 'EXECUTE_TOOLING_QUERY') return { success: true, data: { records: [] } };
      return { success: true, data: {} };
    }
  });
  const ui = env.ctx.debugLogManagerUI;
  ui.sfHost = 'acme.my.salesforce.com';
  const DebugLevelCreator = env.get('DebugLevelCreator');
  return { env, ui, creator: new DebugLevelCreator(ui) };
}

test('L7: generated API names are valid DeveloperNames', () => {
  const { creator } = setup();
  const cases = {
    'Debug - Verbose': 'Debug_Verbose',
    'My Level ': 'My_Level',
    'Apex & DB': 'Apex_DB',
    '2024 Debug': 'Debug_2024_Debug',
    '_x': 'x',
    'Café Logs': 'Caf_Logs',
    'デバッグ': '',
    [`${'a'.repeat(39)} more`]: 'a'.repeat(39) // cut at 40 characters, then no trailing underscore
  };
  for (const [label, expected] of Object.entries(cases)) {
    const apiName = creator.generateApiName(label);
    assert.strictEqual(apiName, expected, `label ${JSON.stringify(label)}`);
    if (apiName) assert.ok(creator.isValidApiName(apiName), `${apiName} should be valid`);
  }
});

test('L7: validation uses the same rules as Salesforce', () => {
  const { env, creator } = setup();
  for (const name of ['A', 'My_Level', 'Debug_2024_Debug', 'A'.repeat(40)]) assert.strictEqual(creator.isValidApiName(name), true, name);
  for (const name of ['Debug__Verbose', 'My_Level_', '_x', '2024', 'Bad-Name', 'A'.repeat(41), '']) assert.strictEqual(creator.isValidApiName(name), false, name);

  const input = env.document.getElementById('debugLevelApiName');
  assert.strictEqual(creator.validateApiName('Debug__Verbose'), false);
  assert.ok(input.classList.contains('invalid'));
  assert.strictEqual(creator.validateApiName('Debug_Verbose'), true);
  assert.ok(!input.classList.contains('invalid'));
});

test('L7: the create form sends DataAccess, Nba and Wave', async () => {
  const { env, creator } = setup();
  await creator.openForm();
  env.document.getElementById('debugLevelLabel').value = 'Debug - Verbose';
  creator.handleLabelInput('Debug - Verbose');
  await creator.handleSubmit();

  const create = env.sent.find(m => m.type === 'TOOLING_CREATE');
  assert.ok(create, 'a DebugLevel create was sent');
  assert.strictEqual(create.data.DeveloperName, 'Debug_Verbose');
  for (const field of ['DataAccess', 'Nba', 'Wave']) assert.strictEqual(create.data[field], 'INFO', field);
  assert.strictEqual(create.data.ApexCode, 'DEBUG');
});

test('L7: a category the org does not offer is hidden and left out', async () => {
  const { env, creator } = setup({ describe: describeWith(CATEGORIES.filter(c => c !== 'Nba')) });
  await creator.openForm();
  const nba = env.document.getElementById('nbaLevel');
  assert.strictEqual(nba.disabled, true);
  assert.ok(nba.closest('.form-field').classList.contains('hidden'));

  env.document.getElementById('debugLevelLabel').value = 'Level';
  creator.handleLabelInput('Level');
  await creator.handleSubmit();
  const create = env.sent.find(m => m.type === 'TOOLING_CREATE');
  assert.ok(create, 'the form is still valid');
  assert.ok(!('Nba' in create.data));
  assert.strictEqual(create.data.Wave, 'INFO');
});

test('L7: a failed create shows the Salesforce error text', async () => {
  const error = 'Tooling create failed: 400 - [{"message":"Level names must be unique in the org","errorCode":"FIELD_INTEGRITY_EXCEPTION","fields":[]}]';
  const { env, creator } = setup({ createResponse: { success: false, error } });
  await creator.openForm();
  env.document.getElementById('debugLevelLabel').value = 'Level';
  creator.handleLabelInput('Level');
  await creator.handleSubmit();
  await flush();
  const note = env.document.querySelector('.debug-notification');
  assert.strictEqual(note.textContent, 'Failed to create debug level: Level names must be unique in the org');
});
