import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyByWords, keepHours, pickCategory, todaysCategory } from '../src/categories.js';
import { createScheduler } from '../src/scheduler.js';
import { createPipeline } from '../src/pipeline.js';
import { systemPrompt } from '../src/ai.js';
import { sanitize, DEFAULTS } from '../src/settings.js';
import { addItem, makeEnv } from './helpers.js';

const G1 = '1203630000000001@g.us';
const noSleep = async () => {};
const rot = (extra = {}) => ({ ...DEFAULTS, rotateCategories: true, categories: ['bags', 'shoes', 'sandals'], rotationAnchorDay: '2026-10-10', rotationAnchorName: 'bags', ...extra });

test('the rotation moves one category on each day and starts again at the end', () => {
  const s = rot();
  assert.equal(todaysCategory(s, '2026-10-10'), 'bags');
  assert.equal(todaysCategory(s, '2026-10-11'), 'shoes');
  assert.equal(todaysCategory(s, '2026-10-12'), 'sandals');
  assert.equal(todaysCategory(s, '2026-10-13'), 'bags');
  assert.equal(todaysCategory(s, '2026-12-31'), todaysCategory(s, '2027-01-03'), 'repeats every 3 days across a year end');
});

test('the rotation can start from any category, and reordering the list keeps today the same', () => {
  const s = rot({ rotationAnchorName: 'shoes' });
  assert.equal(todaysCategory(s, '2026-10-10'), 'shoes');
  assert.equal(todaysCategory(s, '2026-10-11'), 'sandals');
  const moved = rot({ rotationAnchorName: 'shoes', categories: ['sandals', 'shoes', 'bags'] });
  assert.equal(todaysCategory(moved, '2026-10-10'), 'shoes', 'still shoes today');
  assert.equal(todaysCategory(moved, '2026-10-11'), 'bags');
});

test('no category when the rotation is off or the list is empty; a removed anchor starts at the top', () => {
  assert.equal(todaysCategory(rot({ rotateCategories: false }), '2026-10-10'), null);
  assert.equal(todaysCategory(rot({ categories: [] }), '2026-10-10'), null);
  assert.equal(todaysCategory(rot({ rotationAnchorName: 'wigs' }), '2026-10-10'), 'bags');
  assert.equal(todaysCategory(rot({ rotationAnchorDay: '' }), '2026-10-10'), 'bags', 'no start day yet: today is the anchor');
});

test('words: finds a category by its name, singular or plural, and ignores look-alikes', () => {
  const cats = ['bags', 'shoes', 'sandals', 'dresses'];
  assert.equal(classifyByWords('Beautiful leather bag, 2 colours', cats), 'bags');
  assert.equal(classifyByWords('New SHOE arrivals', cats), 'shoes');
  assert.equal(classifyByWords('Slide sandal for ladies', cats), 'sandals');
  assert.equal(classifyByWords('Elegant dress', cats), 'dresses');
  assert.equal(classifyByWords('A bagel and a shoebox', cats), '', 'whole words only');
  assert.equal(classifyByWords('', cats), '');
});

test('the AI choice wins when it is one of your categories, otherwise the words decide', () => {
  const cats = ['bags', 'shoes'];
  assert.equal(pickCategory('Shoes ', 'a bag', cats), 'shoes');
  assert.equal(pickCategory('other', 'a lovely bag', cats), 'bags');
  assert.equal(pickCategory('hats', 'hat', cats), '');
});

test('settings: category names are tidied, "other" is reserved and the list is capped', () => {
  const s = sanitize({ categories: [' Bags ', 'SHOES', 'bags', 'x', 'other', 'Hand Bags'] });
  assert.deepEqual(s.categories, ['bags', 'shoes', 'hand bags']);
  assert.deepEqual(sanitize({ categories: 'bags, shoes\nsandals' }).categories, ['bags', 'shoes', 'sandals']);
  assert.equal(sanitize({ categories: Array.from({ length: 50 }, (_, i) => `kind${i}`) }).categories.length, 30);
  assert.equal(sanitize({ rotationAnchorDay: 'tomorrow' }).rotationAnchorDay, '');
  assert.equal(sanitize({ rotationAnchorDay: '2026-10-10' }).rotationAnchorDay, '2026-10-10');
});

test('only the last 24 hours are kept, rotation or not', () => {
  assert.equal(keepHours({ rotateCategories: false, categories: [], recentHours: 24 }), 24);
  assert.equal(keepHours(rot({ recentHours: 24 })), 24);
  assert.equal(keepHours(rot({ recentHours: 12 })), 12);
  assert.equal(keepHours({ recentHours: 200 }), 24);
});

function setup(patch = {}, clock = '2026-10-10T09:00:00Z') {
  const env = makeEnv({
    targetGroups: [{ jid: G1, name: 'Group 1' }], postToStatus: false, postTime: '09:00', itemsPerDay: 10, pickOrder: 'oldest',
    gapMinMinutes: 0, gapMaxMinutes: 0, categories: ['bags', 'shoes', 'sandals'], rotateCategories: true,
    rotationAnchorDay: '2026-10-10', rotationAnchorName: 'bags', ...patch,
  });
  const wa = {
    open: true, sent: [],
    isOpen: () => wa.open,
    async sendFile(item, index, target) { wa.sent.push(item.id); },
  };
  let now = new Date(clock);
  const sched = createScheduler({ store: env.store, getSettings: env.getSettings, wa, now: () => now, sleep: noSleep, random: () => 0 });
  return { ...env, wa, sched, setClock: (iso) => { now = new Date(iso); } };
}

test('rotation: each day only that day\'s category goes out', async () => {
  const t = setup();
  const bag1 = addItem(t.store, { category: 'bags' });
  const shoe1 = addItem(t.store, { category: 'shoes' });
  const sandal1 = addItem(t.store, { category: 'sandals' });
  const bag2 = addItem(t.store, { category: 'bags' });
  await t.sched.tick();
  assert.deepEqual(t.wa.sent, [bag1, bag2], 'day 1: bags only');
  t.setClock('2026-10-11T09:00:00Z');
  await t.sched.tick();
  assert.deepEqual(t.wa.sent.slice(2), [shoe1], 'day 2: shoes');
  t.setClock('2026-10-12T09:00:00Z');
  await t.sched.tick();
  assert.deepEqual(t.wa.sent.slice(3), [sandal1], 'day 3: sandals');
});

test('rotation: the daily number still applies to the day\'s category', async () => {
  const t = setup({ itemsPerDay: 2 });
  for (let i = 0; i < 4; i++) addItem(t.store, { category: 'bags' });
  addItem(t.store, { category: 'shoes' });
  await t.sched.tick();
  assert.equal(t.wa.sent.length, 2);
});

test('rotation: nothing in today\'s category means nothing is posted, unless "fill with others" is on', async () => {
  const t = setup();
  const shoe = addItem(t.store, { category: 'shoes' });
  await t.sched.tick();
  assert.equal(t.wa.sent.length, 0);
  assert.equal(t.sched.status().state, 'nothing_ready');
  assert.equal(t.sched.status().category, 'bags');

  t.settings.save({ categoryFallback: true });
  await t.sched.tick();
  assert.deepEqual(t.wa.sent, [shoe]);
});

test('rotation: "fill with others" prefers today\'s category and only then takes the rest', async () => {
  const t = setup({ categoryFallback: true, itemsPerDay: 3 });
  const shoe = addItem(t.store, { category: 'shoes' });
  const bag = addItem(t.store, { category: 'bags' });
  const wig = addItem(t.store, { category: '' });
  await t.sched.tick();
  assert.deepEqual(t.wa.sent, [bag, shoe, wig]);
});

test('rotation off: category does not matter at all', async () => {
  const t = setup({ rotateCategories: false });
  addItem(t.store, { category: 'shoes' });
  addItem(t.store, { category: '' });
  await t.sched.tick();
  assert.equal(t.wa.sent.length, 2);
  assert.equal(t.sched.status().category, null);
});

test('rotation: only posts from the last day are used, so an older post of another category is gone', async () => {
  const t = setup({ recentHours: 24 });
  const now = new Date('2026-10-10T09:00:00Z').getTime();
  const sandal = addItem(t.store, { category: 'sandals', posted_at: now - 20 * 3600_000 });
  await t.sched.tick();
  t.setClock('2026-10-12T09:00:00Z'); // sandals day, but the post is now 68 hours old
  await t.sched.tick();
  assert.deepEqual(t.wa.sent, []);
  assert.equal(t.store.getItem(sandal).status, 'skipped');
});

test('post a category now: only that category, no waiting for the post time or today\'s category', async () => {
  const t = setup({ itemsPerDay: 5 }, '2026-10-10T05:00:00Z'); // 06:00 Lagos, before the post time
  const shoe1 = addItem(t.store, { category: 'shoes' });
  addItem(t.store, { category: 'bags' });
  const shoe2 = addItem(t.store, { category: 'shoes' });
  const r = t.sched.runNow({ category: 'shoes', count: 5 });
  assert.equal(r.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(t.wa.sent, [shoe1, shoe2]);
});

test('post a category now: stops at the number asked for and says so when the category is empty', async () => {
  const t = setup();
  for (let i = 0; i < 4; i++) addItem(t.store, { category: 'shoes' });
  await t.sched.tick({ ignoreTime: true, category: 'shoes', count: 2 });
  assert.equal(t.wa.sent.length, 2);
  const none = t.sched.runNow({ category: 'sandals', count: 3 });
  assert.equal(none.ok, false);
  assert.match(none.reason, /Nothing ready in that category/);
});

test('post a category now: "other" means posts that fit none of your categories', async () => {
  const t = setup();
  addItem(t.store, { category: 'bags' });
  const odd = addItem(t.store, { category: '' });
  await t.sched.tick({ ignoreTime: true, category: 'other', count: 5 });
  assert.deepEqual(t.wa.sent, [odd]);
});

test('status reports how many posts are ready in each category', () => {
  const t = setup();
  addItem(t.store, { category: 'bags' });
  addItem(t.store, { category: 'bags' });
  addItem(t.store, { category: 'shoes' });
  addItem(t.store, { category: '' });
  addItem(t.store, { category: 'bags', status: 'needs_review' });
  const st = t.sched.status();
  assert.deepEqual(st.readyByCategory, { bags: 2, shoes: 1, '': 1 });
  assert.equal(st.readyToday, 2);
});

test('pipeline: the AI\'s category is saved, with the words as back-up', async () => {
  const env = makeEnv({ categories: ['bags', 'shoes'] });
  const ai = (category, itemType = 'thing') => ({ isEnabled: () => true, analyze: async () => ({ isUnderwear: false, category, itemType, title: '', colours: '', sizes: '', details: '', description: 'Nice one', entries: [{ label: '', amount: 5000 }] }) });
  const run = async (fake, caption) => {
    const id = addItem(env.store, { status: 'incoming', original_caption: caption });
    await createPipeline({ store: env.store, getSettings: env.getSettings, ai: fake }).processItem(id);
    return env.store.getItem(id);
  };
  assert.equal((await run(ai('shoes'), 'new arrival #5000')).category, 'shoes');
  assert.equal((await run(ai('other', 'leather bag'), 'new arrival #5000')).category, 'bags', 'words in the AI\'s item type');
  assert.equal((await run(ai('other'), 'lovely hats #5000')).category, '');
});

test('pipeline: reclassify labels waiting posts from their captions and leaves labelled ones alone', () => {
  const env = makeEnv({ categories: ['bags', 'shoes'] });
  const pipeline = createPipeline({ store: env.store, getSettings: env.getSettings, ai: { isEnabled: () => false } });
  const a = addItem(env.store, { original_caption: 'nice leather bag', category: '' });
  const b = addItem(env.store, { original_caption: 'nice shoes', category: 'bags' });
  const c = addItem(env.store, { original_caption: 'a bag', status: 'sent' });
  assert.equal(pipeline.reclassify(), 1);
  assert.equal(env.store.getItem(a).category, 'bags');
  assert.equal(env.store.getItem(b).category, 'bags', 'an existing label is not overridden');
  assert.equal(env.store.getItem(c).category, '', 'finished posts are not touched');
});

test('the AI is asked for a category only when you have some', () => {
  assert.doesNotMatch(systemPrompt({}), /"category"/);
  const p = systemPrompt({ categories: ['bags', 'shoes'] });
  assert.match(p, /"category": string/);
  assert.match(p, /exactly one of "bags", "shoes", or "other"/);
});
