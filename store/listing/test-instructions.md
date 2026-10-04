# Test instructions tab (optional)

The reviewer needs a Salesforce org to see the extension work. No test account from you is needed: a free Developer Edition org takes two minutes. Paste this into item > **Test instructions**:

```text
The extension works with any Salesforce org. No credentials are needed from the developer.

1. Get a free Salesforce Developer Edition org at https://developer.salesforce.com/signup and log in.
2. Click the extension icon on the Salesforce tab, then "Generate" next to Access token. Log in and click Allow (Salesforce OAuth with PKCE).
3. Click "View Debug Logs" (or press Alt+Shift+D, Option+Shift+D on Mac). The dashboard opens and turns on a 45-minute debug trace flag for your user.
4. Click "Execute Apex", click "New", paste this code and click "Execute":
   List<Account> accounts = [SELECT Id, Name, Industry FROM Account LIMIT 3];
   System.debug(accounts);
5. The new log appears under "Recent Logs" within a few seconds. Click it: the System.debug output is shown as formatted JSON, with governor limits on the right.
6. "Manage Debug Logs" shows and edits trace flags; "Raw Log" shows the original log text.

All requests go only to the Salesforce org you logged in to.
```
