import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/db.js';
import { createGrouper } from '../src/grouping.js';
import { findPrices } from '../src/filters.js';

const G = '120363000000000001@g.us';
const VENDOR = { jid: G, name: 'Vendors' };
const SETTLE = 60_000;
const T0 = Date.UTC(2026, 9, 21, 17, 26, 0);
let n = 0;

// A little chat simulator: say(sender, seconds, 'pic' | text) plays a message sent `seconds` after 17:26:00.
// burst = the app only hears about every message at the same moment (e.g. after a reconnect).
function chat({ burst = false } = {}) {
  const store = createStore(null);
  const grouper = createGrouper({ store });
  const arrival = burst ? T0 + 3_600_000 : null;
  const say = (sender, sec, what, caption = '') => {
    const sentAt = T0 + sec * 1000;
    const now = arrival ?? sentAt;
    if (what === 'pic') {
      n += 1;
      return grouper.picture({ jid: G, sender, vendor: VENDOR, entry: { path: `/tmp/p${n}.jpg`, type: 'image', hash: `h${n}` }, key: `${G}:m${n}`, caption, sentAt, now, settleMs: SETTLE });
    }
    return grouper.text({ jid: G, sender, text: what, sentAt, now, settleMs: SETTLE });
  };
  const posts = () => store.listItems('all', 100).reverse();
  return { store, say, posts };
}
const V = 'vendor-1';
const prices = (item) => findPrices(item.original_caption).map((p) => p.amount);

const SLIDES = 'TOP (QUALITY SLIDE)\n\nSIZE RANGE 37———41\nPRICE 18,000 ONLY\nIN STORE';
const BAGS = 'Ladies bag\nPRICE 25,000 ONLY';

test('pictures, price text, next pictures, next price text: each set keeps its own price (the reported mistake)', () => {
  const c = chat();
  for (const s of [0, 2, 4, 6]) c.say(V, s, 'pic');
  c.say(V, 60, SLIDES);                       // price typed a minute after the pictures, like 18:26 / 18:27
  for (const s of [75, 77, 79]) c.say(V, s, 'pic'); // the next item, 15 seconds after that price
  c.say(V, 140, BAGS);
  const [a, b, ...rest] = c.posts();
  assert.equal(rest.length, 0, 'exactly two posts');
  assert.equal(a.files.length, 4);
  assert.equal(b.files.length, 3);
  assert.deepEqual(prices(a), [18000]);
  assert.deepEqual(prices(b), [25000]);
  assert.doesNotMatch(b.original_caption, /18,000|SLIDE/);
});

test('the next pictures come a few seconds after the price: still a separate post', () => {
  const c = chat();
  c.say(V, 0, 'pic'); c.say(V, 3, 'pic');
  c.say(V, 8, SLIDES);
  c.say(V, 14, 'pic'); c.say(V, 16, 'pic');   // well inside the 60 second wait
  c.say(V, 25, BAGS);
  const [a, b, ...rest] = c.posts();
  assert.equal(rest.length, 0);
  assert.equal(a.files.length, 2);
  assert.equal(b.files.length, 2);
  assert.deepEqual(prices(a), [18000]);
  assert.deepEqual(prices(b), [25000]);
});

test('after a reconnect every message arrives in the same second, and the sets are still split by the vendor\'s own times', () => {
  const c = chat({ burst: true });
  c.say(V, 0, 'pic'); c.say(V, 2, 'pic');
  c.say(V, 70, SLIDES);
  c.say(V, 100, 'pic'); c.say(V, 102, 'pic'); c.say(V, 104, 'pic');
  c.say(V, 170, BAGS);
  c.say(V, 200, 'pic');
  const posts = c.posts();
  assert.equal(posts.length, 3);
  assert.deepEqual(posts.map((p) => p.files.length), [2, 3, 1]);
  assert.deepEqual(prices(posts[0]), [18000]);
  assert.deepEqual(prices(posts[1]), [25000]);
  assert.deepEqual(prices(posts[2]), [], 'the last pictures have no price yet and must not borrow one');
});

test('a price typed long after the pictures goes to the newest set, not an older one', () => {
  const c = chat();
  c.say(V, 0, 'pic');                          // set A, never gets a caption
  c.say(V, 120, 'pic');                        // set B
  c.say(V, 400, BAGS);                         // late price
  const [a, b] = c.posts();
  assert.deepEqual(prices(a), []);
  assert.deepEqual(prices(b), [25000]);
});

test('a price is never given to a set that already has one, and goes to the pictures that follow', () => {
  const c = chat();
  c.say(V, 0, 'pic'); c.say(V, 2, 'pic');
  c.say(V, 10, SLIDES);                        // finishes set A
  c.say(V, 40, BAGS);                          // typed BEFORE its pictures this time
  c.say(V, 45, 'pic'); c.say(V, 47, 'pic');
  const [a, b] = c.posts();
  assert.deepEqual(prices(a), [18000]);
  assert.deepEqual(prices(b), [25000]);
  assert.equal(b.files.length, 2);
});

test('price first, then pictures: two sets in a row each get their own price', () => {
  const c = chat();
  c.say(V, 0, SLIDES); c.say(V, 4, 'pic'); c.say(V, 6, 'pic');
  c.say(V, 50, BAGS); c.say(V, 54, 'pic'); c.say(V, 56, 'pic'); c.say(V, 58, 'pic');
  const [a, b] = c.posts();
  assert.deepEqual([a.files.length, b.files.length], [2, 3]);
  assert.deepEqual(prices(a), [18000]);
  assert.deepEqual(prices(b), [25000]);
});

test('an album whose first picture carries the price keeps its other pictures, and the next set starts fresh', () => {
  const c = chat();
  c.say(V, 0, 'pic', SLIDES); c.say(V, 2, 'pic'); c.say(V, 4, 'pic');
  c.say(V, 30, 'pic');                         // the next item, its price comes in a text
  c.say(V, 50, BAGS);
  const [a, b] = c.posts();
  assert.equal(a.files.length, 3);
  assert.equal(b.files.length, 1);
  assert.deepEqual(prices(a), [18000]);
  assert.deepEqual(prices(b), [25000]);
});

test('two pictures that each carry their own price are two posts even when sent close together', () => {
  const c = chat();
  c.say(V, 0, 'pic', SLIDES);
  c.say(V, 3, 'pic', BAGS);
  assert.equal(c.posts().length, 2);
});

test('a short note without a price does not end the set', () => {
  const c = chat();
  c.say(V, 0, 'pic'); c.say(V, 3, 'New arrivals!'); c.say(V, 6, 'pic'); c.say(V, 9, 'pic');
  c.say(V, 15, SLIDES);
  const posts = c.posts();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].files.length, 3);
  assert.deepEqual(prices(posts[0]), [18000]);
});

test('a description and a price typed as two messages both land on the same set', () => {
  const c = chat();
  c.say(V, 0, 'pic'); c.say(V, 2, 'pic');
  c.say(V, 100, 'Beautiful quality slide in many colours');
  c.say(V, 130, 'PRICE 18,000 ONLY');
  c.say(V, 160, 'pic');
  const [a, b] = c.posts();
  assert.equal(a.files.length, 2);
  assert.deepEqual(prices(a), [18000]);
  assert.match(a.original_caption, /quality slide/);
  assert.deepEqual(prices(b), []);
});

test('different senders in the same group never mix', () => {
  const c = chat();
  c.say('vendor-1', 0, 'pic'); c.say('vendor-2', 2, 'pic');
  c.say('vendor-1', 20, SLIDES); c.say('vendor-2', 25, BAGS);
  const posts = c.posts();
  assert.equal(posts.length, 2);
  assert.deepEqual(prices(posts.find((p) => p.sender_jid === 'vendor-1')), [18000]);
  assert.deepEqual(prices(posts.find((p) => p.sender_jid === 'vendor-2')), [25000]);
});

test('a text typed long before any pictures is not used as their caption', () => {
  const c = chat();
  c.say(V, 0, SLIDES);
  c.say(V, 600, 'pic');
  assert.deepEqual(prices(c.posts()[0]), []);
});

test('a late price does not reach back more than 15 minutes', () => {
  const c = chat();
  c.say(V, 0, 'pic');
  const r = c.say(V, 20 * 60, SLIDES);
  assert.equal(r.action, 'pending');
  assert.deepEqual(prices(c.posts()[0]), []);
});
