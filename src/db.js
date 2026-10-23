// Plain JSON-file storage. No database program and no native add-ons, so it installs
// the same on a computer, a server and an Android phone.
import fs from 'node:fs';
import { findPrices } from './filters.js';

// One "item" is one vendor post: one or more pictures/videos that share a caption.
const ITEM_DEFAULTS = {
  vendor_jid: null, source_jid: null, sender_jid: null, msg_keys: [], files: [],
  original_caption: '', final_caption: '', price_lines: [], status: 'incoming', note: '',
  created_at: 0, posted_at: 0, last_media_at: 0, process_after: 0, process_attempts: 0,
  first_sent_day: null, sent_at: null, no_expire: false, category: '', closed: false,
};

// When a post last mattered: the vendor posting it, or the moment we sent it.
const activityAt = (i) => Math.max(i.posted_at || i.created_at || 0, i.sent_at || 0);

export function createStore(file = null) {
  let data = { kv: {}, chats: {}, contacts: {}, items: [], sends: {}, log: [], nextId: 1 };

  if (file && fs.existsSync(file)) {
    try {
      data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      fs.renameSync(file, `${file}.broken-${Date.now()}`); // keep the damaged file, start fresh
    }
  }

  // Posts saved by an older version had one picture each: bring them into the new shape.
  for (const i of data.items) {
    if (!Array.isArray(i.files)) {
      i.files = i.media_path
        ? [{ path: i.media_path, type: i.media_type || 'image', mimetype: i.mimetype || null, hash: i.media_hash || null, thumb_path: i.thumb_path || null }]
        : [];
    }
    if (!Array.isArray(i.msg_keys)) i.msg_keys = i.msg_key ? [i.msg_key] : [];
    if (!Array.isArray(i.price_lines)) {
      const v = String(i.vendor_prices || '').split(',').filter(Boolean).map(Number);
      const f = String(i.final_prices || '').split(',').filter(Boolean).map(Number);
      i.price_lines = v.map((amount, k) => ({ label: '', vendor: amount, final: f[k] ?? amount }));
    }
    // Posts prepared by the old "basic mode" kept the vendor's own wording: have the AI write them again.
    if (['approved', 'needs_review'].includes(i.status) && !i.first_sent_day && /basic mode/i.test(i.note || '')) {
      i.status = 'incoming';
      i.process_after = 0;
      i.process_attempts = 0;
      i.final_caption = '';
      i.note = '';
    }
    if (typeof i.category !== 'string') i.category = ''; // posts from before categories existed
    if (!i.vendor_jid) i.vendor_jid = i.source_jid || null;
    if (!i.last_media_at) i.last_media_at = i.created_at || 0;
    if (!i.posted_at) i.posted_at = i.created_at || 0;
  }

  let timer = null;
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!file) return;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }
  function save() {
    if (!file || timer) return;
    timer = setTimeout(flush, 400);
  }

  const find = (id) => data.items.find((i) => i.id === id);
  const copy = (i) => ({ ...i, files: [...i.files], msg_keys: [...i.msg_keys], price_lines: i.price_lines.map((p) => ({ ...p })) });
  const sendKey = (id, target) => `${id}|${target}`;

  return {
    flush,

    getKv: (key) => (key in data.kv ? data.kv[key] : null),
    setKv(key, value) {
      data.kv[key] = value;
      save();
    },

    upsertChat(jid, name, kind) {
      const prev = data.chats[jid];
      data.chats[jid] = { jid, name: name || prev?.name || null, kind, last_seen: Date.now() };
      save();
    },
    listChats() {
      return Object.values(data.chats).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    },
    addContacts(jids) {
      for (const j of jids) data.contacts[j] = 1;
      save();
    },
    listContacts: () => Object.keys(data.contacts),

    insertItem(item) {
      const row = { ...ITEM_DEFAULTS, ...item, id: data.nextId++ };
      data.items.push(row);
      save();
      return row.id;
    },
    hasMessage: (key) => data.items.some((i) => i.msg_keys.includes(key)),
    hasHash: (hash) => data.items.some((i) => i.files.some((f) => f.hash === hash)),
    getItem(id) {
      const i = find(id);
      return i ? copy(i) : null;
    },
    // sinceTs: only posts from after this time (the vendor posted it, or it was sent, since then).
    listItems(status, limit = 200, sinceTs = 0) {
      const rows = data.items.filter((i) => (!status || status === 'all' || i.status === status) && activityAt(i) >= sinceTs);
      return rows.slice(-limit).reverse().map(copy);
    },
    updateItem(id, fields) {
      const i = find(id);
      if (!i) return;
      for (const [k, v] of Object.entries(fields)) if (k !== 'id') i[k] = v;
      save();
    },
    // Another picture from the same vendor post: add it to the item and wait a little longer for more.
    // sentAt: when the vendor sent the picture (grouping goes by the vendor's clock, not by when we heard about it).
    addFile(id, file, msgKey, caption, processAfter, sentAt = Date.now()) {
      const i = find(id);
      if (!i) return;
      i.files.push(file);
      i.msg_keys.push(msgKey);
      i.last_media_at = Math.max(i.last_media_at || 0, sentAt);
      i.process_after = processAfter;
      if (caption) i.original_caption = i.original_caption ? `${i.original_caption}\n${caption}` : caption;
      save();
    },
    // close: the text had the price in it, so this set is finished and later pictures start a new post.
    appendCaption(id, text, processAfter, close = false) {
      const i = find(id);
      if (!i) return;
      i.original_caption = i.original_caption ? `${i.original_caption}\n${text}` : text;
      i.process_after = Math.max(i.process_after, processAfter);
      if (close) i.closed = true;
      save();
    },
    // The set a new picture or text may still join: pictures sent a moment ago that no price message has closed yet.
    findOpenBundle(sourceJid, senderJid, sinceTs) {
      const rows = data.items.filter((i) => i.status === 'incoming' && !i.closed && i.source_jid === sourceJid
        && (i.sender_jid || '') === (senderJid || '') && i.last_media_at >= sinceTs);
      const i = rows[rows.length - 1];
      return i ? copy(i) : null;
    },
    // A caption or price typed a while after the pictures: the newest set from this vendor that can still take it.
    // Looking back from the newest set: one that already has its price (or was closed by it) ends the search,
    // because a text that comes after a finished set belongs to what comes next, not to an older set.
    findLateCaptionTarget(sourceJid, senderJid, sinceTs, wantsPrice = false) {
      const mine = data.items.filter((i) => i.source_jid === sourceJid && (i.sender_jid || '') === (senderJid || '')
        && (i.posted_at || i.created_at) >= sinceTs);
      for (let k = mine.length - 1; k >= 0; k -= 1) {
        const i = mine[k];
        if (i.closed || findPrices(i.original_caption).length) return null;
        if (!['incoming', 'needs_review', 'approved'].includes(i.status) || i.first_sent_day) continue;
        if (!i.original_caption || wantsPrice) return copy(i);
      }
      return null;
    },
    dueIncoming(now) {
      return data.items.filter((i) => i.status === 'incoming' && i.process_after <= now).slice(0, 20).map((i) => i.id);
    },

    sends: (itemId) => Object.values(data.sends).filter((s) => s.item_id === itemId).map((s) => ({ ...s })),
    recordSend(itemId, target, status, attempts, error, ts, progress = 0) {
      data.sends[sendKey(itemId, target)] = { item_id: itemId, target, status, attempts, error: error || '', sent_at: ts || null, progress };
      save();
    },
    sentCountForDay: (day) => data.items.filter((i) => i.first_sent_day === day).length,

    // Items already started are finished first, then new ones until the daily limit is reached.
    // opts.category: only this kind of item ('other' = none of the seller's categories).
    // opts.fallbackAny: if that kind has nothing ready, take any other item instead.
    // opts.ignoreLimit: a post-a-category-now run is not held back by the daily number.
    nextToSend(day, limit, order, opts = {}) {
      const { category = null, fallbackAny = false, ignoreLimit = false } = opts;
      const approved = data.items.filter((i) => i.status === 'approved');
      const partial = approved.find((i) => i.first_sent_day);
      if (partial) return { ...partial };
      if (!ignoreLimit && data.items.filter((i) => i.first_sent_day === day).length >= limit) return null;
      let fresh = approved.filter((i) => !i.first_sent_day);
      if (category) {
        const wanted = category === 'other' ? '' : category;
        const inKind = fresh.filter((i) => (i.category || '') === wanted);
        fresh = inKind.length || !fallbackAny ? inKind : fresh;
      }
      const pick = order === 'newest' ? fresh[fresh.length - 1] : fresh[0];
      return pick ? { ...pick } : null;
    },

    // How many posts are ready to go, per category ('' = none of the seller's categories).
    readyByCategory() {
      const out = {};
      for (const i of data.items) {
        if (i.status === 'approved' && !i.first_sent_day) out[i.category || ''] = (out[i.category || ''] || 0) + 1;
      }
      return out;
    },

    // Gives a category to waiting posts that have none (or one the seller no longer uses).
    // guess(item) returns a category name or '' when it cannot tell.
    fillCategories(categories, guess) {
      let n = 0;
      for (const i of data.items) {
        if (!['incoming', 'needs_review', 'approved'].includes(i.status) || i.first_sent_day) continue;
        if (i.category && categories.includes(i.category)) continue;
        const c = guess(i);
        if (c && c !== i.category) { i.category = c; n += 1; }
      }
      if (n) save();
      return n;
    },

    // Vendor posts that are too old to post any more.
    expireStale(cutoffTs, note) {
      let n = 0;
      for (const i of data.items) {
        if (['incoming', 'needs_review', 'approved'].includes(i.status) && !i.first_sent_day && !i.no_expire
          && (i.posted_at || i.created_at) < cutoffTs) {
          i.status = 'skipped';
          i.note = note;
          n += 1;
        }
      }
      if (n) save();
      return n;
    },

    counts(sinceTs = 0) {
      const out = {};
      for (const i of data.items) if (activityAt(i) >= sinceTs) out[i.status] = (out[i.status] || 0) + 1;
      return out;
    },

    thumbBase64(thumbPath) {
      try {
        return thumbPath && fs.existsSync(thumbPath) ? fs.readFileSync(thumbPath).toString('base64') : null;
      } catch {
        return null;
      }
    },

    // Deletes every post (and its pictures) older than the cutoff, whatever its state, so only the last day is kept.
    // A post that is half way through being sent is left to finish.
    dropOlderThan(cutoffTs) {
      const gone = data.items.filter((i) => activityAt(i) < cutoffTs && !(i.status === 'approved' && i.first_sent_day));
      for (const i of gone) {
        for (const f of i.files) for (const path of [f.path, f.thumb_path]) if (path) fs.rmSync(path, { force: true });
        for (const k of Object.keys(data.sends)) if (data.sends[k].item_id === i.id) delete data.sends[k];
      }
      if (gone.length) {
        const ids = new Set(gone.map((i) => i.id));
        data.items = data.items.filter((i) => !ids.has(i.id));
        save();
      }
      return gone.length;
    },

    // Remove finished posts (and their pictures) after a while so storage stays small.
    prune(days) {
      const cutoff = Date.now() - days * 86_400_000;
      const gone = data.items.filter((i) => ['sent', 'skipped', 'failed'].includes(i.status) && i.created_at < cutoff);
      for (const i of gone) {
        for (const f of i.files) for (const path of [f.path, f.thumb_path]) if (path) fs.rmSync(path, { force: true });
        for (const k of Object.keys(data.sends)) if (data.sends[k].item_id === i.id) delete data.sends[k];
      }
      if (gone.length) {
        const ids = new Set(gone.map((i) => i.id));
        data.items = data.items.filter((i) => !ids.has(i.id));
        save();
      }
      return gone.length;
    },

    log(level, msg) {
      data.log.push({ ts: Date.now(), level, msg: String(msg).slice(0, 500) });
      if (data.log.length > 600) data.log.splice(0, data.log.length - 500);
      save();
    },
    recentLogs: (n = 100) => data.log.slice(-n).reverse(),
  };
}
