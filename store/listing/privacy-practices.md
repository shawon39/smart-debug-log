# Privacy practices tab

Copy each block into the field with the same name in the Chrome Web Store Developer Dashboard (item > **Privacy practices**). Each field allows up to 1,000 characters; every block below is shorter than that.

---

## Single purpose description

```text
Debug Log Beautifier helps Salesforce developers read and manage the debug logs of the Salesforce org they are working in. It loads the org's Apex debug logs and shows them formatted (System.debug and JSON output, errors and stack traces first, governor limits), turns the trace flags that produce those logs on and off, and runs anonymous Apex so the user can produce a new log. All features serve this one purpose: debugging Salesforce with its debug logs.
```

---

## Permission justifications

### cookies

```text
Reads the Salesforce session cookie (sid) only on Salesforce domains, for the org the user is working in. The cookie tells the extension which org is open and its API domain (My Domain), keeps the dashboard tied to the right org when several orgs or incognito windows are open, lets the log list load through an open Salesforce tab when the user has no OAuth token yet, and builds the "Incognito Login" link when the user asks for it. The cookie is never changed, never read on other sites, and never sent anywhere except to that same Salesforce org.
```

### storage

```text
Saves the user's settings (theme, view options), the anonymous Apex snippets the user chooses to save, the trace flags the extension turned on, and the OAuth token for each Salesforce org, in chrome.storage.local on the user's device. Access is limited to the extension's own pages and service worker, so web pages and content scripts cannot read the tokens. Nothing is synced or uploaded.
```

### unlimitedStorage

```text
Users save and import whole libraries of anonymous Apex snippets, kept per org in chrome.storage.local next to their tokens and settings. unlimitedStorage lets this data grow past the default 10 MB quota, so saving or importing snippets never fails part way. The data stays on the device and is removed when the extension is removed.
```

### scripting

```text
When the dashboard cannot load the log list through the service worker (for example, no OAuth token for that org yet), it injects the extension's own packaged content scripts (content/api-handler.js and content/api-operations.js) into an open Salesforce tab of the same org, on demand, so the logs can be read with that tab's logged-in session. It only runs on the Salesforce domains in host permissions and only injects files that ship inside the extension.
```

### identity

```text
Used for "Generate Token": chrome.identity.launchWebAuthFlow opens the Salesforce OAuth 2.0 login (authorization code flow with PKCE) and returns the authorization code to the extension's chromiumapp.org redirect URL. The resulting token is stored locally and only sent to the user's own Salesforce org.
```

### alarms

```text
Opening the dashboard can turn on a temporary debug trace flag for the user (45 minutes by default). An alarm fires when that trace flag expires so the extension can stop tracking it, and, only if the user turned on automatic log cleanup, delete the user's own logs from that time window. Alarms are the reliable way to do this in a Manifest V3 service worker.
```

### Host permissions

```text
The extension calls the Salesforce REST and Tooling APIs (ApexLog, TraceFlag, DebugLevel, User and executeAnonymous) of the org the user is working in, and runs the Salesforce OAuth login. Salesforce orgs live on many host names (My Domain, Lightning, Setup, sandbox, scratch, government and China regions), so it needs these Salesforce domains: *.salesforce.com, *.force.com, *.cloudforce.com, *.salesforce.mil, *.cloudforce.mil, *.sfcrmproducts.cn and *.salesforce-setup.com. It requests no access to any other website.
```

---

## Remote code

Select: **No, I am not using remote code.**

If the dashboard still asks for a justification, paste:

```text
All JavaScript ships inside the package and the extension pages use the Manifest V3 default policy (script-src 'self'). The extension only exchanges JSON data with the Salesforce APIs. The Execute Anonymous feature sends Apex text that the user writes to Salesforce, where Salesforce runs it on its own servers; no code is downloaded or run inside the extension.
```

---

## Data usage

**What user data do you plan to collect from users now or in the future?**

The Web Store counts data that is only handled on the device, so tick these three:

| Tick | Category | Why |
|---|---|---|
| ✅ | **Personally identifiable information** | Names, usernames and email addresses of Salesforce users are shown when you search for a user to turn on a trace flag, and log records carry user IDs. Shown on screen only. |
| ✅ | **Authentication information** | The OAuth access and refresh tokens are stored locally, and the Salesforce session cookie is read to call the Salesforce API. |
| ✅ | **Website content** | Debug logs, trace flags, debug levels and Apex code from the user's Salesforce org are loaded, shown, and cached locally. |
| ☐ | Health information | Not used |
| ☐ | Financial and payment information | Not used |
| ☐ | Personal communications | Not used |
| ☐ | Location | Not used |
| ☐ | Web history | Not used (the extension only looks at the URL of Salesforce tabs to find the org) |
| ☐ | User activity | Not used (no clicks, keystrokes or usage tracking) |

**Certifications** (tick all three):

- ✅ I do not sell or transfer user data to third parties, outside of the approved use cases
- ✅ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ✅ I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## Privacy policy URL

Keep the current URL:

```text
https://gist.github.com/shawon39/6f6319f92c721b768b6a07cecf197269
```

Before you submit, replace the gist's text with [docs/PRIVACY.md](../../docs/PRIVACY.md) (it describes version 2.6.0: the `activeTab`, `notifications` and `windows` permissions are gone and `unlimitedStorage` is new). The policy must match what this page declares.
