// Builds the Chrome Web Store upload: store/package/salesforce-debug-log-beautifier-<version>.zip
// Only the files the extension needs go in (no tests, docs, store assets or git files).
// Usage (from the project folder): node store/build-package.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE = ['manifest.json', 'dashboard.html', 'background', 'content', 'css', 'icons', 'js', 'popup'];
const OUT_DIR = path.join(ROOT, 'store', 'package');

const problems = [];
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// Web Store limits and rules
if ('key' in manifest) problems.push('manifest.json has a "key" field: remove it, the Web Store keeps the existing extension ID.');
if (manifest.name.length > 75) problems.push(`Name is ${manifest.name.length} characters (max 75).`);
if (manifest.description.length > 132) problems.push(`Description is ${manifest.description.length} characters (max 132).`);
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) problems.push(`Version "${manifest.version}" is not a valid Chrome version.`);

function listFiles(entry) {
  const full = path.join(ROOT, entry);
  if (!fs.existsSync(full)) {
    problems.push(`Missing: ${entry}`);
    return [];
  }
  if (fs.statSync(full).isFile()) return [entry];
  return fs.readdirSync(full)
    .filter(name => !name.startsWith('.'))
    .flatMap(name => listFiles(path.join(entry, name)));
}
const files = INCLUDE.flatMap(listFiles).map(file => file.split(path.sep).join('/'));
const included = new Set(files);

// Everything the manifest and pages point at must be in the package
const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {})
].filter(Boolean);
for (const page of ['dashboard.html', 'popup/popup.html']) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
    if (/^(https?:|data:|mailto:)/.test(ref)) continue;
    referenced.push(path.posix.normalize(path.posix.join(path.posix.dirname(page), ref)));
  }
}
for (const file of files.filter(f => f.startsWith('background/') && f.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const [, ref] of source.matchAll(/from\s+'(\.[^']+)'/g)) {
    referenced.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), ref)));
  }
}
for (const ref of new Set(referenced)) {
  if (!included.has(ref)) problems.push(`Referenced but not in the package: ${ref}`);
}

if (problems.length) {
  console.error('Package not built:\n- ' + problems.join('\n- '));
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const zipPath = path.join(OUT_DIR, `salesforce-debug-log-beautifier-${manifest.version}.zip`);
fs.rmSync(zipPath, { force: true });
// -X leaves out macOS extra attributes; files are listed explicitly so nothing else slips in
execFileSync('zip', ['-X', '-q', zipPath, ...files], { cwd: ROOT });

const kb = (fs.statSync(zipPath).size / 1024).toFixed(0);
console.log(`Built ${path.relative(ROOT, zipPath)} (${files.length} files, ${kb} KB)`);
console.log(`${manifest.name} ${manifest.version}`);
