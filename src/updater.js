// Updates the app from inside the app: finds a newer version (a zip in your Downloads folder, or at a web
// address you choose), swaps in the new files, keeps your data and settings, installs what it needs and restarts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function compareVersions(a, b) {
  const x = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function run(cmd, args, { cwd, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === 'win32' });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${cmd} took too long`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out = (out + d).slice(-2000); });
    child.stderr.on('data', (d) => { out = (out + d).slice(-2000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

const APP_NAME = 'whatsapp-auto-poster';
// These stay exactly as they are during an update.
const KEEP = new Set(['data', 'node_modules', '.env', '.git']);

export function createUpdater({
  appDir, dataDir, version, getUpdateUrl = () => '', log = () => {}, restart = null,
  downloadDirs = [], installDeps = null, fetchImpl = fetch,
}) {
  const work = path.join(dataDir, 'update');
  const state = { state: 'idle', message: '', found: null };

  async function extract(zip, dest) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    try {
      const r = await run('unzip', ['-q', '-o', zip, '-d', dest]);
      if (r.code !== 0) throw new Error(r.out.trim() || 'unzip failed');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const r = await run('tar', ['-xf', zip, '-C', dest]); // Windows and macOS can open zips with tar
      if (r.code !== 0) throw new Error('Could not open the zip file');
    }
  }

  function findRoot(dir) {
    const ok = (d) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).name === APP_NAME;
      } catch {
        return false;
      }
    };
    if (ok(dir)) return dir;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && ok(path.join(dir, e.name))) return path.join(dir, e.name);
    return null;
  }

  async function readZipVersion(zip) {
    const tmp = path.join(work, 'peek');
    await extract(zip, tmp);
    const root = findRoot(tmp);
    if (!root) throw new Error('not this app');
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  }

  async function download(url) {
    if (!/^https:\/\//i.test(url)) throw new Error('The update address must start with https://');
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`The update address answered with an error (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 60 * 1024 * 1024) throw new Error('That download is too big to be the app');
    fs.mkdirSync(work, { recursive: true });
    const file = path.join(work, 'web.zip');
    fs.writeFileSync(file, buf);
    return file;
  }

  function localZips() {
    const out = [];
    for (const dir of downloadDirs) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) {
        if (!/(whatsapp.?poster|postara).*\.zip$/i.test(n)) continue;
        const p = path.join(dir, n);
        try { out.push({ path: p, mtime: fs.statSync(p).mtimeMs, source: 'downloads', name: n }); } catch { /* skip */ }
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime).slice(0, 5);
  }

  async function check() {
    if (state.state === 'working') return status();
    state.state = 'checking';
    state.message = '';
    state.found = null;
    const found = [];
    const notes = [];
    for (const z of localZips()) {
      try { found.push({ ...z, version: await readZipVersion(z.path) }); } catch { /* not our zip */ }
    }
    const url = getUpdateUrl();
    if (url) {
      try {
        const file = await download(url);
        found.push({ path: file, source: 'web', name: url, version: await readZipVersion(file) });
      } catch (e) {
        notes.push(`The web address did not work: ${e.message}`);
      }
    }
    found.sort((a, b) => compareVersions(b.version, a.version) || b.mtime - a.mtime);
    const best = found[0];
    state.state = 'idle';
    if (best && compareVersions(best.version, version) > 0) {
      state.found = { version: best.version, source: best.source, name: best.name, path: best.path };
      state.message = `Version ${best.version} is ready to install.`;
    } else {
      state.message = ['You have the newest version.', ...notes].join(' ');
    }
    return status();
  }

  async function install() {
    if (state.state === 'working') return status();
    const target = state.found;
    if (!target) throw new Error('Check for an update first.');
    state.state = 'working';
    state.message = 'Opening the update…';
    const backup = path.join(dataDir, 'backup', String(Date.now()));
    const replaced = [];
    try {
      const dest = path.join(work, 'new');
      await extract(target.path, dest);
      const root = findRoot(dest);
      if (!root) throw new Error('That file is not a version of this app.');
      const newPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      const oldPkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));

      state.message = 'Replacing the app files (your settings and posts stay)…';
      fs.mkdirSync(backup, { recursive: true });
      for (const name of fs.readdirSync(root)) {
        if (KEEP.has(name)) continue;
        const from = path.join(root, name);
        const to = path.join(appDir, name);
        if (fs.existsSync(to)) fs.cpSync(to, path.join(backup, name), { recursive: true });
        replaced.push(name);
        fs.rmSync(to, { recursive: true, force: true });
        fs.cpSync(from, to, { recursive: true });
      }

      const sameDeps = JSON.stringify(newPkg.dependencies) === JSON.stringify(oldPkg.dependencies)
        && fs.existsSync(path.join(appDir, 'node_modules'));
      if (!sameDeps) {
        state.message = 'Installing what the new version needs. This can take a few minutes…';
        await (installDeps ? installDeps(appDir) : defaultInstall(appDir));
      }

      fs.rmSync(work, { recursive: true, force: true });
      state.found = null;
      state.state = 'done';
      const canRestart = !!restart;
      state.message = canRestart
        ? `Updated to ${newPkg.version}. The app is restarting…`
        : `Updated to ${newPkg.version}. Close the app and start it again to finish.`;
      log('info', `Updated the app from ${version} to ${newPkg.version}`);
      if (canRestart) setTimeout(restart, 2500);
    } catch (e) {
      // put everything back the way it was
      for (const name of replaced) {
        try {
          fs.rmSync(path.join(appDir, name), { recursive: true, force: true });
          if (fs.existsSync(path.join(backup, name))) fs.cpSync(path.join(backup, name), path.join(appDir, name), { recursive: true });
        } catch { /* best effort */ }
      }
      state.state = 'error';
      state.message = `The update did not work, so your old version was kept. ${e.message}`;
      log('error', `Update failed: ${e.message}`);
    }
    return status();
  }

  async function defaultInstall(dir) {
    const r = await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=optional', '--legacy-peer-deps'], { cwd: dir });
    if (r.code !== 0) throw new Error(`Installing failed: ${r.out.split('\n').slice(-3).join(' ').trim()}`);
  }

  const status = () => ({ version, state: state.state, message: state.message, found: state.found ? { version: state.found.version, source: state.found.source, name: path.basename(String(state.found.name)) } : null, canRestart: !!restart });

  return { check, install, status };
}

export function defaultDownloadDirs() {
  const home = os.homedir();
  return [path.join(home, 'storage', 'downloads'), '/storage/emulated/0/Download', path.join(home, 'Downloads')];
}
