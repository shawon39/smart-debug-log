// Fictional Salesforce org used for the store screenshots. No real org data.
// Loaded before chrome-shim.js; exposes window.MOCK_ORG.
(function () {
  const HOST = 'acme--uat.sandbox.my.salesforce.com';
  const ORG_ID = '00D8a000002UaTqEAK';
  const USER_ID = '0058a00000LmPqAAAV';

  const users = [
    { Id: USER_ID, Name: 'Maya Patel', Username: 'maya.patel@acme.example.uat', Email: 'maya.patel@acme.example' },
    { Id: '0058a00000LmPqBAAV', Name: 'Daniel Kim', Username: 'daniel.kim@acme.example.uat', Email: 'daniel.kim@acme.example' },
    { Id: '0058a00000LmPqCAAV', Name: 'Integration User', Username: 'integration@acme.example.uat', Email: 'integration@acme.example' },
    { Id: '0058a00000LmPqDAAV', Name: 'Sofia Alvarez', Username: 'sofia.alvarez@acme.example.uat', Email: 'sofia.alvarez@acme.example' },
    { Id: '0058a00000LmPqEAAV', Name: 'Sam Okafor', Username: 'sam.okafor@acme.example.uat', Email: 'sam.okafor@acme.example' }
  ];

  // Builds debug log text: each entry is [event, ...fields] or a raw string (continuation line)
  function buildLog(startSeconds, entries) {
    let nanos = 1200000;
    let ms = 0;
    const lines = ['62.0 APEX_CODE,FINEST;APEX_PROFILING,INFO;CALLOUT,INFO;DB,INFO;SYSTEM,DEBUG;VALIDATION,INFO;WORKFLOW,INFO'];
    for (const entry of entries) {
      if (typeof entry === 'string') { lines.push(entry); continue; }
      ms += 3 + Math.floor(entry[0].length % 7);
      nanos += 1830000 + entry[0].length * 9137;
      const total = startSeconds * 1000 + ms;
      const h = String(Math.floor(total / 3600000) % 24).padStart(2, '0');
      const m = String(Math.floor(total / 60000) % 60).padStart(2, '0');
      const s = String(Math.floor(total / 1000) % 60).padStart(2, '0');
      const frac = String(total % 1000).padStart(3, '0');
      lines.push(`${h}:${m}:${s}.${frac} (${nanos})|${entry.join('|')}`);
    }
    return lines.join('\n');
  }

  const limits = (rows, extraNs) => {
    const base = {
      'Number of SOQL queries': [0, 100], 'Number of query rows': [0, 50000], 'Number of SOSL queries': [0, 20],
      'Number of DML statements': [0, 150], 'Number of Publish Immediate DML': [0, 150], 'Number of DML rows': [0, 10000],
      'Maximum CPU time': [0, 10000], 'Maximum heap size': [0, 6000000], 'Number of callouts': [0, 100],
      'Number of Email Invocations': [0, 10], 'Number of future calls': [0, 50],
      'Number of queueable jobs added to the queue': [0, 50], 'Number of Mobile Apex push calls': [0, 10]
    };
    Object.assign(base, rows);
    const out = [['CUMULATIVE_LIMIT_USAGE'], ['LIMIT_USAGE_FOR_NS', '(default)', '']];
    for (const [label, [used, max]] of Object.entries(base)) out.push(`  ${label}: ${used} out of ${max}`);
    out.push('');
    if (extraNs) {
      out.push(['LIMIT_USAGE_FOR_NS', extraNs.ns, '']);
      for (const [label, [used, max]] of Object.entries(extraNs.rows)) out.push(`  ${label}: ${used} out of ${max}`);
      out.push('');
    }
    out.push(['CUMULATIVE_LIMIT_USAGE_END']);
    return out;
  };

  const pretty = value => JSON.stringify(value, null, 2).replace(/": /g, '" : ');

  const topAccounts = [
    {
      attributes: { type: 'Account', url: '/services/data/v62.0/sobjects/Account/0018a00001XkLmQAAV' },
      Id: '0018a00001XkLmQAAV', Name: 'Northwind Traders', Industry: 'Retail', AnnualRevenue: 48500000, Rating: 'Hot',
      BillingAddress: { city: 'Seattle', country: 'USA', postalCode: '98101', state: 'WA', street: '1200 Pine Street' },
      Owner: { attributes: { type: 'User' }, Id: USER_ID, Name: 'Maya Patel' },
      Opportunities: {
        totalSize: 2, done: true,
        records: [
          { attributes: { type: 'Opportunity' }, Id: '0068a00000PqR1sAAF', Name: 'Northwind - Renewal FY27', StageName: 'Negotiation', Amount: 240000 },
          { attributes: { type: 'Opportunity' }, Id: '0068a00000PqR1tAAF', Name: 'Northwind - Analytics Add-on', StageName: 'Proposal', Amount: 86000 }
        ]
      }
    },
    {
      attributes: { type: 'Account', url: '/services/data/v62.0/sobjects/Account/0018a00001XkLmRAAV' },
      Id: '0018a00001XkLmRAAV', Name: 'Blue Harbor Logistics', Industry: 'Transportation', AnnualRevenue: 31200000, Rating: 'Warm',
      BillingAddress: { city: 'Rotterdam', country: 'Netherlands', postalCode: '3011', state: null, street: 'Wijnhaven 88' },
      Owner: { attributes: { type: 'User' }, Id: '0058a00000LmPqBAAV', Name: 'Daniel Kim' },
      Opportunities: { totalSize: 0, done: true, records: [] }
    }
  ];

  const logs = [];
  const bodies = {};
  let minute = 0;
  function addLog(id, operation, application, durationMs, body, minutesAgo, user = USER_ID) {
    minute = minutesAgo;
    const start = new Date(Date.now() - minutesAgo * 60000 - 17000);
    logs.push({
      attributes: { type: 'ApexLog' }, Id: id, LogUserId: user, StartTime: start.toISOString().replace('Z', '+0000'),
      LogLength: body.length, Application: application, Operation: operation, DurationMilliseconds: durationMs, Location: 'Monitoring'
    });
    bodies[id] = body;
  }

  // 1. Opportunity trigger failing on a null discount: the hero log with an error
  addLog('07L8a00000Zx1AAAA1', '/services/data/v62.0/ui-api/records/0068a00000PqR1sAAF', 'Browser', 1184, buildLog(52281, [
    ['EXECUTION_STARTED'],
    ['CODE_UNIT_STARTED', '[EXTERNAL]', '01q8a000000TrgQ', 'OpportunityTrigger on Opportunity trigger event BeforeUpdate'],
    ['SOQL_EXECUTE_BEGIN', '[18]', 'Aggregations:0', 'SELECT Id, Discount_Percent__c, Pricebook2Id FROM Opportunity WHERE Id IN :tmpVar1'],
    ['SOQL_EXECUTE_END', '[18]', 'Rows:1'],
    ['USER_DEBUG', '[24]', 'DEBUG', 'Pricing request: ' + pretty({
      opportunityId: '0068a00000PqR1sAAF', accountName: 'Northwind Traders', stage: 'Negotiation',
      lineItems: [
        { product: 'Platform Licence', quantity: 120, unitPrice: 1500 },
        { product: 'Premier Support', quantity: 1, unitPrice: 36000 }
      ],
      discountPercent: null, currency: 'USD'
    })],
    ['METHOD_ENTRY', '[31]', '01p8a00000DpLzQ', 'OpportunityPricingService.applyDiscount(Opportunity)'],
    ['EXCEPTION_THROWN', '[42]', 'System.NullPointerException: Attempt to de-reference a null object'],
    ['FATAL_ERROR', 'System.NullPointerException: Attempt to de-reference a null object'],
    '',
    'Class.OpportunityPricingService.applyDiscount: line 42, column 1',
    'Class.OpportunityTriggerHandler.beforeUpdate: line 31, column 1',
    'Trigger.OpportunityTrigger: line 7, column 1',
    ...limits({ 'Number of SOQL queries': [63, 100], 'Number of query rows': [1840, 50000], 'Number of DML statements': [4, 150], 'Maximum CPU time': [2412, 10000], 'Maximum heap size': [1482211, 6000000] }),
    ['CODE_UNIT_FINISHED', 'OpportunityTrigger on Opportunity trigger event BeforeUpdate'],
    ['EXECUTION_FINISHED']
  ]), 1);

  // 2. Execute Anonymous with Console.log(label, list): pretty JSON
  addLog('07L8a00000Zx1AAAA2', '/services/data/v62.0/tooling/executeAnonymous/', 'Unknown', 96, buildLog(52101, [
    ['EXECUTION_STARTED'],
    ['CODE_UNIT_STARTED', '[EXTERNAL]', 'execute_anonymous_apex'],
    ['SOQL_EXECUTE_BEGIN', '[1]', 'Aggregations:1', 'SELECT Id, Name, Industry, AnnualRevenue, Rating, BillingAddress, Owner.Name, (SELECT Id, Name, StageName, Amount FROM Opportunities) FROM Account ORDER BY AnnualRevenue DESC LIMIT 2'],
    ['SOQL_EXECUTE_END', '[1]', 'Rows:2'],
    ['USER_DEBUG', '[4]', 'DEBUG', 'Top Accounts: ' + pretty(topAccounts)],
    ['USER_DEBUG', '[5]', 'DEBUG', 'Pipeline total: 326000'],
    ...limits({ 'Number of SOQL queries': [1, 100], 'Number of query rows': [4, 50000], 'Maximum CPU time': [38, 10000] }),
    ['CODE_UNIT_FINISHED', 'execute_anonymous_apex'],
    ['EXECUTION_FINISHED']
  ]), 3);

  // 3. Lightning action with plain System.debug of records (no JSON): the parser makes it readable
  addLog('07L8a00000Zx1AAAA3', '/aura', 'Browser', 342, buildLog(51990, [
    ['EXECUTION_STARTED'],
    ['CODE_UNIT_STARTED', '[EXTERNAL]', 'apex://CaseConsoleController/ACTION$getEscalations'],
    ['SOQL_EXECUTE_BEGIN', '[12]', 'Aggregations:0', 'SELECT Id, CaseNumber, Subject, Priority, Status, Account.Name FROM Case WHERE IsEscalated = true'],
    ['SOQL_EXECUTE_END', '[12]', 'Rows:3'],
    ['USER_DEBUG', '[15]', 'DEBUG', '(Case:{Id=5008a00000GtR2aAAF, CaseNumber=00041872, Subject=Invoice sync failing for EU entity, Priority=High, Status=Escalated, AccountId=0018a00001XkLmRAAV}, Case:{Id=5008a00000GtR2bAAF, CaseNumber=00041877, Subject=SSO login loop after password reset, Priority=Critical, Status=Escalated, AccountId=0018a00001XkLmQAAV}, Case:{Id=5008a00000GtR2cAAF, CaseNumber=00041880, Subject=Bulk export times out, Priority=Medium, Status=Working, AccountId=0018a00001XkLmQAAV})'],
    ['USER_DEBUG', '[21]', 'DEBUG', 'EscalationSummary:[critical=1, high=1, medium=1, oldestOpenHours=37, owners={Daniel Kim=2, Maya Patel=1}]'],
    ...limits({ 'Number of SOQL queries': [2, 100], 'Number of query rows': [3, 50000], 'Maximum CPU time': [61, 10000] }),
    ['CODE_UNIT_FINISHED', 'apex://CaseConsoleController/ACTION$getEscalations'],
    ['EXECUTION_FINISHED']
  ]), 9);

  // 4. Nightly batch close to the SOQL limit: limits in warning colours
  addLog('07L8a00000Zx1AAAA4', 'BatchApex', 'Batch Apex', 8731, buildLog(50410, [
    ['EXECUTION_STARTED'],
    ['CODE_UNIT_STARTED', '[EXTERNAL]', '01p8a00000DpM0A', 'RenewalForecastBatch'],
    ['USER_DEBUG', '[44]', 'DEBUG', 'Batch scope: 200 opportunities, region=EMEA'],
    ['USER_DEBUG', '[88]', 'WARN', 'SOQL inside loop detected in RenewalForecastBatch.calculate (line 88)'],
    ['USER_DEBUG', '[120]', 'DEBUG', pretty({ processed: 200, updated: 187, skipped: 13, forecastTotal: 4180000, durationMs: 8731 })],
    ...limits({
      'Number of SOQL queries': [91, 200], 'Number of query rows': [18432, 50000], 'Number of DML statements': [12, 150],
      'Number of DML rows': [187, 10000], 'Maximum CPU time': [41870, 60000], 'Maximum heap size': [7911430, 12000000]
    }, { ns: 'acmecpq', rows: { 'Number of SOQL queries': [9, 100], 'Maximum CPU time': [2140, 60000] } }),
    ['CODE_UNIT_FINISHED', 'RenewalForecastBatch'],
    ['EXECUTION_FINISHED']
  ]), 18, '0058a00000LmPqCAAV');

  // 5. Queueable callout with an HTTP response body
  addLog('07L8a00000Zx1AAAA5', 'Queueable', 'Unknown', 1412, buildLog(49960, [
    ['EXECUTION_STARTED'],
    ['CODE_UNIT_STARTED', '[EXTERNAL]', '01p8a00000DpM0B', 'ErpInvoiceSyncJob'],
    ['CALLOUT_REQUEST', '[63]', 'System.HttpRequest[Endpoint=callout:ERP/api/v2/invoices, Method=POST]'],
    ['CALLOUT_RESPONSE', '[63]', 'System.HttpResponse[Status=Created, StatusCode=201]'],
    ['USER_DEBUG', '[71]', 'DEBUG', 'ERP response: ' + pretty({ invoiceNumber: 'INV-2026-10418', status: 'POSTED', total: 182400, currency: 'EUR', lines: 3, warnings: [] })],
    ...limits({ 'Number of SOQL queries': [3, 200], 'Number of callouts': [1, 100], 'Maximum CPU time': [94, 60000], 'Number of DML statements': [1, 150], 'Number of DML rows': [1, 10000] }),
    ['CODE_UNIT_FINISHED', 'ErpInvoiceSyncJob'],
    ['EXECUTION_FINISHED']
  ]), 26, '0058a00000LmPqCAAV');

  // 6. Validation failure from the API
  addLog('07L8a00000Zx1AAAA6', '/services/data/v62.0/composite/sobjects', 'Unknown', 207, buildLog(49200, [
    ['EXECUTION_STARTED'],
    ['CODE_UNIT_STARTED', '[EXTERNAL]', '01q8a000000TrgR', 'ContactTrigger on Contact trigger event BeforeInsert'],
    ['USER_DEBUG', '[19]', 'DEBUG', 'Database.SaveResult[getErrors=(Database.Error[getFields=(Email);getMessage=Email domain is not allowed for partner contacts;getStatusCode=FIELD_CUSTOM_VALIDATION_EXCEPTION;]);getId=null;isSuccess=false;]'],
    ['EXCEPTION_THROWN', '[22]', 'System.DmlException: Insert failed. First exception on row 0; first error: FIELD_CUSTOM_VALIDATION_EXCEPTION, Email domain is not allowed for partner contacts: [Email]'],
    ['FATAL_ERROR', 'System.DmlException: Insert failed. First exception on row 0; first error: FIELD_CUSTOM_VALIDATION_EXCEPTION, Email domain is not allowed for partner contacts: [Email]'],
    '',
    'Class.PartnerContactService.createContacts: line 22, column 1',
    'Trigger.ContactTrigger: line 4, column 1',
    ...limits({ 'Number of SOQL queries': [2, 100], 'Number of DML statements': [1, 150], 'Maximum CPU time': [33, 10000] }),
    ['CODE_UNIT_FINISHED', 'ContactTrigger on Contact trigger event BeforeInsert'],
    ['EXECUTION_FINISHED']
  ]), 34, '0058a00000LmPqCAAV');

  // 7-9. Smaller logs so the list looks lived-in
  addLog('07L8a00000Zx1AAAA7', '/apex/QuoteBuilder', 'Browser', 158, buildLog(48800, [
    ['EXECUTION_STARTED'],
    ['CODE_UNIT_STARTED', '[EXTERNAL]', '0668a000000Qb4E', 'VF: /apex/QuoteBuilder'],
    ['USER_DEBUG', '[58]', 'DEBUG', 'Quote total recalculated: 12480.00 (discount 8%)'],
    ...limits({ 'Number of SOQL queries': [5, 100], 'Maximum CPU time': [71, 10000] }),
    ['CODE_UNIT_FINISHED', 'VF: /apex/QuoteBuilder'],
    ['EXECUTION_FINISHED']
  ]), 41);
  addLog('07L8a00000Zx1AAAA8', 'FutureHandler', 'Unknown', 64, buildLog(48300, [
    ['EXECUTION_STARTED'],
    ['CODE_UNIT_STARTED', '[EXTERNAL]', '01p8a00000DpM0C', 'GeoCodingService.refreshAsync'],
    ['USER_DEBUG', '[30]', 'DEBUG', 'Geocoded 4 addresses, 0 failures'],
    ...limits({ 'Number of callouts': [4, 100], 'Maximum CPU time': [22, 60000] }),
    ['CODE_UNIT_FINISHED', 'GeoCodingService.refreshAsync'],
    ['EXECUTION_FINISHED']
  ]), 55);
  addLog('07L8a00000Zx1AAAA9', '/aura', 'Browser', 129, buildLog(47700, [
    ['EXECUTION_STARTED'],
    ['CODE_UNIT_STARTED', '[EXTERNAL]', 'apex://AccountHealthController/ACTION$getScore'],
    ['USER_DEBUG', '[9]', 'DEBUG', '{score=82, trend=UP, signals=(Usage, Support, Billing)}'],
    ...limits({ 'Number of SOQL queries': [3, 100], 'Maximum CPU time': [27, 10000] }),
    ['CODE_UNIT_FINISHED', 'apex://AccountHealthController/ACTION$getScore'],
    ['EXECUTION_FINISHED']
  ]), 63);

  const now = Date.now();
  const iso = offsetMin => new Date(now + offsetMin * 60000).toISOString().replace('Z', '+0000');

  const debugLevels = [
    { Id: '7dl8a000000Lw1AAAS', DeveloperName: 'SFDC_DevConsole', MasterLabel: 'SFDC_DevConsole', ApexCode: 'FINEST', Database: 'INFO', System: 'DEBUG', Workflow: 'INFO', Visualforce: 'INFO', Callout: 'INFO', Validation: 'INFO', ApexProfiling: 'INFO' },
    { Id: '7dl8a000000Lw1BAAS', DeveloperName: 'Apex_Only', MasterLabel: 'Apex Only', ApexCode: 'DEBUG', Database: 'NONE', System: 'NONE', Workflow: 'NONE', Visualforce: 'NONE', Callout: 'NONE', Validation: 'NONE', ApexProfiling: 'NONE' },
    { Id: '7dl8a000000Lw1CAAS', DeveloperName: 'Integration_Debug', MasterLabel: 'Integration Debug', ApexCode: 'FINE', Database: 'INFO', System: 'INFO', Workflow: 'NONE', Visualforce: 'NONE', Callout: 'FINEST', Validation: 'INFO', ApexProfiling: 'NONE' }
  ];

  const traceFlags = [
    { Id: '7tf8a000001QwErAAK', TracedEntityId: USER_ID, TracedEntity: { Name: 'Maya Patel' }, LogType: 'USER_DEBUG', DebugLevelId: debugLevels[0].Id, DebugLevel: { DeveloperName: 'SFDC_DevConsole', MasterLabel: 'SFDC_DevConsole' }, StartDate: iso(-7), ExpirationDate: iso(38) },
    { Id: '7tf8a000001QwEsAAK', TracedEntityId: '0058a00000LmPqCAAV', TracedEntity: { Name: 'Integration User' }, LogType: 'USER_DEBUG', DebugLevelId: debugLevels[2].Id, DebugLevel: { DeveloperName: 'Integration_Debug', MasterLabel: 'Integration Debug' }, StartDate: iso(-30), ExpirationDate: iso(210) },
    { Id: '7tf8a000001QwEtAAK', TracedEntityId: '0058a00000LmPqDAAV', TracedEntity: { Name: 'Sofia Alvarez' }, LogType: 'USER_DEBUG', DebugLevelId: debugLevels[1].Id, DebugLevel: { DeveloperName: 'Apex_Only', MasterLabel: 'Apex Only' }, StartDate: iso(-5), ExpirationDate: iso(12) }
  ];

  const apexSnippets = [
    {
      id: 'snip-1', name: 'Top accounts with pipeline', createdAt: now - 86400000 * 3, updatedAt: now - 3600000,
      code: "List<Account> accounts = [\n    SELECT Id, Name, Industry, AnnualRevenue, Rating, BillingAddress, Owner.Name,\n        (SELECT Id, Name, StageName, Amount FROM Opportunities)\n    FROM Account\n    ORDER BY AnnualRevenue DESC\n    LIMIT 2\n];\n\nConsole.log('Top Accounts', accounts);\n\nDecimal pipeline = 0;\nfor (Account acc : accounts) {\n    for (Opportunity opp : acc.Opportunities) {\n        pipeline += opp.Amount;\n    }\n}\nSystem.debug('Pipeline total: ' + pipeline);"
    },
    { id: 'snip-2', name: 'Reset test user password', createdAt: now - 86400000 * 9, updatedAt: now - 86400000 * 2, code: "User u = [SELECT Id FROM User WHERE Username = 'qa.tester@acme.example.uat'];\nSystem.resetPassword(u.Id, true);" },
    { id: 'snip-3', name: 'Run renewal forecast batch', createdAt: now - 86400000 * 12, updatedAt: now - 86400000 * 4, code: "Id jobId = Database.executeBatch(new RenewalForecastBatch('EMEA'), 200);\nSystem.debug('Started job ' + jobId);" },
    { id: 'snip-4', name: 'Check API limits', createdAt: now - 86400000 * 20, updatedAt: now - 86400000 * 6, code: "Map<String, System.OrgLimit> limits = OrgLimits.getMap();\nConsole.log('API requests', limits.get('DailyApiRequests'));" },
    { id: 'snip-5', name: 'Enqueue ERP invoice sync', createdAt: now - 86400000 * 25, updatedAt: now - 86400000 * 8, code: "System.enqueueJob(new ErpInvoiceSyncJob(new Set<Id>{ '0018a00001XkLmQAAV' }));" },
    { id: 'snip-6', name: 'Cases escalated today', createdAt: now - 86400000 * 31, updatedAt: now - 86400000 * 10, code: "System.debug([SELECT CaseNumber, Subject FROM Case WHERE IsEscalated = true AND CreatedDate = TODAY]);" }
  ];

  const executeResult = {
    compiled: true, success: true, compileProblem: null, exceptionMessage: null, exceptionStackTrace: null, line: -1, column: -1
  };

  window.MOCK_ORG = { HOST, ORG_ID, USER_ID, users, logs, bodies, debugLevels, traceFlags, apexSnippets, executeResult };
})();
