# How the store images are made

The screenshots are the real `dashboard.html` and `popup/popup.html`, not drawings. A small server injects a stand-in for the `chrome.*` APIs that answers with a made-up org, so the pages run in a normal browser tab.

```
source/
├── capture.mjs        renders every image with headless Google Chrome (no npm packages)
├── server.mjs         serves the project; /mock/dashboard.html and /mock/popup.html get the mock injected
├── mock/
│   ├── mock-org.js    the "Acme" sandbox: debug logs, users, trace flags, debug levels, snippets
│   ├── chrome-shim.js chrome.runtime / storage / tabs stand-ins backed by mock-org.js
│   └── scenes.js      puts a page in a state: ?log=<id>, ?scene=trace, ?scene=apex, ?theme=dark
├── scenes/
│   ├── screenshot.html  the 5 screenshots (?n=1..5): headline + browser window
│   ├── lightning.html   Lightning-style record page behind the popup (screenshot 5)
│   ├── promo-small.html / promo-marquee.html
│   └── scene.css
└── icon/
    ├── icon.svg       the icon (32, 48 and 128 px are drawn from it)
    ├── icon-16.svg    hand-placed 16 px version for the toolbar
    ├── render.html    draws one icon size
    └── compare.html   icon sizes side by side on light and dark backgrounds
```

## Commands

Run from the project folder:

```bash
node store/source/capture.mjs
```

Writes `icons/icon-*.png` (the extension's own icons), `store/assets/icon-128.png`, the 5 screenshots and the 2 promo tiles. Pass part of an output path to render only some, for example `node store/source/capture.mjs screenshots`.

```bash
node store/source/server.mjs
```

Serves the project on http://127.0.0.1:8765 so you can open a scene in your browser, for example http://127.0.0.1:8765/store/source/scenes/screenshot.html?n=1 or http://127.0.0.1:8765/mock/dashboard.html?log=07L8a00000Zx1AAAA1&theme=dark.

Chrome is expected at `/Applications/Google Chrome.app`; set `CHROME_PATH` to use another one.

## Changing a screenshot

- Text and which log or dialog each one shows: `SCENES` in `scenes/screenshot.html`.
- Log content, users, trace flags: `mock/mock-org.js`.
- Because the screenshots use the real pages, UI changes in the extension show up the next time you render.
