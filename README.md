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
| `activeTab` / `scripting` | Detect which org the active tab belongs to |
| `identity` | Perform the OAuth login flow (PKCE) |
| `notifications`, `alarms`, `windows` | Trace‑flag expiry cleanup, scheduling, and dashboard windows |

See [PRIVACY.md](PRIVACY.md) for the full privacy policy and data‑handling details.

## Development

This project intentionally uses **no npm/build tooling** — it's plain ES6+ JavaScript loaded directly by the browser.

- **Reload after changes:** the reload button on `chrome://extensions` (or Ctrl/Cmd+R on that page).
- **Debugging:** use the extension's DevTools (dashboard page) and the service‑worker console (`chrome://extensions` → *Inspect views: service worker*).
- **Testing:** manual, against a live Salesforce org (no automated test suite).

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
