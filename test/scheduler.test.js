import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler, localParts } from '../src/scheduler.js';
import { ConnectionError } from '../src/errors.js';
import { addItem, fileEntry, makeEnv } from './helpers.js';

const G1 = '1203630000000001@g.us';
const G2 = '1203630000000002@g.us';
const noSleep = async () => {};

function fakeWa() {
  const wa = {
    open: true,
    sent: [],
    failNext: null,
    isOpen: () => wa.open,
    captions: [],
    async sendFile(item, index, target, caption) {
      if (wa.failNext) {
        const e = wa.failNext;
        wa.failNext = null;
        throw e;
      }
      wa.sent.push(`${item.id}->${target}`);
      wa.captions.push(caption);
    },
  };
  return wa;
}

// 10:00 in Lagos (UTC+1) on 2026-10-10, and the same time the next day
const at = (iso) => () => new Date(iso);

function setup(patch = {}, clock = '2026-10-10T09:00:00Z') {
  const env = makeEnv({ targetGroups: [{ jid: G1, name: 'Group 1' }], postToStatus: false, postTime: '09:00', itemsPerDay: 3, pickOrder: 'oldest', gapMinMinutes: 0, gapMaxMinutes: 0, ...patch });
  const wa = fakeWa();
  let clockFn = at(clock);
  const sched = createScheduler({ store: env.store, getSettings: env.getSettings, wa, now: () => clockFn(), sleep: noSleep, random: () => 0 });
  return { ...env, wa, sched, setClock: (iso) => { clockFn = at(iso); } };
}

test('local time uses the chosen time zone', () => {
  const p = localParts(new Date('2026-10-10T23:30:00Z'), 'Africa/Lagos');
  assert.equal(p.day, '2026-10-11');
  assert.equal(p.minutes, 0 * 60 + 30);
});

test('waits for the post time', async () => {
  const t = setup({}, '2026-10-10T07:00:00Z'); // 08:00 Lagos
  addItem(t.store);
  await t.sched.tick();
  assert.equal(t.wa.sent.length, 0);
  assert.equal(t.sched.status().state, 'waiting');
});

test('posts only the daily number, oldest first, and the rest wait for tomorrow', async () => {
  const t = setup();
  for (let i = 0; i < 5; i++) addItem(t.store);
  await t.sched.tick();
  assert.deepEqual(t.wa.sent, ['1->' + G1, '2->' + G1, '3->' + G1]);
  await t.sched.tick();
  assert.equal(t.wa.sent.length, 3, 'does not go over the limit');
  assert.equal(t.sched.status().state, 'done');
  t.setClock('2026-10-11T09:00:00Z');
  await t.sched.tick();
  assert.deepEqual(t.wa.sent.slice(3), ['4->' + G1, '5->' + G1]);
});

test('newest first when chosen', async () => {
  const t = setup({ pickOrder: 'newest', itemsPerDay: 1 });
  for (let i = 0; i < 3; i++) addItem(t.store);
  await t.sched.tick();
  assert.deepEqual(t.wa.sent, ['3->' + G1]);
});

test('offline: nothing sent, then it sends when the connection returns', async () => {
  const t = setup();
  addItem(t.store);
  t.wa.open = false;
  await t.sched.tick();
  assert.equal(t.wa.sent.length, 0);
  assert.equal(t.sched.status().state, 'offline');
  t.wa.open = true;
  await t.sched.tick();
  assert.equal(t.wa.sent.length, 1);
});

test('connection drops half way: no double posts and the day still counts once', async () => {
  const t = setup({ targetGroups: [{ jid: G1, name: 'One' }, { jid: G2, name: 'Two' }] });
  addItem(t.store);
  addItem(t.store);
  t.wa.sent = [];
  // first target works, second one hits a connection error
  const original = t.wa.sendFile;
  let calls = 0;
  t.wa.sendFile = async (item, index, target, caption) => {
    calls += 1;
    if (calls === 2) throw new ConnectionError('Connection Closed');
    return original(item, index, target, caption);
  };
  await t.sched.tick();
  assert.deepEqual(t.wa.sent, ['1->' + G1]);
  assert.equal(t.store.getItem(1).status, 'approved');
  await t.sched.tick(); // back online
  assert.deepEqual(t.wa.sent, ['1->' + G1, '1->' + G2, '2->' + G1, '2->' + G2]);
  assert.equal(t.store.getItem(1).status, 'sent');
});

test('a group that keeps failing is given up on after 3 tries, others still go', async () => {
  const t = setup({ targetGroups: [{ jid: G1, name: 'One' }, { jid: G2, name: 'Two' }] });
  addItem(t.store);
  const original = t.wa.sendFile;
  t.wa.sendFile = async (item, index, target, caption) => {
    if (target === G1) throw new Error('not a member of this group');
    return original(item, index, target, caption);
  };
  for (let i = 0; i < 4; i++) await t.sched.tick();
  assert.equal(t.store.getItem(1).status, 'sent');
  assert.deepEqual(t.wa.sent, ['1->' + G2]);
});

test('items waiting for review are never posted', async () => {
  const t = setup();
  addItem(t.store, { status: 'needs_review' });
  addItem(t.store, { status: 'skipped' });
  await t.sched.tick();
  assert.equal(t.wa.sent.length, 0);
});

test('status posting is included when switched on', async () => {
  const t = setup({ postToStatus: true });
  addItem(t.store);
  await t.sched.tick();
  assert.deepEqual(t.wa.sent, ['1->' + G1, '1->status']);
});

test('only recent vendor posts are posted: stale ones are skipped, fresh ones go out', async () => {
  const t = setup({ recentHours: 24, itemsPerDay: 5, pickOrder: 'newest' }); // clock: 2026-10-10 10:00 Lagos
  const now = new Date('2026-10-10T09:00:00Z').getTime();
  addItem(t.store, { posted_at: now - 30 * 3600_000 }); // 30 hours old
  addItem(t.store, { posted_at: now - 2 * 3600_000 });  // 2 hours old
  addItem(t.store, { posted_at: now - 23 * 3600_000 }); // just inside the window
  await t.sched.tick();
  assert.deepEqual(t.wa.sent, ['3->' + G1, '2->' + G1], 'newest first, and the 30-hour-old post is left out');
  const old = t.store.getItem(1);
  assert.equal(old.status, 'skipped');
  assert.match(old.note, /more than 24 hours ago/);
});

test('a stale post you restore yourself is kept', async () => {
  const t = setup({ recentHours: 24 });
  const now = new Date('2026-10-10T09:00:00Z').getTime();
  const id = addItem(t.store, { posted_at: now - 50 * 3600_000 });
  await t.sched.tick();
  assert.equal(t.store.getItem(id).status, 'skipped');
  t.store.updateItem(id, { status: 'approved', no_expire: true });
  await t.sched.tick();
  assert.equal(t.store.getItem(id).status, 'sent');
});

test('a post already half sent is never expired', async () => {
  const t = setup({ recentHours: 1, targetGroups: [{ jid: G1, name: 'One' }, { jid: G2, name: 'Two' }] });
  const now = new Date('2026-10-10T09:00:00Z').getTime();
  const id = addItem(t.store, { posted_at: now - 10 * 3600_000, first_sent_day: '2026-10-10' });
  t.store.recordSend(id, G1, 'sent', 1, '', now);
  await t.sched.tick();
  assert.deepEqual(t.wa.sent, ['1->' + G2]);
});

test('a post with several pictures goes out picture by picture, caption on the last one', async () => {
  const t = setup({ captionPlacement: 'last' });
  addItem(t.store, { files: [fileEntry(), fileEntry(), fileEntry()], final_caption: 'Prices: Red 1, Blue 2' });
  await t.sched.tick();
  assert.equal(t.wa.sent.length, 3);
  assert.deepEqual(t.wa.captions, [undefined, undefined, 'Prices: Red 1, Blue 2']);
  assert.equal(t.sched.status().sentToday, 1, 'the whole set counts as one item');
});

test('caption placement: first picture, or every picture', async () => {
  const a = setup({ captionPlacement: 'first' });
  addItem(a.store, { files: [fileEntry(), fileEntry()], final_caption: 'Cap' });
  await a.sched.tick();
  assert.deepEqual(a.wa.captions, ['Cap', undefined]);
  const b = setup({ captionPlacement: 'all' });
  addItem(b.store, { files: [fileEntry(), fileEntry()], final_caption: 'Cap' });
  await b.sched.tick();
  assert.deepEqual(b.wa.captions, ['Cap', 'Cap']);
});

test('connection drops in the middle of a set: it resumes without repeating pictures', async () => {
  const t = setup();
  addItem(t.store, { files: [fileEntry(), fileEntry(), fileEntry()], final_caption: 'Cap' });
  const original = t.wa.sendFile;
  let calls = 0;
  t.wa.sendFile = async (item, index, target, caption) => {
    calls += 1;
    if (calls === 2) throw new ConnectionError('Connection Closed');
    return original(item, index, target, caption);
  };
  await t.sched.tick();
  assert.equal(t.wa.sent.length, 1);
  await t.sched.tick();
  assert.equal(t.wa.sent.length, 3, 'only the two missing pictures were sent');
  assert.equal(t.store.getItem(1).status, 'sent');
});
