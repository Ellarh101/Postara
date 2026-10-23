// Decides which pictures and which text belong together, the way vendors really post in a group:
//
//   pictures of one item  ->  a text with the price  ->  pictures of the next item  ->  its price text ...
//
// The price text ENDS a set: pictures that come after it start a new post, and it never gives its price to them.
// All timing goes by the time the vendor sent each message, not by when the app heard about it, so a burst of
// old messages after a reconnect is still split into the right sets.
import { findPrices } from './filters.js';

const hasPrice = (text) => findPrices(String(text || '')).length > 0;

const ALBUM_GAP_MS = 20_000;        // pictures this close together are one album, even if the first one carries the price
const LEAD_TEXT_MS = 60_000;        // a text typed just BEFORE the pictures is their caption
const LATE_CAPTION_MS = 15 * 60_000; // how long after the pictures a caption may still arrive

export function createGrouper({ store }) {
  const pendingText = new Map(); // text that arrived before its pictures

  // A text message from a vendor. Returns what happened: appended | late | pending | ignored
  function text({ jid, sender, text: raw, sentAt, now = Date.now(), settleMs }) {
    const text = String(raw || '').trim();
    if (!text) return { action: 'ignored' };
    const priced = hasPrice(text);

    // The set whose pictures just arrived. A text with a price cannot join a set that already has its own price.
    const open = store.findOpenBundle(jid, sender, sentAt - settleMs);
    if (open && !(priced && hasPrice(open.original_caption))) {
      store.appendCaption(open.id, text, now + 15_000, priced);
      return { action: 'appended', id: open.id };
    }

    // The vendor took a while to type it: the newest set that can still take it.
    const looksLikeCaption = priced || text.length >= 25;
    const late = looksLikeCaption && store.findLateCaptionTarget(jid, sender, sentAt - LATE_CAPTION_MS, priced);
    if (late) {
      const caption = late.original_caption ? `${late.original_caption}\n${text}` : text;
      store.updateItem(late.id, { original_caption: caption, closed: priced || !!late.closed, status: 'incoming', process_attempts: 0, process_after: now + 15_000, note: '' });
      return { action: 'late', id: late.id };
    }

    // No set is waiting for it: it is the caption of the pictures that follow.
    pendingText.set(`${jid}|${sender}`, { text, ts: sentAt });
    return { action: 'pending' };
  }

  // A picture or video from a vendor (already downloaded). Returns what happened: joined | created
  function picture({ jid, sender, vendor, entry, key, caption = '', sentAt, now = Date.now(), settleMs }) {
    const pendingKey = `${jid}|${sender}`;
    let open = store.findOpenBundle(jid, sender, sentAt - settleMs);
    if (open && hasPrice(open.original_caption)) {
      // a set that has a price already is finished, unless this is the next picture of the same album
      const sameAlbum = sentAt - (open.last_media_at || 0) <= ALBUM_GAP_MS && !(caption && hasPrice(caption));
      if (!sameAlbum) open = null;
    }
    if (open) {
      store.addFile(open.id, entry, key, caption, now + settleMs, sentAt);
      return { action: 'joined', id: open.id };
    }

    const pending = pendingText.get(pendingKey);
    pendingText.delete(pendingKey);
    const gap = pending ? sentAt - pending.ts : Infinity;
    const lead = !caption && pending && gap >= 0 && gap < LEAD_TEXT_MS ? pending.text : '';
    const id = store.insertItem({
      vendor_jid: vendor.jid,
      source_jid: jid,
      sender_jid: sender,
      msg_keys: [key],
      files: [entry],
      original_caption: caption || lead,
      status: 'incoming',
      created_at: now,
      posted_at: sentAt,
      last_media_at: sentAt,
      process_after: now + settleMs, // wait for the rest of the set and the price text
    });
    return { action: 'created', id };
  }

  return { text, picture };
}
