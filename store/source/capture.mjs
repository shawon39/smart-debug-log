// Renders the store images with the installed Google Chrome (headless, DevTools protocol).
// No npm packages: Node 22 has fetch and WebSocket built in.
//   node store/source/capture.mjs            all images
//   node store/source/capture.mjs icon       only jobs whose output path contains "icon"
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.resolve(HERE, '..');
const REPO = path.resolve(STORE, '..');
const PORT = 8766;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// [page under store/source/, output file, width, height, transparent background]
const JOBS = [
  ['icon/render.html?size=16', `${REPO}/icons/icon-16.png`, 16, 16, true],
  ['icon/render.html?size=32', `${REPO}/icons/icon-32.png`, 32, 32, true],
  ['icon/render.html?size=48', `${REPO}/icons/icon-48.png`, 48, 48, true],
  ['icon/render.html?size=128', `${REPO}/icons/icon-128.png`, 128, 128, true],
  ['icon/render.html?size=128&store=1', `${STORE}/assets/icon-128.png`, 128, 128, true],
  ['scenes/screenshot.html?n=1', `${STORE}/assets/screenshots/1-readable-logs.png`, 1280, 800],
  ['scenes/screenshot.html?n=2', `${STORE}/assets/screenshots/2-system-debug-to-json.png`, 1280, 800],
  ['scenes/screenshot.html?n=3', `${STORE}/assets/screenshots/3-trace-flags.png`, 1280, 800],
  ['scenes/screenshot.html?n=4', `${STORE}/assets/screenshots/4-execute-apex.png`, 1280, 800],
  ['scenes/screenshot.html?n=5', `${STORE}/assets/screenshots/5-popup-on-salesforce.png`, 1280, 800],
  ['scenes/promo-small.html', `${STORE}/assets/promo/small-promo-tile-440x280.png`, 440, 280],
  ['scenes/promo-marquee.html', `${STORE}/assets/promo/marquee-promo-tile-1400x560.png`, 1400, 560]
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sdl-capture-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = '';
    chrome.stderr.on('data', chunk => {
      buffer += chunk;
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    chrome.on('exit', code => reject(new Error(`Chrome exited (${code})`)));
  });
  return { chrome, wsUrl, profile };
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const waiters = [];
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      waiters.filter(w => w.method === msg.method && w.sessionId === msg.sessionId).forEach(w => w.resolve(msg.params));
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const once = (method, sessionId) => new Promise(resolve => waiters.push({ method, sessionId, resolve }));
  return new Promise(resolve => { ws.onopen = () => resolve({ send, once, close: () => ws.close() }); });
}

async function capture(cdp, url, width, height, transparent) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  if (transparent) await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const loaded = cdp.once('Page.loadEventFired', sessionId);
  await send('Page.navigate', { url });
  await loaded;
  // Pages set data-ready="1" (or "error") on <html> when every frame has finished its scene
  for (let i = 0; i < 300; i++) {
    const { result } = await send('Runtime.evaluate', { expression: 'document.documentElement.dataset.ready || ""', returnByValue: true });
    if (result.value === 'error') throw new Error(`Scene failed: ${url}`);
    if (result.value === '1') break;
    await sleep(100);
  }
  await sleep(300);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  await cdp.send('Target.closeTarget', { targetId });
  return Buffer.from(data, 'base64');
}

async function main() {
  const filter = process.argv[2];
  // Preview any page: node capture.mjs --page <page> <out.png> <width> <height>
  const jobs = filter === '--page'
    ? [[process.argv[3], path.resolve(process.argv[4]), Number(process.argv[5]), Number(process.argv[6])]]
    : JOBS.filter(([, out]) => !filter || out.includes(filter));
  const server = await startServer(PORT);
  const { chrome, wsUrl, profile } = await launchChrome();
  const cdp = await connect(wsUrl);
  try {
    for (const [page, out, width, height, transparent] of jobs) {
      const png = await capture(cdp, `http://127.0.0.1:${PORT}/store/source/${page}`, width, height, transparent);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, png);
      console.log(`${path.relative(REPO, out)}  ${width}x${height}`);
    }
  } finally {
    cdp.close();
    const exited = new Promise(resolve => chrome.once('exit', resolve));
    chrome.kill();
    await exited;
    server.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
