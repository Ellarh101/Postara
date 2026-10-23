import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/db.js';
import { addItem } from './helpers.js';

test('data survives a restart and removes duplicates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const file = path.join(dir, 'poster.json');
  const a = createStore(file);
  const id = addItem(a, { original_caption: 'hello' });
  assert.equal(a.hasMessage('nope'), false);
  a.setKv('x', '1');
  a.flush();
  const b = createStore(file);
  assert.equal(b.getItem(id).original_caption, 'hello');
  assert.equal(b.getKv('x'), '1');
});

test('pictures sent together are collected into one post', () => {
  const s = createStore(null);
  const now = Date.now();
  const id = addItem(s, { status: 'incoming', last_media_at: now, process_after: now + 60_000 });
  assert.equal(s.findOpenBundle('2348000000000@s.whatsapp.net', '2348000000000@s.whatsapp.net', now - 60_000).id, id);
  assert.equal(s.findOpenBundle('2348000000000@s.whatsapp.net', 'someone-else', now - 60_000), null);
  s.addFile(id, { path: '/tmp/x.jpg', type: 'image', hash: 'abc' }, 'k2', 'Red - 8,500', now + 60_000);
  s.appendCaption(id, 'Blue - 9,000', now);
  const item = s.getItem(id);
  assert.equal(item.files.length, 2);
  assert.equal(item.original_caption, 'Red - 8,500\nBlue - 9,000');
  assert.equal(s.hasHash('abc'), true);
  assert.equal(s.hasMessage('k2'), true);
});

test('a damaged file is set aside, not fatal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const file = path.join(dir, 'poster.json');
  fs.writeFileSync(file, '{ not json');
  const s = createStore(file);
  assert.equal(s.counts().approved, undefined);
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('broken')));
});

test('old finished posts are cleaned up, waiting ones are not', () => {
  const s = createStore(null);
  const old = Date.now() - 40 * 86_400_000;
  const a = addItem(s, { status: 'sent', created_at: old });
  const b = addItem(s, { status: 'approved', created_at: old });
  assert.equal(s.prune(30), 1);
  assert.equal(s.getItem(a), null);
  assert.ok(s.getItem(b));
});

test('only the last day is listed and counted', () => {
  const s = createStore(null);
  const now = Date.now();
  const fresh = addItem(s, { status: 'approved', posted_at: now - 3 * 3_600_000 });
  addItem(s, { status: 'approved', posted_at: now - 30 * 3_600_000 });
  addItem(s, { status: 'sent', posted_at: now - 50 * 3_600_000 });
  const since = now - 24 * 3_600_000;
  assert.deepEqual(s.listItems('all', 50, since).map((i) => i.id), [fresh]);
  assert.deepEqual(s.counts(since), { approved: 1 });
  assert.equal(s.counts().approved, 2, 'without a cutoff everything is still counted');
});

test('a post we sent recently stays visible even if the vendor posted it earlier', () => {
  const s = createStore(null);
  const now = Date.now();
  const id = addItem(s, { status: 'sent', posted_at: now - 26 * 3_600_000, sent_at: now - 3_600_000 });
  assert.deepEqual(s.listItems('all', 50, now - 24 * 3_600_000).map((i) => i.id), [id]);
});

test('posts older than the cutoff are deleted, except one that is half way through being sent', () => {
  const s = createStore(null);
  const now = Date.now();
  const old = now - 40 * 3_600_000;
  const a = addItem(s, { status: 'sent', posted_at: old });
  const b = addItem(s, { status: 'approved', posted_at: old });
  const c = addItem(s, { status: 'skipped', posted_at: old });
  const half = addItem(s, { status: 'approved', posted_at: old, first_sent_day: '2026-10-10' });
  const fresh = addItem(s, { status: 'approved', posted_at: now - 3_600_000 });
  assert.equal(s.dropOlderThan(now - 24 * 3_600_000), 3);
  for (const id of [a, b, c]) assert.equal(s.getItem(id), null);
  assert.ok(s.getItem(half));
  assert.ok(s.getItem(fresh));
});

test('posts saved by an older version are upgraded when loaded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const file = path.join(dir, 'poster.json');
  fs.writeFileSync(file, JSON.stringify({
    kv: {}, chats: {}, contacts: {}, sends: {}, log: [], nextId: 2,
    items: [{ id: 1, msg_key: 'x:1', source_jid: 'v@s.whatsapp.net', media_path: '/tmp/a.jpg', media_type: 'image', media_hash: 'h1',
      thumb_path: '/tmp/a.thumb.jpg', status: 'approved', vendor_prices: '8500', final_prices: '10500', final_caption: 'old', created_at: 5 }],
  }));
  const s = createStore(file);
  const item = s.getItem(1);
  assert.equal(item.files.length, 1);
  assert.equal(item.files[0].path, '/tmp/a.jpg');
  assert.deepEqual(item.price_lines, [{ label: '', vendor: 8500, final: 10500 }]);
  assert.deepEqual(item.msg_keys, ['x:1']);
});

test('a caption typed after the pictures finds the set it belongs to', () => {
  const s = createStore(null);
  const V = '2348000000000@s.whatsapp.net';
  const id = addItem(s, { status: 'approved', original_caption: '' });
  const withCaption = addItem(s, { status: 'approved', original_caption: 'has one' });
  assert.equal(s.findLateCaptionTarget(V, V, Date.now() - 60_000).id, id);
  assert.equal(s.findLateCaptionTarget(V, 'other', Date.now() - 60_000), null);
  s.updateItem(id, { first_sent_day: '2026-10-14' });
  assert.equal(s.findLateCaptionTarget(V, V, Date.now() - 60_000), null, 'never a set that already went out');
  assert.ok(withCaption);
});

test('queued posts written in the old basic mode are sent back to be rewritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const file = path.join(dir, 'poster.json');
  const base = { source_jid: 'v@s.whatsapp.net', files: [], msg_keys: [], price_lines: [], created_at: 5 };
  fs.writeFileSync(file, JSON.stringify({
    kv: {}, chats: {}, contacts: {}, sends: {}, log: [], nextId: 4,
    items: [
      { ...base, id: 1, status: 'approved', final_caption: 'vendor words', note: 'Basic mode (no AI key): caption cleaned up by simple rules.' },
      { ...base, id: 2, status: 'sent', final_caption: 'already posted', note: 'Basic mode (no AI key)', first_sent_day: '2026-10-01' },
      { ...base, id: 3, status: 'approved', final_caption: 'ai words', note: '' },
    ],
  }));
  const s = createStore(file);
  assert.equal(s.getItem(1).status, 'incoming');
  assert.equal(s.getItem(1).final_caption, '');
  assert.equal(s.getItem(2).status, 'sent');
  assert.equal(s.getItem(3).status, 'approved');
});
