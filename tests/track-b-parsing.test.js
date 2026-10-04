// Track B: debug message parsing and formatting (regression corpus, bug fixes, timing).
// Loads the dashboard's classic scripts into a vm context with a tiny DOM stand-in.
// Run: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// escapeHtml / decodeHtmlEntities use a <div> and a <textarea>; mimic what the browser returns
function escapeLikeDom(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;'); }
function decodeLikeTextarea(s) {
  return String(s).replace(/&(lt|gt|amp|quot|apos|#39|#x27|nbsp);/g, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", '#39': "'", '#x27': "'", nbsp: ' ' })[e]);
}

function loadPipeline() {
  const document = {
    createElement(tag) {
      const el = { _t: '' };
      Object.defineProperty(el, 'textContent', { set(v) { this._t = String(v); }, get() { return this._t; } });
      Object.defineProperty(el, 'innerHTML', { set(v) { this._t = tag === 'textarea' ? decodeLikeTextarea(v) : v; }, get() { return escapeLikeDom(this._t); } });
      Object.defineProperty(el, 'value', { get() { return this._t; } });
      return el;
    },
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {},
  };
  const ctx = { document, console, setTimeout, clearTimeout, URLSearchParams, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, length: 0, key() { return null; } }, chrome: { runtime: { onMessage: { addListener() {} } } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['icons.js', 'basic-utilities.js', 'basic-parsing.js', 'complex-parsing.js', 'salesforce-response-cleaner.js',
    'formatting-utilities.js', 'error-extraction.js', 'syntax-highlighting.js', 'log-parsing.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext('var toasts = []; var showToast = (m) => toasts.push(m); var elements = { debugContent: { innerHTML: "" }, errorContent: { innerHTML: "" }, limitsContent: { innerHTML: "" } };', ctx);
  // Lexical globals (const/let/function) are reached through the context by name
  return new Proxy({}, { get: (_, name) => vm.runInContext(String(name), ctx) });
}

const P = loadPipeline();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const logFor = (msg, level = 'DEBUG') => ['62.0 APEX_CODE,FINEST;APEX_PROFILING,INFO', '12:00:00.001 (1000)|EXECUTION_STARTED',
  `12:00:00.002 (2000)|USER_DEBUG|[5]|${level}|${msg}`, '12:00:00.003 (3000)|CODE_UNIT_FINISHED|x', '12:00:00.004 (4000)|EXECUTION_FINISHED'].join('\n');
// Renders a log through the debug messages view and returns the panel HTML
function render(log) {
  P.displayDebugContent(P.parseDebugLogContent(log));
  return P.elements.debugContent.innerHTML;
}
const textOf = (html) => html.replace(/<span class="line-number">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const parse = (s) => JSON.parse(JSON.stringify(P.parseSalesforceObjectNotation(s)));

// Regression corpus: System.debug.md examples and common messages whose output was already right.
// [id, message, sha256 prefix of the HTML rendered by the code before the fix, readable text]
const GOOD_CASES = [
  ["prim-int", "123", '5a1048fefc0433a7', "123"],
  ["prim-neg", "-5", '99e1150f273f3f8c', "-5"],
  ["prim-dec", "3.14", '3a9ca66fb795a72c', "3.14"],
  ["prim-true", "true", '4b0d5a7f278ff461', "true"],
  ["prim-null", "null", 'bc3e2477abfe8561', "null"],
  ["prim-datetime-iso", "2020-01-28T22:30:48Z", 'd4edc6ec2f5b7cbb', "2020-01-28T22:30:48Z"],
  ["prim-datetime", "2020-01-28 23:52:20", '918e8338bff6cf88', "2020-01-28 23:52:20"],
  ["prim-string", "Hello world", 'b408ae28ba28329b', "Hello world"],
  ["text-plain", "Starting sync for 3 accounts", '6e635a2673c6530a', "Starting sync for 3 accounts"],
  ["text-out-of", "Processing record 5 out of 10", '5ff838222342239c', "Processing record 5 out of 10"],
  ["text-equals", "Value = 42", 'b1a32f1a858131d4', "Value = 42"],
  ["text-generic", "Map<String,Object> created", '07fa3362e4fdb712', "Map<String,Object> created"],
  ["text-init", "Constructor <init> called", '13b6bb85e72b70a2', "Constructor <init> called"],
  ["text-brackets", "Values [1, 2, 3] were processed for accounts", '5ffe215dac45d32c', "Values [1, 2, 3] were processed for accounts"],
  ["text-pipes", "a|b|c with pipes", 'fc69e3bee3f7a6f6', "a|b|c with pipes"],
  ["text-multiline", "line one\nline two\n  indented three", '8ccdcb923144c5ee', "line one line two indented three"],
  ["sobj-doc", "Account:{Name=Test Account, BillingStreet=123 Test Dr, BillingCity=Test City}", '410422c2dd3522d6', "{ \"_apexType\": \"Account\", \"Name\": \"Test Account\", \"BillingStreet\": \"12"],
  ["sobj-stub", "Account:{Id=001Hn00003, Name=Initech, Industry=Finance}", 'cb5e5f3ee3672479', "{ \"_apexType\": \"Account\", \"Id\": \"001Hn00003\", \"Name\": \"Initech\", \"Indu"],
  ["sobj-address", "Account:{Name=Acme, BillingAddress=API address [ The Landmark @ One Market, SanFrancisco, CA, 94105, US, null ], Id=001A}", '92145885b548aadf', "{ \"_apexType\": \"Account\", \"Name\": \"Acme\", \"BillingAddress\": \"API addre"],
  ["sobj-custom", "MyCustom__c:{Id=a01A, Name=Rec 1, Count__c=3}", '43b209533d098fbd', "{ \"_apexType\": \"MyCustom__c\", \"Id\": \"a01A\", \"Name\": \"Rec 1\", \"Count__c"],
  ["sobj-arrow", "Full Account → Account:{Id=001A, Name=Acme}", 'ed21ce1d58201b73', "Full Account → { \"_apexType\": \"Account\", \"Id\": \"001A\", \"Name\": \"Acme\" "],
  ["sobj-prefix", "Inserted account: Account:{Id=001A, Name=Acme}", 'd633cd280258f74c', "Inserted account: { \"_apexType\": \"Account\", \"Id\": \"001A\", \"Name\": \"Acm"],
  ["sobj-truncated", "Account:{Id=001A, Name=Acme, Description=Long text that was cut", '846d107813838493', "\"Account:{Id=001A, Name=Acme, Description=Long text that was cut\""],
  ["sobj-safe-numbers", "Account:{Id=001A, NumberOfEmployees=250, AnnualRevenue=1250000.75}", '51df12b087657840', "{ \"_apexType\": \"Account\", \"Id\": \"001A\", \"NumberOfEmployees\": 250, \"Ann"],
  ["sobj-comma-in-value", "Account:{Id=001A, Name=Smith, John, Industry=Tech}", '279c53652db404ec', "{ \"_apexType\": \"Account\", \"Id\": \"001A\", \"Name\": \"Smith, John\", \"Indust"],
  ["sobj-braces-text", "Account:{Description=Uses {braces} here, Id=001A}", '8dc2b6a51f18b3ff', "{ \"_apexType\": \"Account\", \"Description\": \"Uses {braces} here\", \"Id\": \""],
  ["sobj-paren-text", "Case:{Subject=Re: (urgent) help, Id=500A}", 'f5b68e518ad75720', "{ \"_apexType\": \"Case\", \"Subject\": \"Re: (urgent) help\", \"Id\": \"500A\" }"],
  ["sobj-null-field", "Account:{Id=001A, ParentId=null, IsDeleted=false}", '81725480d04d352b', "{ \"_apexType\": \"Account\", \"Id\": \"001A\", \"ParentId\": null, \"IsDeleted\":"],
  ["list-prims", "(47, 52, null)", 'fd71e69a4323265b', "(47, 52, null)"],
  ["list-sobjects-doc", "(Account:{Id=001xx000003DGb2AAG, Name=sForceTest1}, Account:{Id=001xx000003DGb3AAG, Name=sForceTest2})", '6a260abbac2a80c3', "[ { \"_apexType\": \"Account\", \"Id\": \"001xx000003DGb2AAG\", \"Name\": \"sForc"],
  ["list-sobjects-prefix", "Accounts: (Account:{Id=001A, Name=A}, Account:{Id=001B, Name=B})", '1e60cf86469c969b', "Accounts: [ { \"_apexType\": \"Account\", \"Id\": \"001A\", \"Name\": \"A\" }, { \""],
  ["list-one", "(Account:{Id=001A, Name=A})", '25774725815816b1', "{ \"_apexType\": \"Account\", \"Id\": \"001A\", \"Name\": \"A\" }"],
  ["list-empty", "()", 'e6dbc4c36124293b', "()"],
  ["list-strings", "(a, b, c)", '5bc85128dab60c6e', "(a, b, c)"],
  ["list-contacts", "Records: (Contact:{Id=003A, LastName=Doe}, Contact:{Id=003B, LastName=Roe})", '74b734d013fcbc17', "Records: [ { \"_apexType\": \"Contact\", \"Id\": \"003A\", \"LastName\": \"Doe\" }"],
  ["list-paren-prefix", "Processed (2) records: (Account:{Id=001A, Name=A}, Account:{Id=001B, Name=B})", '6ecfb044c9fc65e0', "Processed (2) records: [ { \"_apexType\": \"Account\", \"Id\": \"001A\", \"Name"],
  ["set-ints", "{1, 2, 3}", 'b48a2adffeedc446', "[ 1, 2, 3 ]"],
  ["set-sobjects", "{Account:{Name=Test1}, Account:{Name=Test2}}", '79eeba067be3106d', "[ { \"_apexType\": \"Account\", \"Name\": \"Test1\" }, { \"_apexType\": \"Account"],
  ["set-strings", "{a, b}", '17313ef659730540', "[ \"a\", \"b\" ]"],
  ["map-doc", "My Mobile prices List = {40000=motorola, 50000=samsung, 60000=nokia, 70000=iphone x}", 'eeaa103725dc386e', "My Mobile prices List = {40000=motorola, 50000=samsung, 60000=nokia, 7"],
  ["map-id-sobject", "{001A=Account:{Id=001A, Name=A}, 001B=Account:{Id=001B, Name=B}}", '22de18cebc3d3c1b', "{ \"001A\": { \"_apexType\": \"Account\", \"Id\": \"001A\", \"Name\": \"A\" }, \"001B"],
  ["map-simple", "{key1=value1, key2=value2}", '999be4630e49946e', "{ \"key1\": \"value1\", \"key2\": \"value2\" }"],
  ["map-empty", "{}", 'b7a587198e122931', "{}"],
  ["class-doc", "ToStringDemo:[city=SFO, companyName=Salesforce]", '57e9a96afffa723a', "{ \"_apexType\": \"ToStringDemo\", \"city\": \"SFO\", \"companyName\": \"Salesfor"],
  ["class-response", "Response:[status=200, body=OK]", '5bc396af1222efbd', "{ \"_apexType\": \"Response\", \"status\": 200, \"body\": \"OK\" }"],
  ["class-url", "SFrequest:[method=POST, endpoint=https://x.com/api]", '24a64146eb4f4201', "{ \"_apexType\": \"SFrequest\", \"method\": \"POST\", \"endpoint\": \"https://x.c"],
  ["class-multiline", "Payload:\n\"[key=value, other=thing]\"", '08c75240733704b0', "{ \"Payload\": { \"key\": \"value\", \"other\": \"thing\" } }"],
  ["class-wrapped", "(Wrapper:[a=1, b=2])", '9332387dbcdc3533', "{ \"Wrapper\": [ { \"a\": 1 }, { \"b\": 2 } ] }"],
  ["json-object", "{\"name\":\"Acme\",\"n\":5}", '12af75a9a71e113e', "{ \"name\": \"Acme\", \"n\": 5 }"],
  ["json-array", "[{\"Id\":\"001A\",\"Name\":\"A\"},{\"Id\":\"001B\",\"Name\":\"B\"}]", 'b9be47cbfa7eb0c4', "[ { \"Id\": \"001A\", \"Name\": \"A\" }, { \"Id\": \"001B\", \"Name\": \"B\" } ]"],
  ["json-pretty-attributes", "[\n  {\n    \"attributes\": {\n      \"type\": \"Account\",\n      \"url\": \"/services/data/v62.0/sobjects/Account/001Hn00001\"\n    },\n    \"Id\": \"001Hn00001\",\n    \"Name\": \"Acme Corp\",\n    \"Industry\": \"Technology\",\n    \"AnnualRevenue\": 1250000\n  },\n  {\n    \"Id\": \"001Hn00002\",\n    \"Name\": \"Globex\",\n    \"Industry\": \"Energy\",\n    \"AnnualRevenue\": null\n  }\n]", '0259b39755694e0b', "[ { \"Id\": \"001Hn00001\", \"Name\": \"Acme Corp\", \"Industry\": \"Technology\","],
  ["json-soql-response", "{\"totalSize\":1,\"done\":true,\"records\":[{\"attributes\":{\"type\":\"Account\",\"url\":\"/services/data/v62.0/sobjects/Account/001A\"},\"Id\":\"001A\",\"Name\":\"A\"}]}", '393aad327b816056', "{ \"totalSize\": 1, \"records\": [ { \"Id\": \"001A\", \"Name\": \"A\" } ] }"],
  ["json-quoted-string", "\"just a quoted string\"", '7b4ff630d1d4ac16', "just a quoted string"],
  ["json-nested", "{\"a\":{\"b\":[1,2,{\"c\":null}]}}", '711167625991ac3a', "{ \"a\": { \"b\": [ 1, 2, { \"c\": null } ] } }"],
  ["json-array-prims", "[1, 2, 3]", 'b48a2adffeedc446', "[ 1, 2, 3 ]"],
  ["json-html-in-string", "{\"html\":\"<b>bold</b>\"}", '1c2d978d0ee32196', "{ \"html\": \"<b>bold</b>\" }"],
  ["html-img", "<img src=x onerror=alert(1)>", '2438392f90723ad9', "<img src=x onerror=alert(1)>"],
  ["html-entities", "&lt;b&gt;bold&lt;/b&gt;", 'd533091407922264', "<b>bold</b>"],
  ["html-double-encoded", "Value &amp;lt;tag&amp;gt; stays encoded once", '9b2cb6b4b86a626d', "Value &lt;tag&gt; stays encoded once"],
  ["num-list-zero", "(007, 8)", 'e256c035c0d30e80', "(007, 8)"],
  ["quote-single", "Contact:{LastName=D'Angelo, FirstName=Tom}", '7857896af040def8', "{ \"_apexType\": \"Contact\", \"LastName\": \"D'Angelo\", \"FirstName\": \"Tom\" }"],
  ["trunc-list", "Accounts: (Account:{Id=001A, Name=A}, Account:{Id=001B, Name=Tru", '46edd940a0d3d58e', "\"Accounts: (Account:{Id=001A, Name=A}, Account:{Id=001B, Name=Tru\""]
];

// A realistic full log (same as the UI harness log) and the hashes of its views before the fix
const STUB_LOG = `62.0 APEX_CODE,FINEST;APEX_PROFILING,INFO;CALLOUT,INFO;DB,INFO;SYSTEM,DEBUG;VALIDATION,INFO;VISUALFORCE,INFO;WORKFLOW,INFO
09:14:02.12 (12345678)|USER_INFO|[EXTERNAL]|005Hn00000AbCdE|admin@acme.com|(GMT-07:00) Pacific Daylight Time (America/Los_Angeles)|GMT-07:00
09:14:02.12 (12400000)|EXECUTION_STARTED
09:14:02.12 (12500000)|CODE_UNIT_STARTED|[EXTERNAL]|01pHn000001XyZa|AccountService.syncAccounts
09:14:02.13 (13000000)|SOQL_EXECUTE_BEGIN|[12]|Aggregations:0|SELECT Id, Name, Industry FROM Account LIMIT 3
09:14:02.14 (14000000)|SOQL_EXECUTE_END|[12]|Rows:3
09:14:02.14 (14100000)|HEAP_ALLOCATE|[72]|Bytes:3
09:14:02.15 (15000000)|USER_DEBUG|[14]|DEBUG|Starting sync for 3 accounts
09:14:02.16 (16000000)|USER_DEBUG|[15]|DEBUG|[
  {
    "attributes" : {
      "type" : "Account",
      "url" : "/services/data/v62.0/sobjects/Account/001Hn00001"
    },
    "Id" : "001Hn00001",
    "Name" : "Acme Corp",
    "Industry" : "Technology",
    "AnnualRevenue" : 1250000
  },
  {
    "Id" : "001Hn00002",
    "Name" : "Globex",
    "Industry" : "Energy",
    "AnnualRevenue" : null
  }
]
09:14:02.17 (17000000)|USER_DEBUG|[22]|DEBUG|Account:{Id=001Hn00003, Name=Initech, Industry=Finance}
09:14:02.18 (18000000)|EXCEPTION_THROWN|[31]|System.NullPointerException: Attempt to de-reference a null object
09:14:02.19 (19000000)|FATAL_ERROR|System.NullPointerException: Attempt to de-reference a null object

Class.AccountService.calculateTier: line 31, column 1
Class.AccountService.syncAccounts: line 18, column 1
AnonymousBlock: line 1, column 1
09:14:02.20 (20000000)|CUMULATIVE_LIMIT_USAGE
09:14:02.20 (20000000)|LIMIT_USAGE_FOR_NS|(default)|
  Number of SOQL queries: 12 out of 100
  Number of query rows: 340 out of 50000
  Number of SOSL queries: 0 out of 20
  Number of DML statements: 4 out of 150
  Number of Publish Immediate DML: 0 out of 150
  Number of DML rows: 18 out of 10000
  Maximum CPU time: 1840 out of 10000
  Maximum heap size: 412000 out of 6000000
  Number of callouts: 1 out of 100
  Number of Email Invocations: 0 out of 10
  Number of future calls: 0 out of 50
  Number of queueable jobs added to the queue: 0 out of 50
  Number of Mobile Apex push calls: 0 out of 10

09:14:02.20 (20000000)|CUMULATIVE_LIMIT_USAGE_END

09:14:02.21 (21000000)|CODE_UNIT_FINISHED|AccountService.syncAccounts
09:14:02.21 (21000000)|EXECUTION_FINISHED
`;

test('regression corpus: outputs that were already right are byte-identical', () => {
  for (const [id, msg, expectedSha, expectedText] of GOOD_CASES) {
    const html = render(logFor(msg));
    assert.strictEqual(sha(html), expectedSha, `${id}: output changed (was "${expectedText}...", now "${textOf(html).slice(0, 120)}")`);
  }
});

test('regression corpus: full log views (raw highlighting, messages, errors, limits) are byte-identical', () => {
  const views = {
    'raw:debug-log': P.applyDebugLogHighlighting(STUB_LOG),
    'debug-view:stub-log': render(STUB_LOG),
    'errors:stub-log': P.elements.errorContent.innerHTML,
    'limits:stub-log': P.elements.limitsContent.innerHTML,
  };
  for (const [id, expectedSha] of [["raw:debug-log", 'f54fa815f7c5fda6'], ["debug-view:stub-log", '30b416472aad7b65'],
    ["errors:stub-log", 'b8d7b854da293634'], ["limits:stub-log", 'c636e40d96d33a09']]) {
    assert.strictEqual(sha(views[id]), expectedSha, `${id} changed`);
  }
});

test('P3: an apostrophe in a value does not merge records (toString has no quotes)', () => {
  assert.deepStrictEqual(parse("(Account:{Name=O'Brien, Id=001A}, Account:{Name=Bob, Id=001B})"), [
    { _apexType: 'Account', Name: "O'Brien", Id: '001A' },
    { _apexType: 'Account', Name: 'Bob', Id: '001B' },
  ]);
  const text = textOf(render(logFor("Accounts: (Account:{Name=O'Brien, Id=001A}, Account:{Name=Bob, Id=001B})")));
  assert.match(text, /^Accounts: \[ \{ "_apexType": "Account", "Name": "O'Brien"/);
});

test('P4: keys are split on the first "=" at depth 0 (nested objects, URLs, "=" in values)', () => {
  assert.deepStrictEqual(parse('Wrapper:[acc=Account:{Id=001xx000003DGb2AAG, Name=Acme}, count=5]'),
    { _apexType: 'Wrapper', acc: { _apexType: 'Account', Id: '001xx000003DGb2AAG', Name: 'Acme' }, count: 5 });
  assert.deepStrictEqual(parse('Account:{Id=001A, Website=https://x.com/?a=1&b=2, Name=Acme}'),
    { _apexType: 'Account', Id: '001A', Website: 'https://x.com/?a=1&b=2', Name: 'Acme' });
  assert.deepStrictEqual(parse('Account:{Id=001A, Description=a=b, Name=Acme}'), { _apexType: 'Account', Id: '001A', Description: 'a=b', Name: 'Acme' });
  assert.deepStrictEqual(parse('Outer:[inner=Inner:[a=1, b=2], c=3]'), { _apexType: 'Outer', inner: { _apexType: 'Inner', a: 1, b: 2 }, c: 3 });
  assert.deepStrictEqual(parse('(Wrapper:[a=1, b=2], Wrapper:[a=3, b=4])'), [{ _apexType: 'Wrapper', a: 1, b: 2 }, { _apexType: 'Wrapper', a: 3, b: 4 }]);
  assert.deepStrictEqual(parse('Wrapper:[items=(1, 2, 3), name=x]'), { _apexType: 'Wrapper', items: [1, 2, 3], name: 'x' });
  assert.deepStrictEqual(parse('{a=1, b=(1, 2), c={x=y}}'), { a: 1, b: [1, 2], c: { x: 'y' } });
  // An unclosed bracket inside a text value does not swallow the next fields
  assert.deepStrictEqual(parse('Account:{Name=Sad :(, Id=001A}'), { _apexType: 'Account', Name: 'Sad :(', Id: '001A' });
  const text = textOf(render(logFor('Accounts: (Account:{Id=001A, Name=Acme (US)}, Account:{Id=001B, Name=Beta (UK)})')));
  assert.match(text, /"Name": "Beta \(UK\)"/);
});

test('P7: map keys can be objects or contain spaces', () => {
  assert.deepStrictEqual(parse('{Account:{Name=Bob}=null}'), { 'Account:{Name=Bob}': null });
  assert.deepStrictEqual(parse('{first name=Bob, last name=Smith}'), { 'first name': 'Bob', 'last name': 'Smith' });
});

test('P6: numbers are only converted when nothing is lost', () => {
  assert.deepStrictEqual(parse('Account:{Id=001A, BillingPostalCode=02134, AccountNumber=00012345678901234567, Big=12345678901234567890}'),
    { _apexType: 'Account', Id: '001A', BillingPostalCode: '02134', AccountNumber: '00012345678901234567', Big: '12345678901234567890' });
  assert.deepStrictEqual(parse('Account:{A=250, B=-5, C=1500.5, D=1500.50, E=0.25, F=12345678901234567.5}'),
    { _apexType: 'Account', A: 250, B: -5, C: 1500.5, D: 1500.5, E: 0.25, F: '12345678901234567.5' });
  assert.deepStrictEqual(parse('(007, 8)'), ['007', 8]);
});

test('P6: text before (and after) JSON is kept; only real Salesforce metadata is removed', () => {
  assert.match(textOf(render(logFor('Response: {"status":"ok","count":2}'))), /^Response: \{ "status": "ok", "count": 2 \}$/);
  assert.match(textOf(render(logFor('Payload {"done": false, "task": "Call back"}'))), /^Payload \{ "done": false, "task": "Call back" \}$/);
  assert.match(textOf(render(logFor('{"attributes": {"color": "red"}, "sku": "A1"}'))), /"attributes": \{ "color": "red" \}/);
  assert.match(textOf(render(logFor('Got {"a":1} from the API'))), /^Got \{ "a": 1 \} from the API$/);
  // System.debug('***** user1 : ' + JSON.serializePretty(user1)) shows the whole object, not an inner array
  const pretty = '***** user1 : ' + JSON.stringify({ Name: 'Jane', Age: 30, Tags: ['a', 'b'] }, null, 2);
  assert.match(textOf(render(logFor(pretty))), /^\*\*\*\*\* user1 : \{ "Name": "Jane", "Age": 30, "Tags": \[ "a", "b" \] \}$/);
  // SOQL query results still lose "done" and the record "attributes"
  const soql = P.cleanSalesforceResponse('{"totalSize":1,"done":true,"records":[{"attributes":{"type":"Account","url":"/x/001A"},"Id":"001A"}]}');
  assert.deepStrictEqual(JSON.parse(soql.json), { totalSize: 1, records: [{ Id: '001A' }] });
});

test('P7: JSON highlighting never matches inside strings or its own markup', () => {
  const contact = render(logFor('Contact:{Id=003A, Birthdate=1990-05-01 00:00:00}'));
  assert.match(contact, /<span class="json-string">"1990-05-01 00:00:00"<\/span>/);
  const quoted = render(logFor('Account:{Name=Say "hi", Description={"a":1}}'));
  assert.match(quoted, /<span class="json-string">"Say \\"hi\\""<\/span>/);
  assert.match(quoted, /<span class="json-string">"\{\\"a\\":1\}"<\/span>/);
  const raw = P.applyJsonSyntaxHighlighting('{"name": "Acme", "n": 5, "ok": true, "none": null}');
  assert.strictEqual(raw, '{<span class="json-key">"name":</span> <span class="json-string">"Acme"</span>, <span class="json-key">"n":</span> ' +
    '<span class="json-number">5</span>, <span class="json-key">"ok":</span> <span class="json-boolean">true</span>, ' +
    '<span class="json-key">"none":</span> <span class="json-null">null</span>}');
});

test('P7: HTML entities are decoded once', () => {
  assert.match(render(logFor('Account:{Id=001A, Name=A &amp;lt; B}')), /"A &amp;lt; B"/);
});

test('S7: tags inside log text are always shown as text', () => {
  const payload = '<div class="modal-overlay">Session expired</div></pre></div><span class="x">hi</span>';
  const view = render(logFor(payload));
  assert.ok(!view.includes('<div class="modal-overlay">') && !view.includes('<span class="x">'), view);
  assert.ok(view.includes('&lt;div class="modal-overlay"&gt;'));
  const raw = P.applyDebugLogHighlighting(logFor(payload));
  assert.ok(!raw.includes('<div') && !raw.includes('</pre>') && !raw.includes('<span class="x"'), raw);
  // Event names and timestamps are still highlighted
  assert.ok(raw.includes('<span class="debug-timestamp">12:00:00.002 (2000)</span>|<span class="debug-operation">USER_DEBUG</span>|'));
});

test('P2: every logging level is a debug message, up to the next event line or the end of the log', () => {
  const log = ['62.0 APEX_CODE,FINEST', '12:00:00.001 (1000)|EXECUTION_STARTED',
    '12:00:00.002 (2000)|USER_DEBUG|[5]|DEBUG|plain', '12:00:00.003 (3000)|USER_DEBUG|[6]|ERROR|error level',
    '12:00:00.004 (4000)|USER_DEBUG|[7]|INFO|line1', 'line2', '10:15:30.123 is a time on its own line', 'line4',
    '12:00:00.005 (5000)|USER_DEBUG|[8]|WARN|last message'].join('\n');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(P.extractUserDebugBlocks(log))), [
    { level: 'DEBUG', message: 'plain' },
    { level: 'ERROR', message: 'error level' },
    { level: 'INFO', message: 'line1\nline2\n10:15:30.123 is a time on its own line\nline4' },
    { level: 'WARN', message: 'last message' },
  ]);
  assert.strictEqual(P.extractUserDebugBlocks(log.replace(/\n/g, '\r\n')).length, 4, 'CRLF logs');
  const html = render(log);
  assert.match(html, /<span class="debug-level-tag level-error">ERROR<\/span>/);
  assert.strictEqual((html.match(/debug-level-tag/g) || []).length, 3, 'no tag for DEBUG');
});

test('P7: errors inside CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex get that context', () => {
  const log = ['12:00:00.001 (1)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex',
    '12:00:00.002 (2)|CODE_UNIT_STARTED|[EXTERNAL]|01pX|Svc.run', '12:00:00.003 (3)|CODE_UNIT_FINISHED|Svc.run',
    '12:00:00.004 (4)|FATAL_ERROR|System.LimitException: Too many SOQL queries: 101', '12:00:00.005 (5)|CODE_UNIT_FINISHED|execute_anonymous_apex'].join('\n');
  assert.strictEqual(P.extractErrorsFromDebugLog(log).errors[0].codeUnitContext, 'execute_anonymous_apex');
});

test('F6: governor limits show every namespace, (default) first', () => {
  const log = ['12:00:00.003 (3)|CUMULATIVE_LIMIT_USAGE', '12:00:00.003 (3)|LIMIT_USAGE_FOR_NS|acmepkg|',
    '  Number of SOQL queries: 99 out of 100 ******* CLOSE TO LIMIT', '', '12:00:00.003 (3)|LIMIT_USAGE_FOR_NS|(default)|',
    '  Number of SOQL queries: 2 out of 100', '', '12:00:00.003 (3)|CUMULATIVE_LIMIT_USAGE_END'].join('\n');
  const html = P.formatGovernorLimits(P.parseDebugLogContent(log).limits);
  const namespaces = [...html.matchAll(/<div class="limits-ns">Governor limits <span>([^<]+)<\/span>/g)].map(m => m[1]);
  assert.deepStrictEqual(namespaces, ['(default)', 'acmepkg']);
  assert.match(html.slice(html.indexOf('acmepkg')), /limit-row level-danger/);
});

test('governor limits at 0 fold under a "Show N unused limits" toggle', () => {
  const html = P.formatGovernorLimits(['LIMIT_USAGE_FOR_NS|(default)|', '  Number of SOQL queries: 2 out of 100',
    '  Number of DML rows: 0 out of 10000', '  Number of callouts: 0 out of 100'].join('\n'));
  const [used, unused] = html.split('<details class="limits-unused">');
  assert.match(used, /SOQL queries/);
  assert.doesNotMatch(used, /DML rows|Callouts/);
  assert.match(unused, /^<summary>Show 2 unused limits<\/summary>.*DML rows.*Callouts/s);
  assert.match(P.formatGovernorLimits('  Number of callouts: 0 out of 100'), /No limits used.*Show 1 unused limit</s);
});

test('F7: logs cut by Salesforce show a banner, and the markers stay out of messages and errors', () => {
  const log = ['12:00:00.001 (1)|USER_DEBUG|[1]|DEBUG|before the cut', '*** Skipped 5242880 bytes of detailed log',
    'tail of a skipped line', '12:00:00.009 (9)|FATAL_ERROR|System.NullPointerException: boom',
    '*** MAXIMUM DEBUG LOG SIZE REACHED ***'].join('\n');
  const parsed = P.parseDebugLogContent(log);
  assert.strictEqual(parsed.truncated, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed.debugMessages)), [{ level: 'DEBUG', message: 'before the cut' }]);
  assert.strictEqual(parsed.errors.errors[0].rawMessage, 'System.NullPointerException: boom');
  P.displayDebugContent(parsed);
  for (const panel of [P.elements.debugContent.innerHTML, P.elements.errorContent.innerHTML]) {
    assert.match(panel, /^<div class="log-truncated-banner">.*This log was cut by Salesforce\. Errors and limits may be incomplete\./);
  }
  assert.strictEqual(P.parseDebugLogContent(logFor('no cut here')).truncated, false);
});

test('F13: a log that cannot be parsed says so (not "Failed to copy")', () => {
  P.parseDebugLogContent({});
  assert.deepStrictEqual(Array.from(P.toasts).slice(-1), ['Could not read this log. Try the raw view.']);
});

test('R3: the same log is parsed once and the result is re-used', () => {
  const log = logFor('memo');
  assert.strictEqual(P.parseDebugLogContent(log), P.parseDebugLogContent(log));
});

test('P1: big and odd messages are formatted fast (40 KB unclosed braces under 200 ms)', () => {
  const unclosed = 'Processing ' + Array.from({ length: 3100 }, (_, i) => `item${i}={ok}`).join(' ') + ' then {"partial":';
  assert.ok(unclosed.length > 40000);
  const record = (i) => `Account:{Id=001A0000000${i}, Name=Acct ${i}, Website=https://x.com/?a=1&b=2}`;
  const inputs = [
    unclosed,
    'Accounts: (' + Array.from({ length: 560 }, (_, i) => record(i)).join(', ') + ', Account:{Id=001A, Name=Trunc',
    'a'.repeat(45000) + ':{x=1}', // e.g. a hex dump
    'a:{'.repeat(15000),
    '('.repeat(45000),
  ];
  for (const input of inputs) {
    const start = process.hrtime.bigint();
    P.containsSalesforceObjects(input);
    P.cleanSalesforceResponse(input);
    P.extractAndParseSalesforceObjects(input);
    render(logFor(input));
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 200, `${input.slice(0, 30)}... took ${ms.toFixed(0)} ms`);
  }
});

test('P1: messages over the size limit are shown as escaped text without structure parsing', () => {
  const big = 'Account:{Name=<b>x</b>, ' + 'Field=value, '.repeat(5000) + 'Id=001A}';
  assert.ok(big.length > P.MAX_STRUCTURED_MESSAGE_LENGTH);
  const html = render(logFor(big));
  assert.ok(!html.includes('json-key') && html.includes('&lt;b&gt;x&lt;/b&gt;'));
});
