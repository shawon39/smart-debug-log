# Privacy Policy — Salesforce Debug Log Beautifier

**Effective date:** 2026-06-02

This extension is designed to keep your data in your browser. It communicates **directly** with Salesforce using your own session/OAuth credentials and does not send your data to the developer or any third party.

## What the extension accesses

- **Salesforce debug logs and related metadata** (ApexLog records, trace flags, debug levels, and the user records you search) — retrieved from the org you are actively using, via the Salesforce REST/Tooling APIs.
- **Your Salesforce session / OAuth token** — used solely to authenticate those API calls.
- **Anonymous Apex you choose to run and snippets you choose to save.**

The extension only acts on the Salesforce org of the tab you are using and only when you interact with it.

## What is stored, and where

All storage is **local to your browser**:

- **OAuth tokens** are stored in `chrome.storage.local` (per org) and are used to call Salesforce APIs on your behalf. You can remove them at any time using the **Revoke token** action in the extension.
- **Preferences** (theme, view mode), **saved Apex snippets**, and a **local cache of debug logs / debug status** are stored in `chrome.storage.local` / the page's `localStorage` for performance and convenience.

Nothing is uploaded to an external server. There are **no analytics, no tracking, and no telemetry**.

## What is NOT collected

- No personal data is transmitted to the developer.
- No browsing history outside the Salesforce domains the extension is permitted to run on.
- No advertising identifiers; no selling or sharing of data.

## Network connections

The extension only makes network requests to:

- **Salesforce domains** (`*.salesforce.com`, `*.force.com`, `*.cloudforce.com`, `*.lightning.force.com`, `*.my.salesforce.com`, and related Salesforce hosts) — to call Salesforce APIs and perform the OAuth login flow.

It makes no requests to any other host.

## Permissions and why they are required

| Permission | Purpose |
|---|---|
| Salesforce host permissions | Make API calls to the Salesforce org you are using |
| `cookies` | Read the Salesforce session cookie to authenticate API calls when applicable |
| `storage` | Save preferences, saved Apex snippets, cached logs, and OAuth tokens locally |
| `activeTab` / `scripting` | Determine which Salesforce org the current tab belongs to |
| `identity` | Perform the Salesforce OAuth (PKCE) login flow |
| `notifications`, `alarms`, `windows` | Notify on / schedule trace‑flag expiry cleanup and manage dashboard windows |

## Data retention and deletion

Because all data is stored locally:

- Removing the extension deletes its stored data.
- You can revoke the stored OAuth token from within the extension.
- Clearing the cached logs is available from the dashboard.

## Changes to this policy

If this policy changes, the updated version will be published in this repository with a new effective date.

## Contact

For questions about this policy, contact the developer at: shshawon416@gmail.com
