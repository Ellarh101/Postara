import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compareVersions, createUpdater } from '../src/updater.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const pkg = (version, deps = { express: '1' }) => JSON.stringify({ name: 'whatsapp-auto-poster', version, dependencies: deps });

function makeApp(version = '1.0.0') {
  const appDir = tmp();
  write(path.join(appDir, 'package.json'), pkg(version));
  write(path.join(appDir, 'src/a.js'), 'old');
  write(path.join(appDir, 'src/gone.js'), 'removed in the new version');
  write(path.join(appDir, 'data/poster.json'), '{"keep":"me"}');
  write(path.join(appDir, '.env'), 'SECRET=1');
  write(path.join(appDir, 'node_modules/x/index.js'), 'dep');
  return appDir;
}

function makeZip(dir, name, version, deps) {
  const src = tmp();
  const root = path.join(src, 'whatsapp-poster');
  write(path.join(root, 'package.json'), pkg(version, deps));
  write(path.join(root, 'src/a.js'), 'new');
  write(path.join(root, 'src/b.js'), 'brand new');
  const zip = path.join(dir, name);
  execFileSync('zip', ['-rq', zip, 'whatsapp-poster'], { cwd: src });
  return zip;
}

const updater = (appDir, downloads, extra = {}) => createUpdater({
  appDir, dataDir: path.join(appDir, 'data'), version: '1.0.0', downloadDirs: [downloads], installDeps: async () => {}, ...extra,
});

test('versions compare like numbers', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.4.0', '1.4.0'), 0);
  assert.equal(compareVersions('1.3', '1.4.0'), -1);
});

test('finds a newer zip in Downloads and installs it, keeping data, settings and modules', async () => {
  const appDir = makeApp();
  const downloads = tmp();
  makeZip(downloads, 'whatsapp-poster.zip', '1.1.0');
  write(path.join(downloads, 'holiday-photos.zip'), 'not ours');
  let restarted = false;
  const u = updater(appDir, downloads, { restart: () => { restarted = true; } });
  const checked = await u.check();
  assert.equal(checked.found.version, '1.1.0');
  const done = await u.install();
  assert.equal(done.state, 'done');
  assert.equal(fs.readFileSync(path.join(appDir, 'src/a.js'), 'utf8'), 'new');
  assert.equal(fs.existsSync(path.join(appDir, 'src/b.js')), true);
  assert.equal(fs.existsSync(path.join(appDir, 'src/gone.js')), false, 'stale files are removed');
  assert.equal(fs.readFileSync(path.join(appDir, 'data/poster.json'), 'utf8'), '{"keep":"me"}');
  assert.equal(fs.readFileSync(path.join(appDir, '.env'), 'utf8'), 'SECRET=1');
  assert.equal(fs.existsSync(path.join(appDir, 'node_modules/x/index.js')), true);
  await new Promise((r) => setTimeout(r, 2700));
  assert.equal(restarted, true);
});

test('no update offered when the zip is not newer', async () => {
  const appDir = makeApp('1.1.0');
  const downloads = tmp();
  makeZip(downloads, 'whatsapp-poster.zip', '1.1.0');
  const u = updater(appDir, downloads, { version: '1.1.0' });
  const r = await u.check();
  assert.equal(r.found, null);
  assert.match(r.message, /newest version/);
});

test('a failed install puts the old version back', async () => {
  const appDir = makeApp();
  const downloads = tmp();
  makeZip(downloads, 'whatsapp-poster.zip', '1.2.0', { express: '2' }); // different dependencies, so it installs
  const u = updater(appDir, downloads, { installDeps: async () => { throw new Error('no internet'); } });
  await u.check();
  const r = await u.install();
  assert.equal(r.state, 'error');
  assert.match(r.message, /old version was kept/);
  assert.equal(fs.readFileSync(path.join(appDir, 'src/a.js'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(appDir, 'src/gone.js')), true);
  assert.equal(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'), pkg('1.0.0'));
});

test('can also update from a web address (for example a GitHub zip link)', async () => {
  const appDir = makeApp();
  const downloads = tmp();
  const zip = makeZip(tmp(), 'repo-main.zip', '1.3.0');
  const bytes = fs.readFileSync(zip);
  const u = updater(appDir, downloads, {
    getUpdateUrl: () => 'https://github.com/someone/repo/archive/refs/heads/main.zip',
    fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }),
  });
  const r = await u.check();
  assert.equal(r.found.version, '1.3.0');
  assert.equal(r.found.source, 'web');
  assert.equal((await u.install()).state, 'done');
});

test('a plain http address is refused', async () => {
  const u = updater(makeApp(), tmp(), { getUpdateUrl: () => 'http://example.com/app.zip' });
  const r = await u.check();
  assert.match(r.message, /https/);
});
