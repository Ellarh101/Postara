// Accounts: who may use the app, their passwords and their sign-in sessions.
// Every account has its own WhatsApp link, settings, posts and AI key (see tenants.js).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MIN_PASSWORD = 8;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const SESSION_DAYS = 30;

const scrypt = (password, salt) => crypto.scryptSync(String(password), salt, 32);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: scrypt(password, salt).toString('hex') };
}

function checkPassword(password, rec) {
  const expected = Buffer.from(rec.hash, 'hex');
  const actual = scrypt(password, rec.salt);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function cleanUsername(name) {
  return String(name ?? '').trim().toLowerCase();
}

export function createUsers({ dataDir, now = () => Date.now() }) {
  const file = path.join(dataDir, 'users.json');
  const secretFile = path.join(dataDir, 'secret.key');
  fs.mkdirSync(dataDir, { recursive: true });

  let data = { nextId: 1, users: [] };
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`The accounts file (${file}) is damaged: ${e.message}. Restore a copy of it, or delete it to start the accounts again.`);
    }
  }

  let secret;
  if (fs.existsSync(secretFile)) secret = fs.readFileSync(secretFile, 'utf8').trim();
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  }

  function save() {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  const view = (u) => u && ({ id: u.id, username: u.username, role: u.role, hasPassword: !!u.pass, created: u.created });
  const find = (id) => data.users.find((u) => u.id === Number(id));

  function validatePassword(password) {
    if (String(password ?? '').length < MIN_PASSWORD) throw new Error(`The password must be at least ${MIN_PASSWORD} characters.`);
  }

  const api = {
    count: () => data.users.length,
    list: () => data.users.map(view),
    get: (id) => view(find(id)),
    dirOf: (id) => find(id)?.dir,
    byUsername: (name) => view(data.users.find((u) => u.username === cleanUsername(name))),
    hasPassword: (id) => !!find(id)?.pass,
    admins: () => data.users.filter((u) => u.role === 'admin').map(view),

    // The very first start: make the admin account. `legacy` = this app already has data from before accounts existed;
    // the admin keeps working on that data in place (nothing is moved or copied).
    ensureAdmin({ password = '', legacy = false } = {}) {
      if (data.users.length) return view(data.users.find((u) => u.role === 'admin') || data.users[0]);
      return api.create({ username: 'admin', password: password || null, role: 'admin', dir: legacy ? '' : null });
    },

    create({ username, password, role = 'user', dir = null }) {
      const name = cleanUsername(username);
      if (!USERNAME_RE.test(name)) throw new Error('The username must be 3 to 30 letters, numbers, dots, dashes or underscores, starting with a letter or number.');
      if (data.users.some((u) => u.username === name)) throw new Error('That username is already taken.');
      if (password !== null) validatePassword(password);
      const id = data.nextId++;
      const user = { id, username: name, role: role === 'admin' ? 'admin' : 'user', pass: password === null ? null : hashPassword(password), sv: 1, dir: dir ?? `users/${id}`, created: now() };
      data.users.push(user);
      save();
      return view(user);
    },

    // Returns the account when the name and password are right, otherwise null. Takes the same time either way.
    verify(username, password) {
      const user = data.users.find((u) => u.username === cleanUsername(username));
      if (!user || !user.pass) {
        scrypt(String(password), 'unknown-user');
        return null;
      }
      return checkPassword(password, user.pass) ? view(user) : null;
    },

    // Signing out everywhere else: every password change starts a new session version.
    setPassword(id, password) {
      const user = find(id);
      if (!user) throw new Error('No such user.');
      validatePassword(password);
      user.pass = hashPassword(password);
      user.sv += 1;
      save();
      return view(user);
    },

    remove(id) {
      const user = find(id);
      if (!user) throw new Error('No such user.');
      if (user.role === 'admin') throw new Error('The admin account cannot be removed.');
      data.users = data.users.filter((u) => u !== user);
      save();
      return { ...view(user), dir: user.dir };
    },

    // ---- sessions: a signed cookie, valid for 30 days or until the password changes ----
    makeToken(id) {
      const user = find(id);
      const body = Buffer.from(JSON.stringify({ id: user.id, sv: user.sv, exp: now() + SESSION_DAYS * 86_400_000 })).toString('base64url');
      const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
      return `${body}.${sig}`;
    },

    readToken(token) {
      const [body, sig] = String(token || '').split('.');
      if (!body || !sig) return null;
      const good = crypto.createHmac('sha256', secret).update(body).digest('base64url');
      const a = Buffer.from(sig);
      const b = Buffer.from(good);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
      try {
        const { id, sv, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
        const user = find(id);
        return user && user.sv === sv && exp > now() ? view(user) : null;
      } catch {
        return null;
      }
    },
  };
  return api;
}
