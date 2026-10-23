// The control panel you open in your browser: sign-in, accounts, and each account's own app.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApi } from './api.js';
import { MIN_PASSWORD } from './users.js';

const COOKIE = 'poster_session';
const DAY = 86_400_000;

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return '';
}

export function createServer({ config, users, tenants, updater, now = () => Date.now() }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(express.json({ limit: '200kb' }));

  // ---------- the page, its icons and the install manifest (public: nothing private in them) ----------
  const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  app.get(['/', '/index.html'], (req, res) => {
    const html = fs.readFileSync(path.join(config.publicDir, 'index.html'), 'utf8').replaceAll('__BRAND__', escapeHtml(config.brand)).replaceAll('__VERSION__', config.version);
    res.type('html').send(html);
  });
  app.get('/manifest.webmanifest', (req, res) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(config.publicDir, 'manifest.webmanifest'), 'utf8'));
    manifest.name = config.brand;
    manifest.short_name = config.brand.slice(0, 12);
    // The version on the icon addresses makes the phone fetch a changed icon instead of keeping the old picture.
    manifest.icons = (manifest.icons || []).map((i) => ({ ...i, src: `${i.src}?v=${config.version}` }));
    res.type('application/manifest+json').send(JSON.stringify(manifest));
  });
  // For uptime checks and "is it running?" tests. Says nothing private.
  app.get('/health', (req, res) => res.json({ ok: true, version: config.version, uptimeSeconds: Math.round(process.uptime()), accounts: users.count() }));
  app.use(express.static(config.publicDir));

  // ---------- who is asking ----------
  // With one account and no password (the way a phone-only setup works) there is nothing to sign in to.
  const openMode = () => {
    const all = users.list();
    return all.length === 1 && !all[0].hasPassword;
  };

  app.use('/api', (req, res, next) => {
    req.user = users.readToken(readCookie(req, COOKIE));
    req.openMode = false;
    if (!req.user && openMode()) {
      req.user = users.list()[0];
      req.openMode = true;
    }
    // A browser on another website must not be able to act for a signed-in user.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        let host = '';
        try { host = new URL(origin).host; } catch { /* bad origin */ }
        if (host !== req.headers.host) return res.status(403).json({ error: 'This request came from another website.' });
      }
    }
    next();
  });

  const setCookie = (req, res, userId) => {
    res.cookie(COOKIE, users.makeToken(userId), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 30 * DAY, path: '/' });
  };

  app.get('/api/session', (req, res) => res.json({ user: req.user || null, open: req.openMode, version: config.version }));

  // Too many wrong passwords from one place: wait a while.
  const attempts = new Map();
  app.post('/api/login', (req, res) => {
    const key = req.ip || 'unknown';
    const entry = attempts.get(key);
    if (entry && entry.until > now() && entry.count >= 10) return res.status(429).json({ error: 'Too many tries. Wait ten minutes and try again.' });
    const user = users.verify(req.body?.username, req.body?.password);
    if (!user) {
      const fresh = entry && entry.until > now() ? entry : { count: 0, until: now() + 10 * 60_000 };
      fresh.count += 1;
      attempts.set(key, fresh);
      return res.status(401).json({ error: 'That username or password is not right.' });
    }
    attempts.delete(key);
    setCookie(req, res, user.id);
    res.json({ user });
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // Everything below needs an account.
  app.use('/api', (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please sign in.' })));

  // ---------- your own account ----------
  app.put('/api/account/password', (req, res) => {
    const { current, next } = req.body || {};
    if (users.hasPassword(req.user.id) && !users.verify(req.user.username, current)) return res.status(400).json({ error: 'Your current password is not right.' });
    try {
      users.setPassword(req.user.id, next);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    setCookie(req, res, req.user.id); // this device stays signed in; every other one is signed out
    res.json({ ok: true });
  });

  // ---------- the admin looks after the other accounts ----------
  const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Only the admin can do that.' }));

  app.get('/api/users', adminOnly, (req, res) => {
    res.json(users.list().map((u) => ({ ...u, whatsapp: tenants.peek(u.id)?.wa.getState().connection || 'off' })));
  });

  app.post('/api/users', adminOnly, (req, res) => {
    // Once there are two accounts everyone must sign in, so the admin needs a password first or would lock themselves out.
    if (!users.hasPassword(req.user.id)) return res.status(400).json({ error: `Give your own account a password first (Settings, Your account, at least ${MIN_PASSWORD} characters).` });
    try {
      const user = users.create({ username: req.body?.username, password: req.body?.password, role: 'user' });
      tenants.get(user.id);
      res.json({ user });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/users/:id/password', adminOnly, (req, res) => {
    try {
      res.json({ user: users.setPassword(Number(req.params.id), req.body?.password) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/users/:id', adminOnly, (req, res) => {
    try {
      const gone = users.remove(Number(req.params.id));
      tenants.destroy(gone.id, gone.dir);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ---------- everything else is that account's own app ----------
  const apis = new Map();
  app.use('/api', (req, res, next) => {
    const tenant = tenants.get(req.user.id);
    if (!tenant) return res.status(401).json({ error: 'Please sign in.' });
    let router = apis.get(tenant);
    if (!router) {
      router = createApi({ ...tenant, updater, isAdmin: () => tenant.user.role === 'admin' });
      apis.set(tenant, router);
    }
    router(req, res, next);
  });

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(`Web page error: ${err.message}`);
    res.status(500).json({ error: err.message });
  });

  return app;
}
