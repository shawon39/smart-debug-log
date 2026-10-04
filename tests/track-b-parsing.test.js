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

// escapeHtml uses a <div>; mimic what the browser returns
function escapeLikeDom(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;'); }

function loadPipeline() {
  const document = {
    createElement() {
      const el = { _t: '' };
      Object.defineProperty(el, 'textContent', { set(v) { this._t = String(v); }, get() { return this._t; } });
      Object.defineProperty(el, 'innerHTML', { set(v) { this._t = v; }, get() { return escapeLikeDom(this._t); } });
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
  ["sobj-doc", "Account:{Name=Test Account, BillingStreet=123 Test Dr, BillingCity=Test City}", '841caad9a79dae09', "{ \"Name\": \"Test Account\", \"BillingStreet\": \"123 Test Dr\", \"BillingCity\":"],
  ["sobj-stub", "Account:{Id=001Hn00003, Name=Initech, Industry=Finance}", '4333b1b3b3f7eac3', "{ \"Id\": \"001Hn00003\", \"Name\": \"Initech\", \"Industry\": \"Finance\" }"],
  ["sobj-address", "Account:{Name=Acme, BillingAddress=API address [ The Landmark @ One Market, SanFrancisco, CA, 94105, US, null ], Id=001A}", 'c0bf88fc2562ca45', "{ \"Name\": \"Acme\", \"BillingAddress\": \"API address [ The Landmark @ One Ma"],
  ["sobj-custom", "MyCustom__c:{Id=a01A, Name=Rec 1, Count__c=3}", '5e744dc01770590e', "{ \"Id\": \"a01A\", \"Name\": \"Rec 1\", \"Count__c\": 3 }"],
  ["sobj-arrow", "Full Account → Account:{Id=001A, Name=Acme}", 'c6314fd52b6c3fdb', "Full Account → { \"Id\": \"001A\", \"Name\": \"Acme\" }"],
  ["sobj-prefix", "Inserted account: Account:{Id=001A, Name=Acme}", '7523cc9f2a4f6a03', "Inserted account: { \"Id\": \"001A\", \"Name\": \"Acme\" }"],
  ["sobj-truncated", "Account:{Id=001A, Name=Acme, Description=Long text that was cut", '9addb9550e01e647', "Account:{Id=001A, Name=Acme, Description=Long text that was cut"],
  ["sobj-safe-numbers", "Account:{Id=001A, NumberOfEmployees=250, AnnualRevenue=1250000.75}", '1d877b0cbbb8fbc8', "{ \"Id\": \"001A\", \"NumberOfEmployees\": 250, \"AnnualRevenue\": 1250000.75 }"],
  ["sobj-comma-in-value", "Account:{Id=001A, Name=Smith, John, Industry=Tech}", 'ef7d81c26af185a5', "{ \"Id\": \"001A\", \"Name\": \"Smith, John\", \"Industry\": \"Tech\" }"],
  ["sobj-braces-text", "Account:{Description=Uses {braces} here, Id=001A}", '1f6ca25b887f4bb7', "{ \"Description\": \"Uses {braces} here\", \"Id\": \"001A\" }"],
  ["sobj-paren-text", "Case:{Subject=Re: (urgent) help, Id=500A}", 'efb02302f39bc29d', "{ \"Subject\": \"Re: (urgent) help\", \"Id\": \"500A\" }"],
  ["sobj-null-field", "Account:{Id=001A, ParentId=null, IsDeleted=false}", 'be36e8e2eabf8758', "{ \"Id\": \"001A\", \"ParentId\": null, \"IsDeleted\": false }"],
  ["list-prims", "(47, 52, null)", 'fd71e69a4323265b', "(47, 52, null)"],
  ["list-sobjects-doc", "(Account:{Id=001xx000003DGb2AAG, Name=sForceTest1}, Account:{Id=001xx000003DGb3AAG, Name=sForceTest2})", 'a89625e4f6513409', "[ { \"Id\": \"001xx000003DGb2AAG\", \"Name\": \"sForceTest1\" }, { \"Id\": \"001xx0"],
  ["list-sobjects-prefix", "Accounts: (Account:{Id=001A, Name=A}, Account:{Id=001B, Name=B})", '7c0fea74c9a1898e', "Accounts: [ { \"Id\": \"001A\", \"Name\": \"A\" }, { \"Id\": \"001B\", \"Name\": \"B\" }"],
  ["list-one", "(Account:{Id=001A, Name=A})", '060c8cf016a5c2d1', "[ { \"Id\": \"001A\", \"Name\": \"A\" } ]"],
  ["list-empty", "()", 'e6dbc4c36124293b', "()"],
  ["list-strings", "(a, b, c)", '5bc85128dab60c6e', "(a, b, c)"],
  ["list-contacts", "Records: (Contact:{Id=003A, LastName=Doe}, Contact:{Id=003B, LastName=Roe})", '576977d108f88ec1', "Records: [ { \"Id\": \"003A\", \"LastName\": \"Doe\" }, { \"Id\": \"003B\", \"LastNam"],
  ["list-paren-prefix", "Processed (2) records: (Account:{Id=001A, Name=A}, Account:{Id=001B, Name=B})", '1db7c51249997204', "Processed (2) records: [ { \"Id\": \"001A\", \"Name\": \"A\" }, { \"Id\": \"001B\", "],
  ["set-ints", "{1, 2, 3}", 'b48a2adffeedc446', "[ 1, 2, 3 ]"],
  ["set-sobjects", "{Account:{Name=Test1}, Account:{Name=Test2}}", '3aee3ce06af078d1', "[ { \"Name\": \"Test1\" }, { \"Name\": \"Test2\" } ]"],
  ["set-strings", "{a, b}", '17313ef659730540', "[ \"a\", \"b\" ]"],
  ["map-doc", "My Mobile prices List = {40000=motorola, 50000=samsung, 60000=nokia, 70000=iphone x}", 'eeaa103725dc386e', "My Mobile prices List = {40000=motorola, 50000=samsung, 60000=nokia, 7"],
  ["map-id-sobject", "{001A=Account:{Id=001A, Name=A}, 001B=Account:{Id=001B, Name=B}}", '4e64dcab19f03edf', "{ \"001A\": { \"Id\": \"001A\", \"Name\": \"A\" }, \"001B\": { \"Id\": \"001B\", \"Name\":"],
  ["map-simple", "{key1=value1, key2=value2}", '999be4630e49946e', "{ \"key1\": \"value1\", \"key2\": \"value2\" }"],
  ["map-empty", "{}", 'b7a587198e122931', "{}"],
  ["class-doc", "ToStringDemo:[city=SFO, companyName=Salesforce]", '21288fa80e76b1db', "{ \"city\": \"SFO\", \"companyName\": \"Salesforce\" }"],
  ["class-response", "Response:[status=200, body=OK]", '916f33f4ca40fc61', "{ \"status\": 200, \"body\": \"OK\" }"],
  ["class-url", "SFrequest:[method=POST, endpoint=https://x.com/api]", '31bb5258b0a80961', "{ \"method\": \"POST\", \"endpoint\": \"https://x.com/api\" }"],
  ["class-multiline", "Payload:\n\"[key=value, other=thing]\"", '08c75240733704b0', "{ \"Payload\": { \"key\": \"value\", \"other\": \"thing\" } }"],
  ["class-wrapped", "(Wrapper:[a=1, b=2])", '25c52a33225e2b01', "[ { \"a\": 1, \"b\": 2 } ]"],
  ["json-object", "{\"name\":\"Acme\",\"n\":5}", '12af75a9a71e113e', "{ \"name\": \"Acme\", \"n\": 5 }"],
  ["json-array", "[{\"Id\":\"001A\",\"Name\":\"A\"},{\"Id\":\"001B\",\"Name\":\"B\"}]", 'b9be47cbfa7eb0c4', "[ { \"Id\": \"001A\", \"Name\": \"A\" }, { \"Id\": \"001B\", \"Name\": \"B\" } ]"],
  ["json-pretty-attributes", "[\n  {\n    \"attributes\": {\n      \"type\": \"Account\",\n      \"url\": \"/services/data/v62.0/sobjects/Account/001Hn00001\"\n    },\n    \"Id\": \"001Hn00001\",\n    \"Name\": \"Acme Corp\",\n    \"Industry\": \"Technology\",\n    \"AnnualRevenue\": 1250000\n  },\n  {\n    \"Id\": \"001Hn00002\",\n    \"Name\": \"Globex\",\n    \"Industry\": \"Energy\",\n    \"AnnualRevenue\": null\n  }\n]", '0259b39755694e0b', "[ { \"Id\": \"001Hn00001\", \"Name\": \"Acme Corp\", \"Industry\": \"Technology\","],
  ["json-soql-response", "{\"totalSize\":1,\"done\":true,\"records\":[{\"attributes\":{\"type\":\"Account\",\"url\":\"/services/data/v62.0/sobjects/Account/001A\"},\"Id\":\"001A\",\"Name\":\"A\"}]}", '393aad327b816056', "{ \"totalSize\": 1, \"records\": [ { \"Id\": \"001A\", \"Name\": \"A\" } ] }"],
  ["json-quoted-string", "\"just a quoted string\"", '7b4ff630d1d4ac16', "just a quoted string"],
  ["json-nested", "{\"a\":{\"b\":[1,2,{\"c\":null}]}}", '711167625991ac3a', "{ \"a\": { \"b\": [ 1, 2, { \"c\": null } ] } }"],
  ["json-array-prims", "[1, 2, 3]", 'b48a2adffeedc446', "[ 1, 2, 3 ]"],
  ["json-html-in-string", "{\"html\":\"<b>bold</b>\"}", '1c2d978d0ee32196', "{ \"html\": \"<b>bold</b>\" }"],
  ["html-img", "<img src=x onerror=alert(1)>", '2438392f90723ad9', "<img src=x onerror=alert(1)>"],
  ["html-entities", "&lt;b&gt;bold&lt;/b&gt;", '32e7335737644863', "&lt;b&gt;bold&lt;/b&gt;"],
  ["html-double-encoded", "Value &amp;lt;tag&amp;gt; stays encoded once", '0bf067d93060ec10', "Value &amp;lt;tag&amp;gt; stays encoded once"],
  ["num-list-zero", "(007, 8)", 'e256c035c0d30e80', "(007, 8)"],
  ["quote-single", "Contact:{LastName=D'Angelo, FirstName=Tom}", '4c940ecb823a7db5', "{ \"LastName\": \"D'Angelo\", \"FirstName\": \"Tom\" }"],
  ["trunc-list", "Accounts: (Account:{Id=001A, Name=A}, Account:{Id=001B, Name=Tru", 'a94330f6a460e2c8', "Accounts: (Account:{Id=001A, Name=A}, Account:{Id=001B, Name=Tru"]
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
  for (const [id, expectedSha] of [["raw:debug-log", 'f54fa815f7c5fda6'], ["debug-view:stub-log", '3d35d84c6f7053f1'],
    ["errors:stub-log", 'b8d7b854da293634'], ["limits:stub-log", 'c636e40d96d33a09']]) {
    assert.strictEqual(sha(views[id]), expectedSha, `${id} changed`);
  }
});

test('P3: an apostrophe in a value does not merge records (toString has no quotes)', () => {
  assert.deepStrictEqual(parse("(Account:{Name=O'Brien, Id=001A}, Account:{Name=Bob, Id=001B})"), [
    { Name: "O'Brien", Id: '001A' },
    { Name: 'Bob', Id: '001B' },
  ]);
  const text = textOf(render(logFor("Accounts: (Account:{Name=O'Brien, Id=001A}, Account:{Name=Bob, Id=001B})")));
  assert.match(text, /^Accounts: \[ \{ "Name": "O'Brien"/);
});

test('P4: keys are split on the first "=" at depth 0 (nested objects, URLs, "=" in values)', () => {
  assert.deepStrictEqual(parse('Wrapper:[acc=Account:{Id=001xx000003DGb2AAG, Name=Acme}, count=5]'),
    { acc: { Id: '001xx000003DGb2AAG', Name: 'Acme' }, count: 5 });
  assert.deepStrictEqual(parse('Account:{Id=001A, Website=https://x.com/?a=1&b=2, Name=Acme}'),
    { Id: '001A', Website: 'https://x.com/?a=1&b=2', Name: 'Acme' });
  assert.deepStrictEqual(parse('Account:{Id=001A, Description=a=b, Name=Acme}'), { Id: '001A', Description: 'a=b', Name: 'Acme' });
  assert.deepStrictEqual(parse('Outer:[inner=Inner:[a=1, b=2], c=3]'), { inner: { a: 1, b: 2 }, c: 3 });
  assert.deepStrictEqual(parse('(Wrapper:[a=1, b=2], Wrapper:[a=3, b=4])'), [{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  assert.deepStrictEqual(parse('Wrapper:[items=(1, 2, 3), name=x]'), { items: [1, 2, 3], name: 'x' });
  assert.deepStrictEqual(parse('{a=1, b=(1, 2), c={x=y}}'), { a: 1, b: [1, 2], c: { x: 'y' } });
  // An unclosed bracket inside a text value does not swallow the next fields
  assert.deepStrictEqual(parse('Account:{Name=Sad :(, Id=001A}'), { Name: 'Sad :(', Id: '001A' });
  const text = textOf(render(logFor('Accounts: (Account:{Id=001A, Name=Acme (US)}, Account:{Id=001B, Name=Beta (UK)})')));
  assert.match(text, /"Name": "Beta \(UK\)"/);
});

test('P7: map keys can be objects or contain spaces', () => {
  assert.deepStrictEqual(parse('{Account:{Name=Bob}=null}'), { 'Account:{Name=Bob}': null });
  assert.deepStrictEqual(parse('{first name=Bob, last name=Smith}'), { 'first name': 'Bob', 'last name': 'Smith' });
});

test('P6: numbers are shown exactly as Apex printed them; leading zeros stay text', () => {
  assert.deepStrictEqual(parse('Account:{Id=001A, BillingPostalCode=02134, AccountNumber=00012345678901234567}'),
    { Id: '001A', BillingPostalCode: '02134', AccountNumber: '00012345678901234567' });
  assert.deepStrictEqual(parse('Account:{A=250, B=-5, C=1500.5, E=0.25}'), { A: 250, B: -5, C: 1500.5, E: 0.25 });
  assert.deepStrictEqual(parse('(007, 8)'), ['007', 8]);
  // Numbers a JavaScript number would change keep their text: scale, Long beyond 2^53, Double exponents
  const html = render(logFor('Account:{Amount=1500.50, Big=12345678901234567890, F=12345678901234567.5, Ratio=1.2345E-5, Lng=-122.39}'));
  assert.match(textOf(html), /"Amount": 1500\.50, "Big": 12345678901234567890, "F": 12345678901234567\.5, "Ratio": 1\.2345E-5, "Lng": -122\.39/);
  for (const number of ['1500.50', '12345678901234567890', '1.2345E-5', '-122.39']) {
    assert.ok(html.includes(`<span class="json-number">${number}</span>`), number);
  }
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

test('HTML entities in a message are shown as written (log bodies are not HTML-escaped)', () => {
  assert.strictEqual(textOf(render(logFor('Account:{Id=001A, Name=A &amp; B}'))), '{ "Id": "001A", "Name": "A &amp; B" }');
  assert.strictEqual(textOf(render(logFor('&lt;b&gt;bold&lt;/b&gt;'))), '&lt;b&gt;bold&lt;/b&gt;');
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

// Checks, parses and renders a message; returns the time in ms
function timeMessage(input) {
  const start = process.hrtime.bigint();
  P.containsSalesforceObjects(input);
  P.cleanSalesforceResponse(input);
  P.extractAndParseSalesforceObjects(input);
  render(logFor(input));
  return Number(process.hrtime.bigint() - start) / 1e6;
}

test('P1: big and odd messages are formatted fast (40 KB under 200 ms)', () => {
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
    const ms = timeMessage(input);
    assert.ok(ms < 200, `${input.slice(0, 30)}... took ${ms.toFixed(0)} ms`);
  }
});

test('P1: odd messages up to the 300 KB toString limit stay linear (under 1 s; quadratic took seconds)', () => {
  const limit = P.MAX_TOSTRING_MESSAGE_LENGTH - 100;
  const inputs = ['a=('.repeat(limit / 3), 'x:\n"['.repeat(limit / 5), '"[' + '='.repeat(limit), '[{'.repeat(limit / 2) + '"x"',
    'A:[a='.repeat(limit / 5) + ']'.repeat(limit / 5), 'Label A:{a=' + ')'.repeat(limit) + '}',
    Array.from({ length: limit / 20 }, (_, i) => `x A:{a=${i}}`).join(' '),
    // A stray ")" in every record: each record is also tried up to its own "}" (within the retry budget)
    Array.from({ length: limit / 30 }, (_, i) => `x A:{a=${i} :)}`).join(' ')];
  for (const input of inputs) {
    const ms = timeMessage(input);
    assert.ok(ms < 1000, `${input.slice(0, 30)}... took ${ms.toFixed(0)} ms`);
  }
});

test('P1: toString messages over 300 KB are shown as escaped text without structure parsing', () => {
  const big = 'Account:{Name=<b>x</b>, ' + 'Field=value, '.repeat(25000) + 'Id=001A}';
  assert.ok(big.length > P.MAX_TOSTRING_MESSAGE_LENGTH);
  const html = render(logFor(big));
  assert.ok(!html.includes('json-key') && html.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('P1: JSON up to 2 MB is formatted (Console.log of many records), longer JSON is text', () => {
  const records = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ attributes: { type: 'Account', url: '/x/001A' + i }, Id: '001A' + i, Name: 'Account ' + i })), null, 2);
  const medium = 'Account List\n' + records(3000);
  assert.ok(medium.length > P.MAX_TOSTRING_MESSAGE_LENGTH && medium.length < P.MAX_JSON_MESSAGE_LENGTH);
  const start = process.hrtime.bigint();
  const text = textOf(render(logFor(medium)));
  assert.ok(Number(process.hrtime.bigint() - start) / 1e6 < 1000, 'formats in under a second');
  assert.match(text, /^Account List \[ \{ "Id": "001A0", "Name": "Account 0" \}/);
  const huge = records(30000);
  assert.ok(huge.length > P.MAX_JSON_MESSAGE_LENGTH);
  assert.ok(!render(logFor(huge)).includes('json-key'));
});

test('Console.log(label, value) is one debug message: the label above the formatted JSON', () => {
  // What the Console class writes: System.debug(label + '\n' + JSON.serializePretty(obj))
  const parsed = P.parseDebugLogContent(logFor('Account List\n[ {\n  "attributes" : {\n    "type" : "Account",\n    "url" : "/services/data/v62.0/sobjects/Account/001A"\n  },\n  "Name" : "Acme"\n} ]'));
  assert.strictEqual(parsed.debugMessages.length, 1);
  const html = render(logFor('Account List\n[ {\n  "attributes" : {\n    "type" : "Account",\n    "url" : "/services/data/v62.0/sobjects/Account/001A"\n  },\n  "Name" : "Acme"\n} ]'));
  assert.match(html, /<span class="content-prefix">Account List<\/span>/);
  assert.match(textOf(html), /^Account List \[ \{ "Name": "Acme" \} \]$/);
});

// Real System.debug and Console.log output, captured on 2026-10-04 in a Developer Edition org (API 67) with anonymous
// Apex and a test class (wrappers, inner classes, inheritance, enums, a toString override). Record Ids are
// anonymised; the [line] field of each USER_DEBUG line holds the scenario name (see System.debug.md, section 7).
const REAL_LOG = fs.readFileSync(path.join(__dirname, 'fixtures', 'real-org-debug.log'), 'utf8');
const REAL = (() => {
  const names = [...REAL_LOG.matchAll(/\|USER_DEBUG\|\[([^\]]+)\]\|/g)].map(m => m[1]);
  const messages = P.extractUserDebugBlocks(REAL_LOG).map(m => m.message);
  return Object.fromEntries(names.map((name, i) => [name, messages[i]]));
})();
const realText = (name) => textOf(render(logFor(REAL[name])));

test('real org output: every message is formatted (or text) without type names, broken keys, fake items or changed numbers', () => {
  assert.strictEqual(Object.keys(REAL).length, 77);
  // Shown as text: values Salesforce prints as plain text, a label with a simple map or set, and two sets in one message
  const TEXT = new Set(['S11', 'S12', 'S13', 'S14', 'S16', 'S21', 'S24', 'S30', 'Q02', 'Q09', 'Q11', 'Q13', 'M6', 'M7', 'M8', 'M10', 'R02', 'R03']);
  for (const [name, message] of Object.entries(REAL)) {
    const formatted = P.isStructuredMessage(message) && P.extractAndParseSalesforceObjects(message) !== null;
    const text = textOf(render(logFor(message)));
    assert.strictEqual(formatted, !TEXT.has(name), `${name}: ${text.slice(0, 100)}`);
    assert.doesNotMatch(text, /_apexType|"[^"]*=[^"]*": null|"\.\.\."|, \.\.\."|"attributes"/, name);
    for (const exact of ['9007199254740993', '10.50', '1.2345E-5', '&amp; done']) {
      if (message.includes(exact)) assert.ok(text.includes(exact), `${name} keeps ${exact}`);
    }
  }
});

test('real org output: records, classes and system classes read as Salesforce printed them', () => {
  // A street with line breaks (and no postal code) in a compound address
  const accounts = parse(REAL.S01);
  assert.strictEqual(accounts.length, 3);
  assert.deepStrictEqual(accounts[2].BillingAddress, { street: '312 Constitution Place\nAustin, TX 78767\nUSA', city: 'Austin',
    state: 'TX', country: 'United States', stateCode: 'TX', countryCode: 'US' });
  assert.deepStrictEqual(parse(REAL.S22), { Name: 'Multi', Description: 'line1\nline2\nline3' });
  // One-item lists stay lists, also a list with one custom class
  assert.deepStrictEqual(parse(REAL.S04), [{ AccountId: '001xx00000T32F6AAJ', Id: '003xx00000NAXzIAAX', LastName: 'Rogers' }]);
  const wrappers = parse(REAL.S08);
  assert.strictEqual(wrappers.length, 1);
  assert.deepStrictEqual(Object.keys(wrappers[0]), ['acc', 'count', 'detail', 'name', 'scores', 'tags']);
  assert.strictEqual(wrappers[0].name, 'Test, with comma');
  // Inherited fields (BaseItem.price) by their own name
  assert.deepStrictEqual(parse(REAL.M3)[0], { price: 10.5, sku: 'SKU-1', lineStatus: 'ACTIVE', note: 'transient note', quantity: 2, secret: 'hidden', total: null });
  // ", name=value" inside a text field stays in that field (class fields are printed sorted)
  const order = parse(REAL.M1);
  assert.strictEqual(order.trickyText, 'a, b=c [d] {e} (f) :g; h\nsecond line\ttab "q" \'s\' <b>bold</b> &amp; done');
  assert.strictEqual(order.customer.shipping, '(same object as above)');
  assert.deepStrictEqual(order.customer.addressesByType.billing.lines, ['Floor 2']);
  // ...but a toString() override that only looks like a class keeps every field
  assert.deepStrictEqual(parse('Response:[status=200, body=OK]'), { status: 200, body: 'OK' });
  // System classes
  assert.deepStrictEqual(parse(REAL.S18), { errors: [{ fields: ['Name'], message: 'Required fields are missing: [Name]', statusCode: 'REQUIRED_FIELD_MISSING' }],
    id: null, isSuccess: false });
  assert.strictEqual(realText('Q07'), 'Q07 { "latitude": 37.79, "longitude": -122.39 }');
  assert.deepStrictEqual(parse(REAL.S26), { Endpoint: 'https://example.com/api', Method: 'POST' });
  // Shared references, explicit nulls, empty strings and a custom exception
  assert.strictEqual(realText('Q12'), 'Q12 [ { "city": "Dhaka", "lines": [], "street": null }, "(same object as above)" ]');
  assert.strictEqual(realText('Q06'), 'Q06 { "Name": "Nulls", "Phone": null, "Website": "" }');
  assert.strictEqual(realText('M10'), 'ProbeException: Order ORD-001 failed: [SKU-1] out of stock');
});

test("real org output: Salesforce's 10-item cut is a note under the value, not an item", () => {
  for (const name of ['S25', 'R2-SET10', 'R2-MAP10', 'M14']) {
    assert.match(render(logFor(REAL[name])), /<span class="content-note">Salesforce prints only the first 10 items of a list, set or map\. Use Console\.log to see all of them\.<\/span>/, name);
  }
  assert.strictEqual(parse(REAL.S25).length, 10);
  const map = parse(REAL['R2-MAP10']);
  assert.strictEqual(Object.keys(map).length, 10);
  assert.strictEqual(map['9'], 'v9');
});

test('real org output: Console.log / JSON keeps exact numbers and drops only Salesforce metadata', () => {
  const text = realText('M15');
  assert.match(text, /"bigNumber": 9007199254740993/);
  assert.match(text, /"price": 10\.50, "total": 21\.00/);
  assert.match(text, /"ratio": 1\.2345E-5/);
  assert.match(text, /&amp; done/);
  assert.strictEqual(realText('J1'), '{ "Name": "Unsaved" }');
  assert.doesNotMatch(realText('J2'), /attributes|"done"/);
});

test('text around values: each value is formatted where it is, the text stays text', () => {
  const html = render(logFor('Old: Account:{Name=A, Phone=1} New: Account:{Name=B, Phone=2}'));
  assert.strictEqual(textOf(html), 'Old: { "Name": "A", "Phone": 1 } New: { "Name": "B", "Phone": 2 }');
  assert.match(html, /<span class="content-prefix">New:<\/span>/);
  assert.strictEqual(textOf(render(logFor('Before (Account:{Name=A}) after'))), 'Before [ { "Name": "A" } ] after');
  assert.match(realText('S29'), /^Before \{ "Id": .* \} after$/);
  // Stray brackets in a text value, also in a value before another one
  assert.strictEqual(textOf(render(logFor('Label Account:{Name=Smile :)}'))), 'Label { "Name": "Smile :)" }');
  assert.strictEqual(textOf(render(logFor('Old: Account:{Name=Smile :)} New: Account:{Name=B}'))), 'Old: { "Name": "Smile :)" } New: { "Name": "B" }');
  assert.strictEqual(textOf(render(logFor('Label Account:{Name=Unclosed { brace}'))), 'Label { "Name": "Unclosed { brace" }');
  // Two sets are not read as one
  assert.strictEqual(realText('S30'), '{x, y} {1, 2}');
});

test('text built in code: "," alone, unsorted classes, names starting with _ and a __proto__ key', () => {
  assert.deepStrictEqual(parse('Account:{Id=001A,Name=Acme,Industry=Tech}'), { Id: '001A', Name: 'Acme', Industry: 'Tech' });
  assert.deepStrictEqual(parse('(1,2,3)'), [1, 2, 3]);
  assert.deepStrictEqual(parse('Account:{Name=Smith,John}'), { Name: 'Smith,John' });
  assert.strictEqual(textOf(render(logFor('Payload:\n"[key=value,other=thing]"'))), '{ "Payload": { "key": "value", "other": "thing" } }');
  // A class printed out of sort order (e.g. a toString() override) keeps every field
  assert.deepStrictEqual(parse('Wrapper:[c=1, d=2, e=3, f=4, a=5]'), { c: 1, d: 2, e: 3, f: 4, a: 5 });
  assert.deepStrictEqual(parse('Wrapper:[_id=1, name=x]'), { _id: 1, name: 'x' });
  assert.strictEqual(textOf(render(logFor('{__proto__={x=1}, b=2}'))), '{ "__proto__": { "x": 1 }, "b": 2 }');
});

test('values are shown as printed: quotes and spacing kept, text that only looks like a number stays text', () => {
  assert.deepStrictEqual(parse('Account:{Name="Quoted", When=2026-01-01 00: 00: 00}'), { Name: '"Quoted"', When: '2026-01-01 00: 00: 00' });
  // Apex prints Double as 1.0E10 / 1.2345E-5 and Decimal as 1E-7 / 1.5E+8; a code such as 1E5 is text
  assert.strictEqual(textOf(render(logFor('Account:{Code=1E5, Small=1E-7, Big=1.5E+8, Ratio=1.0E10}'))),
    '{ "Code": "1E5", "Small": 1E-7, "Big": 1.5E+8, "Ratio": 1.0E10 }');
  // JSON keeps every number as written
  assert.match(textOf(render(logFor('{"a":1e5,"b":1.50}'))), /"a": 1e5, "b": 1\.50/);
});

test('custom exceptions read like System exceptions everywhere; long text before JSON is not a label', () => {
  assert.strictEqual(textOf(render(logFor('Error: ProbeException:[]: Order failed'))), 'Error: ProbeException: Order failed');
  assert.deepStrictEqual(parse('Result:[error=ProbeException:[]: boom, ok=false]'), { error: 'ProbeException: boom', ok: false });
  const longText = 'word '.repeat(200).trim();
  const html = render(logFor(longText + ' {"a":1}'));
  assert.ok(!html.includes('<span class="content-prefix">word'), 'long text is not shown as a bold label');
  assert.match(textOf(html), /word \{ "a": 1 \}$/);
});
