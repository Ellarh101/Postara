// Connects to WhatsApp (as a linked device, like WhatsApp Web), listens to your vendor chats
// and sends posts to your groups and status.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  WAMessageStatus,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  getContentType,
  jidNormalizedUser,
  normalizeMessageContent,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { ConnectionError } from './errors.js';
import { createGrouper } from './grouping.js';

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new ConnectionError('Timed out waiting for WhatsApp')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

const STATUS_JID = 'status@broadcast';
const isPn = (j) => typeof j === 'string' && j.endsWith('@s.whatsapp.net');
const isLid = (j) => typeof j === 'string' && j.endsWith('@lid');

export function createWhatsApp({ config, store, getSettings }) {
  const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });
  const state = { connection: 'starting', qr: null, me: null, meLid: null };
  let sock = null;
  let retry = 0;
  let reconnectTimer = null;
  let groupTimer = null;

  const waiters = new Map();     // message id -> function that receives WhatsApp's answer
  const sentCache = new Map();   // recently sent messages, so WhatsApp can ask us to resend them
  const grouper = createGrouper({ store });
  let queue = Promise.resolve(); // incoming messages are handled one at a time

  const isOpen = () => !!sock && state.connection === 'open';

  function setConnection(next) {
    if (state.connection !== next) {
      state.connection = next;
      store.log('info', `WhatsApp connection: ${next}`);
    }
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    const delay = Math.min(30_000, 2_000 * 2 ** Math.min(retry, 4));
    retry += 1;
    reconnectTimer = setTimeout(() => connect().catch(onConnectError), delay);
  }

  function onConnectError(e) {
    store.log('error', `Could not start WhatsApp connection: ${e.message}`);
    setConnection('reconnecting');
    scheduleReconnect();
  }

  // ---------- contacts and chats ----------

  function addContacts(list) {
    const jids = [];
    for (const c of list || []) {
      for (const j of [c.id, c.jid, c.lid, c.phoneNumber]) if (isPn(j) || isLid(j)) jids.push(j);
      const name = c.name || c.notify || c.verifiedName;
      if (name && (isPn(c.id) || isLid(c.id))) store.upsertChat(c.id, name, 'person');
    }
    if (jids.length) store.addContacts(jids);
  }

  async function refreshGroups() {
    if (!isOpen()) return;
    try {
      const groups = await sock.groupFetchAllParticipating();
      for (const g of Object.values(groups)) store.upsertChat(g.id, g.subject, 'group');
    } catch (e) {
      store.log('warn', `Could not refresh the group list: ${e.message}`);
    }
  }

  // ---------- pictures ----------

  // Small JPEG used for the AI check and the preview in the app.
  // Uses sharp if it is installed, otherwise jimp (pure JavaScript, works on phones), otherwise WhatsApp's own tiny preview.
  async function makeThumbFile(buffer, fallback, isVideo, base) {
    let out = null;
    if (!isVideo) {
      try {
        const sharp = (await import('sharp')).default;
        out = await sharp(buffer).rotate().resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
      } catch {
        try {
          const { Jimp } = await import('jimp');
          const img = await Jimp.read(buffer);
          if (img.width > 768) img.resize({ w: 768 });
          out = await img.getBuffer('image/jpeg', { quality: 70 });
        } catch { /* use the WhatsApp preview below */ }
      }
    }
    if (!out && fallback && fallback.length) out = Buffer.from(fallback);
    if (!out) return null;
    const file = `${base}.thumb.jpg`;
    fs.writeFileSync(file, out);
    return file;
  }

  // ---------- reading vendor posts ----------

  function matchVendor(m) {
    const ids = [m.key.remoteJid, m.key.remoteJidAlt].filter(Boolean);
    return getSettings().vendorChats.find((v) => ids.includes(v.jid));
  }

  async function handleMessage(m) {
    if (!m.message || m.key.fromMe) return;
    const jid = m.key.remoteJid;
    if (!jid || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;

    if (jid.endsWith('@g.us')) store.upsertChat(jid, null, 'group');
    else if (isPn(jid) || isLid(jid)) {
      store.upsertChat(jid, m.pushName || null, 'person');
      store.addContacts([jid]);
      if (m.key.remoteJidAlt) {
        store.upsertChat(m.key.remoteJidAlt, m.pushName || null, 'person');
        store.addContacts([m.key.remoteJidAlt]);
      }
    }

    const vendor = matchVendor(m);
    if (!vendor) return;

    const settings = getSettings();
    const sentAt = Number(m.messageTimestamp) * 1000 || Date.now();
    if (Date.now() - sentAt > settings.recentHours * 3_600_000) return; // too old: the vendor posted it a while ago

    const content = normalizeMessageContent(m.message);
    const type = getContentType(content);
    const sender = m.key.participant || jid;
    const settleMs = settings.bundleWaitSeconds * 1000;
    const now = Date.now();
    const key = `${jid}:${m.key.id}`;

    if (type === 'conversation' || type === 'extendedTextMessage') {
      const text = (content.conversation || content.extendedTextMessage?.text || '').trim();
      const r = grouper.text({ jid, sender, text, sentAt, now, settleMs });
      if (r.action === 'late') store.log('info', `Caption added to post #${r.id} (it arrived after the pictures)`);
      return;
    }
    if (type !== 'imageMessage' && type !== 'videoMessage') return;
    if (store.hasMessage(key)) return;

    const media = content[type];
    const isVideo = type === 'videoMessage';
    const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
    const hash = crypto.createHash('sha1').update(buffer).digest('hex');
    if (store.hasHash(hash)) {
      store.log('info', `Ignored a repeat picture from ${vendor.name}`);
      return;
    }

    const mime = media.mimetype || (isVideo ? 'video/mp4' : 'image/jpeg');
    const ext = isVideo ? 'mp4' : mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const base = path.join(config.mediaDir, `${now}-${hash.slice(0, 8)}`);
    const file = `${base}.${ext}`;
    fs.writeFileSync(file, buffer);
    const entry = {
      path: file,
      type: isVideo ? 'video' : 'image',
      mimetype: mime,
      hash,
      thumb_path: await makeThumbFile(buffer, media.jpegThumbnail, isVideo, base),
    };
    const caption = (media.caption || '').trim();

    const r = grouper.picture({ jid, sender, vendor, entry, key, caption, sentAt, now, settleMs });
    if (r.action === 'created') store.log('info', `New post #${r.id} from ${vendor.name}`);
  }

  // ---------- connection ----------

  async function connect() {
    clearTimeout(reconnectTimer);
    const { state: auth, saveCreds } = await useMultiFileAuthState(config.authDir);
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      /* offline: Baileys falls back to its built-in version */
    }
    const s = makeWASocket({
      ...(version ? { version } : {}),
      auth,
      logger,
      browser: Browsers.macOS('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      // WhatsApp sometimes asks us to resend a message a recipient could not open
      getMessage: async (key) => sentCache.get(key.id),
    });
    sock = s;

    s.ev.on('creds.update', saveCreds);

    s.ev.on('connection.update', async (u) => {
      if (s !== sock) return;
      if (u.qr) {
        state.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 280 });
        setConnection('qr');
      }
      if (u.connection === 'open') {
        retry = 0;
        state.qr = null;
        state.me = s.user?.id ? jidNormalizedUser(s.user.id) : null;
        state.meLid = s.user?.lid ? jidNormalizedUser(s.user.lid) : null;
        setConnection('open');
        refreshGroups();
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        state.qr = null;
        if (code === DisconnectReason.loggedOut) {
          setConnection('logged_out');
          return;
        }
        if (code === DisconnectReason.connectionReplaced) {
          setConnection('replaced');
          store.log('warn', 'Another device or program took over this WhatsApp link. Open the app and press "Link again" to reconnect.');
          return;
        }
        setConnection('reconnecting');
        scheduleReconnect();
      }
    });

    s.ev.on('messages.upsert', ({ messages, type }) => {
      if (s !== sock || type !== 'notify') return;
      for (const m of messages) {
        queue = queue.then(() => handleMessage(m)).catch((e) => store.log('error', `Could not read a message: ${e.message}`));
      }
    });

    // WhatsApp's answer to messages we sent: accepted, or rejected with an error code
    s.ev.on('messages.update', (updates) => {
      for (const u of updates) {
        const wait = waiters.get(u.key?.id);
        if (!wait) continue;
        const status = u.update?.status;
        if (status === WAMessageStatus.ERROR) wait({ ok: false, code: u.update?.messageStubParameters?.[0] || 'unknown' });
        else if (typeof status === 'number' && status >= WAMessageStatus.SERVER_ACK) wait({ ok: true });
      }
    });

    s.ev.on('contacts.upsert', (list) => addContacts(list));
    s.ev.on('contacts.update', (list) => addContacts(list));
    s.ev.on('messaging-history.set', ({ contacts }) => addContacts(contacts));
    s.ev.on('groups.upsert', (groups) => {
      for (const g of groups) store.upsertChat(g.id, g.subject, 'group');
    });
    s.ev.on('groups.update', (groups) => {
      for (const g of groups) if (g.id && g.subject) store.upsertChat(g.id, g.subject, 'group');
    });
  }

  // ---------- sending ----------

  // Sends one message and waits (briefly) to hear whether WhatsApp accepted or rejected it.
  async function sendVerified(jid, content, options = {}) {
    const id = generateMessageIDV2(sock.user?.id);
    const answer = new Promise((resolve) => {
      const timer = setTimeout(() => { waiters.delete(id); resolve({ unconfirmed: true }); }, 5_000); // errors come back within seconds
      waiters.set(id, (r) => { clearTimeout(timer); waiters.delete(id); resolve(r); });
    });
    try {
      const sent = await withTimeout(sock.sendMessage(jid, content, { ...options, messageId: id }), 180_000);
      if (sent?.message) {
        sentCache.set(id, sent.message);
        if (sentCache.size > 500) sentCache.delete(sentCache.keys().next().value);
      }
    } catch (e) {
      waiters.delete(id);
      throw e;
    }
    return answer;
  }

  // Who can see the status. Newer WhatsApp accounts need everybody listed by their LID, older ones by phone number.
  async function statusAudience(mode) {
    const known = store.listContacts();
    const pns = known.filter(isPn);
    const lids = known.filter(isLid);
    const out = new Set();
    const mapping = sock.signalRepository?.lidMapping;
    if (mode === 'lid') {
      lids.forEach((j) => out.add(j));
      if (state.meLid) out.add(state.meLid);
      if (pns.length && mapping) {
        const pairs = await mapping.getLIDsForPNs(pns).catch(() => null);
        for (const p of pairs || []) if (p?.lid) out.add(jidNormalizedUser(p.lid));
      }
    } else {
      pns.forEach((j) => out.add(j));
      if (state.me) out.add(state.me);
      if (lids.length && mapping) {
        const pairs = await mapping.getPNsForLIDs(lids).catch(() => null);
        for (const p of pairs || []) if (p?.pn) out.add(jidNormalizedUser(p.pn));
      }
    }
    return [...out];
  }

  async function postStatus(content) {
    const preferred = store.getKv('statusMode') || (state.meLid ? 'lid' : 'pn');
    const order = preferred === 'lid' ? ['lid', 'pn'] : ['pn', 'lid'];
    const problems = [];
    for (const mode of order) {
      const audience = await statusAudience(mode);
      if (audience.length < 2) {
        problems.push(`not enough contacts known yet (${mode} list)`);
        continue;
      }
      const r = await sendVerified(STATUS_JID, content, { statusJidList: audience, backgroundColor: '#240002', broadcast: true });
      if (r.ok === false) {
        problems.push(`WhatsApp rejected it (error ${r.code}, ${mode} list)`);
        store.log('warn', `Status rejected by WhatsApp: error ${r.code} using the ${mode} contact list. Trying the other way.`);
        continue;
      }
      store.setKv('statusMode', mode);
      store.log('info', `Status accepted by WhatsApp (${mode} list, ${audience.length} people${r.unconfirmed ? ', no confirmation yet' : ''})`);
      return { mode, people: audience.length, confirmed: !r.unconfirmed };
    }
    throw new Error(`Status was not accepted. ${problems.join('; ')}.`);
  }

  async function sendFile(item, index, target, caption) {
    if (!isOpen()) throw new ConnectionError('Not connected to WhatsApp');
    const f = item.files[index];
    const content = f.type === 'video'
      ? { video: { url: f.path }, caption, mimetype: f.mimetype || 'video/mp4' }
      : { image: { url: f.path }, caption };
    if (target === 'status') {
      await postStatus(content);
      return;
    }
    const r = await sendVerified(target, content);
    if (r.ok === false) throw new Error(`WhatsApp rejected the message (error ${r.code})`);
  }

  async function sendText(jid, text) {
    if (!isOpen()) throw new ConnectionError('Not connected to WhatsApp');
    const r = await sendVerified(jid, { text });
    if (r.ok === false) throw new Error(`WhatsApp rejected the message (error ${r.code})`);
  }

  async function sendTestStatus() {
    if (!isOpen()) throw new ConnectionError('Not connected to WhatsApp');
    return postStatus({ text: '✅ Test status from my posting app' });
  }

  // Link by phone number instead of the QR code (needed when you only have one phone).
  async function requestPairing(phoneDigits) {
    if (!sock || state.connection !== 'qr') throw new Error('The link screen is not ready yet. Wait a few seconds and try again.');
    const code = await sock.requestPairingCode(phoneDigits);
    return String(code).match(/.{1,4}/g).join('-');
  }

  async function relink() {
    clearTimeout(reconnectTimer);
    const old = sock;
    sock = null;
    try { await old?.logout(); } catch { /* already logged out */ }
    try { old?.end(undefined); } catch { /* ignore */ }
    fs.rmSync(config.authDir, { recursive: true, force: true });
    fs.mkdirSync(config.authDir, { recursive: true });
    state.qr = null;
    state.me = null;
    state.meLid = null;
    retry = 0;
    setConnection('starting');
    await connect();
  }

  function start() {
    connect().catch(onConnectError);
    groupTimer = setInterval(refreshGroups, 30 * 60_000);
  }

  function stop() {
    clearTimeout(reconnectTimer);
    clearInterval(groupTimer);
    try { sock?.end(undefined); } catch { /* ignore */ }
  }

  return {
    start,
    stop,
    relink,
    requestPairing,
    refreshGroups,
    isOpen,
    sendFile,
    sendText,
    sendTestStatus,
    getState: () => ({ connection: state.connection, qr: state.qr, me: state.me }),
  };
}
