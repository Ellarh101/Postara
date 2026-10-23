import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { createTenants } from '../src/tenants.js';
import { createUsers } from '../src/users.js';
import { createStore } from '../src/db.js';
import { addItem } from './helpers.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

async function boot({ legacy = false, adminPassword = '' } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  if (legacy) {
    const s = createStore(path.join(dataDir, 'poster.json'));
    addItem(s, { original_caption: 'old post from before accounts' });
    s.flush();
  }
  const config = { root: ROOT, version: 't', brand: 'Test', dataDir, publicDir: path.join(ROOT, 'public'), anthropicKey: '', geminiKey: '', claudeModel: 'c', geminiModel: 'g', trustProxy: false };
  const users = createUsers({ dataDir });
  users.ensureAdmin({ password: adminPassword, legacy });
  const waLog = { started: [], stopped: [] };
  const factories = {
    createAi: () => ({ isEnabled: () => false, analyze: async () => null, test: async () => ({}) }),
    createWhatsApp: ({ config: cfg }) => ({
      start: () => waLog.started.push(cfg.dataDir), stop: () => waLog.stopped.push(cfg.dataDir),
      isOpen: () => false, getState: () => ({ connection: 'off', qr: null, me: null }), refreshGroups: async () => {},
    }),
  };
  const tenants = createTenants({ config, users, factories, startGapMs: 0, intervals: { prepare: 3_600_000, cleanup: 3_600_000 } });
  const updater = { status: () => ({ state: 'idle' }), check: async () => ({ state: 'idle' }), install: async () => {} };
  const app = createServer({ config, users, tenants, updater });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(method, url, { cookie = '', body, headers = {} } = {}) {
    const res = await fetch(base + url, {
      method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    return { status: res.status, json: await res.json().catch(() => ({})), cookie: set ? set.split(';')[0] : '', setCookie: set || '' };
  }
  const close = () => { tenants.stopAll(); server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); };
  return { dataDir, users, tenants, call, close, waLog };
}

test('one account without a password needs no sign-in (the phone-only way of using the app)', async () => {
  const t = await boot();
  try {
    const s = await t.call('GET', '/api/session');
    assert.equal(s.json.user.username, 'admin');
    assert.equal(s.json.open, true);
    assert.equal((await t.call('GET', '/api/status')).status, 200);
  } finally { t.close(); }
});

test('the admin starts with the password from the settings file and must sign in', async () => {
  const t = await boot({ adminPassword: 'firstpassword' });
  try {
    assert.equal((await t.call('GET', '/api/status')).status, 401);
    assert.equal((await t.call('GET', '/api/session')).json.user, null);
    const bad = await t.call('POST', '/api/login', { body: { username: 'admin', password: 'nope' } });
    assert.equal(bad.status, 401);
    const ok = await t.call('POST', '/api/login', { body: { username: 'ADMIN', password: 'firstpassword' } });
    assert.equal(ok.status, 200);
    assert.match(ok.setCookie, /HttpOnly/i);
    assert.match(ok.setCookie, /SameSite=Lax/i);
    assert.equal((await t.call('GET', '/api/status', { cookie: ok.cookie })).status, 200);
  } finally { t.close(); }
});

test('the admin sets a first password, then everybody must sign in', async () => {
  const t = await boot();
  try {
    const set = await t.call('PUT', '/api/account/password', { body: { next: 'brandnewpass' } });
    assert.equal(set.status, 200);
    assert.ok(set.cookie, 'this device stays signed in');
    assert.equal((await t.call('GET', '/api/status', { cookie: set.cookie })).status, 200);
    assert.equal((await t.call('GET', '/api/status')).status, 401, 'no more open access');
    const short = await t.call('PUT', '/api/account/password', { cookie: set.cookie, body: { current: 'brandnewpass', next: 'short' } });
    assert.equal(short.status, 400);
    const wrong = await t.call('PUT', '/api/account/password', { cookie: set.cookie, body: { current: 'wrong-one', next: 'anotherpass1' } });
    assert.equal(wrong.status, 400);
  } finally { t.close(); }
});

async function twoAccounts() {
  const t = await boot({ adminPassword: 'adminpassword' });
  const admin = (await t.call('POST', '/api/login', { body: { username: 'admin', password: 'adminpassword' } })).cookie;
  const made = await t.call('POST', '/api/users', { cookie: admin, body: { username: 'Bola', password: 'bolapassword' } });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const bola = (await t.call('POST', '/api/login', { body: { username: 'bola', password: 'bolapassword' } })).cookie;
  return { ...t, admin, bola, bolaId: made.json.user.id };
}

test('two accounts keep their own settings', async () => {
  const t = await twoAccounts();
  try {
    await t.call('PUT', '/api/settings', { cookie: t.bola, body: { businessName: 'Bola Styles', postTime: '18:30', itemsPerDay: 3, categories: ['bags', 'shoes'] } });
    await t.call('PUT', '/api/settings', { cookie: t.admin, body: { businessName: 'Ruchies', postTime: '07:15', itemsPerDay: 12 } });
    const a = (await t.call('GET', '/api/settings', { cookie: t.admin })).json;
    const b = (await t.call('GET', '/api/settings', { cookie: t.bola })).json;
    assert.deepEqual([a.businessName, a.postTime, a.itemsPerDay, a.categories], ['Ruchies', '07:15', 12, []]);
    assert.deepEqual([b.businessName, b.postTime, b.itemsPerDay, b.categories], ['Bola Styles', '18:30', 3, ['bags', 'shoes']]);
  } finally { t.close(); }
});

test('two accounts never see each other\'s posts, log or counts', async () => {
  const t = await twoAccounts();
  try {
    addItem(t.tenants.get(1).store, { status: 'approved', original_caption: 'admin only', final_caption: 'admin only' });
    addItem(t.tenants.get(t.bolaId).store, { status: 'needs_review', original_caption: 'bola only', final_caption: 'bola only' });
    const a = (await t.call('GET', '/api/items?status=all', { cookie: t.admin })).json;
    const b = (await t.call('GET', '/api/items?status=all', { cookie: t.bola })).json;
    assert.deepEqual(a.map((i) => i.finalCaption), ['admin only']);
    assert.deepEqual(b.map((i) => i.finalCaption), ['bola only']);
    assert.deepEqual((await t.call('GET', '/api/status', { cookie: t.admin })).json.counts, { approved: 1 });
    assert.deepEqual((await t.call('GET', '/api/status', { cookie: t.bola })).json.counts, { needs_review: 1 });
    // an id from the other account does not work
    const bolaItemId = b[0].id;
    await t.call('POST', `/api/items/${bolaItemId}/skip`, { cookie: t.admin });
    assert.equal(t.tenants.get(t.bolaId).store.getItem(bolaItemId).status, 'needs_review', 'the admin\'s call touched only the admin\'s own posts');
  } finally { t.close(); }
});

test('every account runs its own WhatsApp link, in its own folder', async () => {
  const t = await twoAccounts();
  try {
    await t.tenants.startAll(); // what the app does when it starts
    await t.tenants.startAll(); // and doing it again changes nothing
    assert.equal(t.waLog.started.length, 2);
    assert.equal(new Set(t.waLog.started).size, 2, 'two different folders');
    assert.ok(t.waLog.started.some((d) => d.endsWith(path.join('users', String(t.bolaId)))));
  } finally { t.close(); }
});

test('only the admin can manage accounts or update the app', async () => {
  const t = await twoAccounts();
  try {
    assert.equal((await t.call('GET', '/api/users', { cookie: t.bola })).status, 403);
    assert.equal((await t.call('POST', '/api/users', { cookie: t.bola, body: { username: 'carol', password: 'carolpassword' } })).status, 403);
    assert.equal((await t.call('DELETE', '/api/users/1', { cookie: t.bola })).status, 403);
    assert.equal((await t.call('POST', '/api/update/check', { cookie: t.bola })).status, 403);
    assert.equal((await t.call('POST', '/api/update/check', { cookie: t.admin })).status, 200);
    const list = (await t.call('GET', '/api/users', { cookie: t.admin })).json;
    assert.deepEqual(list.map((u) => u.username), ['admin', 'bola']);
  } finally { t.close(); }
});

test('account names: tidy, unique, and passwords have a minimum length', async () => {
  const t = await twoAccounts();
  try {
    const dup = await t.call('POST', '/api/users', { cookie: t.admin, body: { username: 'BOLA', password: 'whatever123' } });
    assert.equal(dup.status, 400);
    assert.match(dup.json.error, /already taken/);
    assert.equal((await t.call('POST', '/api/users', { cookie: t.admin, body: { username: 'a b', password: 'whatever123' } })).status, 400);
    assert.equal((await t.call('POST', '/api/users', { cookie: t.admin, body: { username: 'carol', password: 'short' } })).status, 400);
  } finally { t.close(); }
});

test('the admin needs a password before adding accounts (or they would lock themselves out)', async () => {
  const t = await boot();
  try {
    const r = await t.call('POST', '/api/users', { body: { username: 'bola', password: 'bolapassword' } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /own account a password first/);
  } finally { t.close(); }
});

test('changing a password signs that account out everywhere else', async () => {
  const t = await twoAccounts();
  try {
    const changed = await t.call('PUT', '/api/account/password', { cookie: t.bola, body: { current: 'bolapassword', next: 'bolanewpassword' } });
    assert.equal(changed.status, 200);
    assert.equal((await t.call('GET', '/api/status', { cookie: t.bola })).status, 401, 'the old session is gone');
    assert.equal((await t.call('GET', '/api/status', { cookie: changed.cookie })).status, 200, 'this one carries on');
    const reset = await t.call('PUT', `/api/users/${t.bolaId}/password`, { cookie: t.admin, body: { password: 'resetbyadmin1' } });
    assert.equal(reset.status, 200);
    assert.equal((await t.call('GET', '/api/status', { cookie: changed.cookie })).status, 401);
    assert.equal((await t.call('POST', '/api/login', { body: { username: 'bola', password: 'resetbyadmin1' } })).status, 200);
  } finally { t.close(); }
});

test('removing an account stops it and deletes its data; the admin cannot be removed', async () => {
  const t = await twoAccounts();
  try {
    const folder = path.join(t.dataDir, 'users', String(t.bolaId));
    assert.ok(fs.existsSync(folder));
    assert.equal((await t.call('DELETE', '/api/users/1', { cookie: t.admin })).status, 400);
    assert.equal((await t.call('DELETE', `/api/users/${t.bolaId}`, { cookie: t.admin })).status, 200);
    assert.equal(fs.existsSync(folder), false);
    assert.ok(t.waLog.stopped.some((d) => d.endsWith(String(t.bolaId))));
    assert.equal((await t.call('GET', '/api/status', { cookie: t.bola })).status, 401);
    assert.equal((await t.call('POST', '/api/login', { body: { username: 'bola', password: 'bolapassword' } })).status, 401);
  } finally { t.close(); }
});

test('wrong passwords are slowed down after ten tries', async () => {
  const t = await boot({ adminPassword: 'adminpassword' });
  try {
    let last;
    for (let i = 0; i < 11; i++) last = await t.call('POST', '/api/login', { body: { username: 'admin', password: `wrong${i}` } });
    assert.equal(last.status, 429);
    assert.equal((await t.call('POST', '/api/login', { body: { username: 'admin', password: 'adminpassword' } })).status, 429, 'even the right one waits');
  } finally { t.close(); }
});

test('a request that comes from another website is refused', async () => {
  const t = await twoAccounts();
  try {
    const r = await t.call('POST', '/api/run-now', { cookie: t.admin, headers: { origin: 'https://evil.example' } });
    assert.equal(r.status, 403);
  } finally { t.close(); }
});

test('data from before accounts existed stays with the admin, nothing is moved', async () => {
  const t = await boot({ legacy: true, adminPassword: 'adminpassword' });
  try {
    const admin = (await t.call('POST', '/api/login', { body: { username: 'admin', password: 'adminpassword' } })).cookie;
    const items = (await t.call('GET', '/api/items?status=all', { cookie: admin })).json;
    assert.deepEqual(items.map((i) => i.originalCaption), ['old post from before accounts']);
    assert.ok(fs.existsSync(path.join(t.dataDir, 'poster.json')), 'still where it was');
    const made = await t.call('POST', '/api/users', { cookie: admin, body: { username: 'bola', password: 'bolapassword' } });
    const bola = (await t.call('POST', '/api/login', { body: { username: 'bola', password: 'bolapassword' } })).cookie;
    assert.deepEqual((await t.call('GET', '/api/items?status=all', { cookie: bola })).json, [], 'a new account starts empty');
    assert.ok(made.json.user.id);
  } finally { t.close(); }
});

test('the health page answers without signing in and says nothing private', async () => {
  const t = await boot({ adminPassword: 'adminpassword' });
  try {
    const h = await t.call('GET', '/health');
    assert.equal(h.status, 200);
    assert.deepEqual(Object.keys(h.json).sort(), ['accounts', 'ok', 'uptimeSeconds', 'version']);
  } finally { t.close(); }
});

test('sessions: a tampered or expired cookie is not accepted', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  let clock = 1_000_000;
  const users = createUsers({ dataDir, now: () => clock });
  const admin = users.ensureAdmin({ password: 'adminpassword' });
  const token = users.makeToken(admin.id);
  assert.equal(users.readToken(token).username, 'admin');
  assert.equal(users.readToken(`${token}x`), null);
  assert.equal(users.readToken(`${token.split('.')[0]}.AAAA`), null);
  assert.equal(users.readToken(''), null);
  clock += 31 * 86_400_000;
  assert.equal(users.readToken(token), null, 'older than 30 days');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('passwords are never stored as typed', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const users = createUsers({ dataDir });
  users.ensureAdmin({ password: 'my secret password' });
  const raw = fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8');
  assert.doesNotMatch(raw, /my secret password/);
  assert.equal(users.verify('admin', 'my secret password').username, 'admin');
  assert.equal(users.verify('admin', 'my secret passwor'), null);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
