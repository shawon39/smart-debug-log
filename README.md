# Salesforce Debug Log Beautifier

A Chrome extension (Manifest V3) that transforms and manages Salesforce debug logs — syntax highlighting, JSON formatting, error analysis, governor‑limit views, trace‑flag management, and anonymous Apex execution. Built with vanilla JavaScript, no build tools, no external runtime dependencies.

> Press **Alt+Shift+D** (**Option+Shift+D** on macOS) on any Salesforce tab to open the dashboard.

## Features

- **Beautiful logs** — syntax highlighting, collapsible/pretty‑printed JSON, errors surfaced at the top, clean stack traces, and search.
- **Governor limits** — SOQL, heap, CPU, DML, callouts and more shown at a glance.
- **Manage debug logs** — create/extend/reduce/delete trace flags without opening Setup; enable debugging for any user (search by name/username); build custom debug levels; bulk‑delete old logs.
- **Execute Apex** — write, save, search, and run anonymous Apex snippets and see full output.
- **All environments** — production, sandbox, scratch, and developer orgs; handles the various Salesforce domains automatically.
- **Developer experience** — dark/light modes, responsive layout, raw‑response search, copy‑to‑clipboard, cached logs across tab switches.

Get clean debug output with either approach:

```apex
// Built-in
System.debug(JSON.serializePretty([SELECT Id, Name FROM Account LIMIT 5]));

// Or the optional Console helper class (wrapper around JSON.serializePretty)
Console.log('My Accounts', accounts);
```

## Installation

### From source (development)

1. Clone or download this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the project directory.
4. Open a Salesforce org, click the extension icon, and generate a token (OAuth).
5. Open the dashboard with **Alt+Shift+D** / **Option+Shift+D**.

### From the Chrome Web Store

Search for **“Salesforce Debug Log Beautifier”** in the Chrome Web Store and click **Add to Chrome**.

## Permissions

| Permission | Why it's needed |
|---|---|
| Salesforce host permissions (`*.salesforce.com`, `*.force.com`, …) | Call the Salesforce REST/Tooling APIs for the org you're on |
| `cookies` | Read the Salesforce session cookie to authenticate API calls when needed |
| `storage` | Save settings, theme, saved Apex snippets, and the OAuth token locally |
| `unlimitedStorage` | Keep saved Apex snippets and cached data without hitting the 10 MB storage limit |
| `scripting` | Run a small script in an open Salesforce tab, on demand, to read logs with that tab's session |
| `identity` | Perform the OAuth login flow (PKCE) |
| `alarms` | Act when a trace flag that the extension turned on expires (see below) |

See [PRIVACY.md](PRIVACY.md) for the full privacy policy and data‑handling details.

## Trace flags the extension turns on

Opening the dashboard from the popup or with the keyboard shortcut turns on a 45‑minute `USER_DEBUG` trace flag for you, unless one is already active. When such a flag expires, the extension only forgets it. It does **not** delete any logs unless you turn on automatic log cleanup (`autoCleanupLogs`, off by default) in **Manage Debug Logs**. With cleanup on, only your own `Monitoring` logs from that flag's time window are deleted. Deleting, replacing or shortening a trace flag never deletes logs.

## OAuth setup

The extension logs in with its own connected app. Since September 2025 Salesforce blocks users without the "Approve Uninstalled Connected Apps" permission from using apps that are not installed in their org (errors such as `OAUTH_APPROVAL_ERROR_GENERIC` or "app must be installed into org"). If **Generate Token** fails:

1. **Ask your Salesforce admin to install the app:** Setup > Connected Apps OAuth Usage > find the app > Install, then set who can use it.
2. **Or use your own app:** create an External Client App in your org, then open **OAuth setup** in the dashboard's token banner and paste its consumer key. The app needs the callback URL shown there, the `api` and `refresh_token` scopes, PKCE, and no client secret for the web server flow or for refresh.

**One‑time login links (optional):** **Copy Session URL** and **Incognito Login** use a one‑time link (`/services/oauth2/singleaccess`) when the token has the `web` scope. Otherwise they use a link with your session ID, so never share it. To enable the `web` scope, first allow it in the connected app, then add `web` to `OAUTH_SCOPES` in `background/oauth-manager.js` and generate a new token. Do not add it before the app allows it: login fails when the app does not allow every requested scope.

## Development

This project intentionally uses **no npm/build tooling** — it's plain ES6+ JavaScript loaded directly by the browser.

- **Reload after changes:** the reload button on `chrome://extensions` (or Ctrl/Cmd+R on that page).
- **Debugging:** use the extension's DevTools (dashboard page) and the service‑worker console (`chrome://extensions` → *Inspect views: service worker*).
- **Testing:** `node --test tests/*.test.js` (run in the project folder) runs the unit tests (plain Node 22, nothing to install). Check UI changes by hand against a live Salesforce org.

A high‑level architecture overview (background/content/UI layers, message passing, the log‑processing pipeline) is documented in [CLAUDE.md](CLAUDE.md).

```
background/   Service worker, session/OAuth/token management, API client
content/      Content scripts injected into Salesforce pages
js/           Log loading, rendering, parsing, syntax highlighting, Apex tools, dashboard
css/          Theming (theme-variables.css) and component styles
popup/        Toolbar popup UI
dashboard.html  Main dashboard page
manifest.json   Extension configuration
```

## Privacy & security

Everything runs in your browser and talks **directly** to Salesforce using your own session/OAuth token. No data is sent to any third‑party server; there is no tracking or analytics. See [PRIVACY.md](PRIVACY.md).

## License

See repository for license details.
