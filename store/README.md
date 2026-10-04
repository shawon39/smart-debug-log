# Chrome Web Store release kit: version 2.6.0

Everything for the 2.6.0 update of **Salesforce Debug Log Beautifier** (store ID `nhjppmlfmlhfmgfhoopllbhapfjajpnj`, live version 2.5.0).

```
store/
├── README.md                 this checklist
├── build-package.mjs         builds the upload zip
├── package/                  the zip to upload (built, not in git)
├── assets/
│   ├── icon-128.png          store icon
│   ├── screenshots/          5 screenshots, 1280 x 800
│   └── promo/                small (440 x 280) and marquee (1400 x 560) tiles
├── listing/
│   ├── store-listing.md      Store listing tab, field by field
│   ├── description.txt       the full description, ready to paste
│   ├── privacy-practices.md  single purpose, permission justifications, data usage
│   └── test-instructions.md  Test instructions tab
└── source/                   how the images are made (mock org, scenes, icon SVG)
```

## Upload steps

1. **Build the zip** in the project folder:

   ```bash
   node store/build-package.mjs
   ```

   It checks the manifest (no `key`, name and summary lengths) and that every file the manifest and pages load is inside, then writes `store/package/salesforce-debug-log-beautifier-2.6.0.zip`.

2. **Update the published privacy policy** with the text of [docs/PRIVACY.md](../docs/PRIVACY.md). For 2.6.0 that is the gist (https://gist.github.com/shawon39/6f6319f92c721b768b6a07cecf197269, done: it matches). Once the listing points to the website, it is the website's `/privacy` page instead.

3. Open the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), select the item.

4. **Package**: Upload new package, choose the zip from step 1.

5. **Store listing**: follow [listing/store-listing.md](listing/store-listing.md). Delete the 8 old screenshots, upload the 5 new ones in order, the icon and both promo tiles, paste the description.

6. **Privacy practices**: follow [listing/privacy-practices.md](listing/privacy-practices.md). Every justification is a copy-paste block.

7. **Test instructions** (optional, speeds up review): paste [listing/test-instructions.md](listing/test-instructions.md).

8. **Distribution**: leave as it is (Public, all regions, free).

9. **Submit for review.**

## After 2.6.0 is published

2.6.0 was submitted before the website existed. Don't cancel its review to change the listing; once it is published, make one listing update:

1. **Store listing** tab, *Additional fields*: Homepage URL `https://sfdebuglog.netlify.app/`, and pick `https://sfdebuglog.netlify.app/` as Official URL (it is verified in Search Console; if it is not in the list, add the developer account as an Owner in Search Console > Settings > Users and permissions).
2. **Store listing** tab, *Description*: paste [listing/description.txt](listing/description.txt) again (it now ends with the website link).
3. **Privacy practices** tab: Privacy policy URL `https://sfdebuglog.netlify.app/privacy`.
4. **Submit for review.** Keep the gist online, since older listing versions link to it.

The website (<https://sfdebuglog.netlify.app>) is a separate private repository, `shawon39/sfdebuglog`. Pushing to its `main` branch deploys it on Netlify. Its `/privacy` page is a copy of [docs/PRIVACY.md](../docs/PRIVACY.md), so update both when the policy changes.

## Checks done for this release

**OAuth key: new users can log in.** The consumer key in `background/oauth-manager.js` was sent to Salesforce's authorize endpoint with the store callback URL `https://nhjppmlfmlhfmgfhoopllbhapfjajpnj.chromiumapp.org/salesforce`:

| Test | Salesforce answered |
|---|---|
| Real key + store callback, `login.salesforce.com` | 302 to the Salesforce login page (accepted) |
| Real key + store callback, `test.salesforce.com` (sandboxes) | 302 to the Salesforce login page (accepted) |
| Real key + a made-up extension ID (control) | `redirect_uri_mismatch` (rejected) |
| Made-up key + store callback (control) | `invalid_client_id` (rejected) |

So the key is valid and the store extension's callback URL is registered. Version 2.6.0 uses the same key and callback as 2.5.0.

**Extension ID stays the same.** `manifest.json` has no `key` field, so the upload keeps the existing store ID and the callback above keeps working. Don't add a `key` field.

**Existing users are not disabled by the update.** Compared with 2.5.0, 2.6.0 removes `activeTab`, `notifications`, `windows` and some duplicate host patterns, and adds only `unlimitedStorage`, which shows no warning. Chrome only disables an extension on update when new permission warnings appear, so the 654 current users update silently.

**The package works.** The built zip was loaded into Chrome: the service worker starts, the dashboard and popup load all their scripts and styles with no errors, and all 174 unit tests pass.

**Still up to each org: connected app policy.** Since September 2025 Salesforce can block users from apps that are not installed in their org (unless they have "Approve Uninstalled Connected Apps"). No change to the extension can get around this. The extension already shows the fix in the error: the admin installs the app (Setup > Connected Apps OAuth Usage), or the user enters their own External Client App key under **OAuth setup**. The description has an "If login is blocked" section about it.

## Rebuilding the images

See [source/README.md](source/README.md). In short: `node store/source/capture.mjs` renders the icons, screenshots and promo tiles again with the installed Google Chrome.
