import test from 'node:test';
import assert from 'node:assert/strict';
import { AiTemporaryError } from '../src/ai.js';
import { createPipeline } from '../src/pipeline.js';
import { addItem, makeEnv } from './helpers.js';

const VENDOR = '2348000000000@s.whatsapp.net';
const fakeAi = (impl) => ({ isEnabled: () => true, analyze: impl });
const noAi = { isEnabled: () => false, analyze: async () => { throw new Error('no ai'); } };
const gown = (extra = {}) => async () => ({
  isUnderwear: false, itemType: 'ankara gown', title: '', colours: '', sizes: '', details: '',
  description: 'Beautiful ankara gown 😍\nSizes 12-18', entries: [{ label: '', amount: 8500 }], ...extra,
});

async function run(env, ai, caption, opts, itemFields = {}) {
  const id = addItem(env.store, { status: 'incoming', original_caption: caption, ...itemFields });
  const pipeline = createPipeline({ store: env.store, getSettings: env.getSettings, ai });
  await pipeline.processItem(id, opts);
  return env.store.getItem(id);
}

test('AI path: adds profit, rounds, lays out the caption, approves', async () => {
  const env = makeEnv({ profitPercent: 20, roundUpTo: 500 });
  const item = await run(env, fakeAi(gown()), 'New gown #8,500 call 0801 234 5678');
  assert.equal(item.status, 'approved');
  assert.equal(item.final_caption, 'Beautiful ankara gown 😍\nSizes 12-18\n\nPrice: ₦10,500');
  assert.deepEqual(item.price_lines, [{ label: '', vendor: 8500, final: 10500 }]);
});

test('a price list for several pictures: every price gets your profit', async () => {
  const env = makeEnv({ profitPercent: 10, roundUpTo: 100 });
  const ai = fakeAi(gown({ description: 'New ankara tops', entries: [{ label: 'Red', amount: 8500 }, { label: 'Blue', amount: 9000 }] }));
  const item = await run(env, ai, 'Red - 8,500\nBlue - 9,000');
  assert.equal(item.final_caption, 'New ankara tops\n\nRed: ₦9,400\nBlue: ₦9,900');
  assert.equal(item.status, 'approved');
});

const HOODIE = 'Hoodie bow 2 piece set\nAvailable in pink and blue\nSize: 1-7years\nPrice: 17,800\n\nMoq of 3 16,500 bg';
const hoodieAi = fakeAi(async () => ({
  isUnderwear: false, itemType: 'hoodie set', title: 'Cute bow hoodie and jeans set', colours: 'pink and blue', sizes: '1-7 years', details: '',
  description: 'Cute bow hoodie and jeans set for little ones, in pink and blue', entries: [{ label: '', amount: 17800 }, { label: 'Buy 3 or more', amount: 16500 }],
}));

test('a real vendor post: new words, both prices, none of the vendor wording', async () => {
  const env = makeEnv({ profitPercent: 20, roundUpTo: 500 });
  const item = await run(env, hoodieAi, HOODIE);
  assert.equal(item.final_caption, 'Cute bow hoodie and jeans set for little ones, in pink and blue\n\nSizes: 1-7 years\n\nPrice: ₦21,500\nBuy 3 or more: ₦20,000');
  assert.doesNotMatch(item.final_caption, /Hoodie bow 2 piece|Available in|Moq/i);
  assert.equal(item.status, 'approved');
});

test('your own caption style with named fields', async () => {
  const env = makeEnv({
    template: '🛍️ {title}\n🎨 Colours: {colours}\n📏 Size: {sizes}\n💰 {prices}\n\n{footer}',
    footer: 'DM to order', profitPercent: 20, roundUpTo: 500,
  });
  const item = await run(env, hoodieAi, HOODIE);
  assert.equal(item.final_caption, '🛍️ Cute bow hoodie and jeans set\n🎨 Colours: pink and blue\n📏 Size: 1-7 years\n💰 Price: ₦21,500\nBuy 3 or more: ₦20,000\n\nDM to order');
});

test('words you chose to remove never reach the AI or the post', async () => {
  let seen;
  const sneaky = fakeAi(async (args) => {
    seen = args;
    return gown({ title: 'Luxury hoodie set', description: 'Luxury hoodie set, new arrival', entries: [{ label: '', amount: 17800 }] })();
  });
  const item = await run(makeEnv({ removePhrases: ['new arrival', 'luxury'] }), sneaky, '🔥NEW ARRIVAL🔥\nLuxury hoodie set\nPrice: 17,800');
  assert.doesNotMatch(seen.caption, /new arrival|luxury/i);
  assert.doesNotMatch(item.final_caption, /new arrival|luxury/i);
});

test('the AI is told your example caption, style and removed words', async () => {
  let seen;
  const ai = fakeAi(async (args) => { seen = args; return gown()(); });
  await run(makeEnv({ captionExample: '💖 Gorgeous set!\nPrice: ₦9,000', removePhrases: ['luxury'] }), ai, 'gown #8500');
  assert.match(seen.prefs.example, /Gorgeous set/);
  assert.deepEqual(seen.prefs.removePhrases, ['luxury']);
});

test('each vendor can have their own profit rate', async () => {
  const env = makeEnv({ profitPercent: 20, roundUpTo: 100, vendorChats: [{ jid: VENDOR, name: 'Vendor A', profitPercent: 50 }] });
  const item = await run(env, fakeAi(gown()), 'gown #8500');
  assert.equal(item.price_lines[0].final, 12800);
  const other = await run(env, fakeAi(gown()), 'gown #8500', undefined, { vendor_jid: '2349999999999@s.whatsapp.net' });
  assert.equal(other.price_lines[0].final, 10200);
});

test('fixed profit and minimum profit', async () => {
  const env = makeEnv({ profitPercent: 5, profitFixed: 200, minProfit: 1000, roundUpTo: 100 });
  const item = await run(env, fakeAi(gown({ entries: [{ label: '', amount: 5000 }] })), 'gown 5000 naira');
  assert.equal(item.price_lines[0].final, 6000);
});

test('underwear words are skipped without calling the AI', async () => {
  let called = false;
  const item = await run(makeEnv(), fakeAi(async () => { called = true; }), 'Lace bra set #3,000 each');
  assert.equal(item.status, 'skipped');
  assert.match(item.note, /bra/);
  assert.equal(called, false);
});

test('AI spotting underwear in any picture skips the post, and you can restore it', async () => {
  const env = makeEnv();
  const id = addItem(env.store, { status: 'incoming', original_caption: 'Comfy 3 in 1 #8500' });
  const p = createPipeline({ store: env.store, getSettings: env.getSettings, ai: fakeAi(gown({ isUnderwear: true, itemType: 'boxers' })) });
  await p.processItem(id);
  assert.equal(env.store.getItem(id).status, 'skipped');
  await p.processItem(id, { force: true });
  assert.equal(env.store.getItem(id).status, 'approved');
});

test('"pants" is decided by the AI looking at the pictures', async () => {
  const trousers = await run(makeEnv(), fakeAi(gown({ itemType: 'cargo trousers' })), 'Cargo pants #8500');
  assert.equal(trousers.status, 'approved');
});

test('without an AI helper, the post waits and nothing of the vendor text is posted', async () => {
  const item = await run(makeEnv(), noAi, 'Hoodie set #8500');
  assert.equal(item.status, 'incoming');
  assert.ok(item.process_after > Date.now());
  assert.match(item.note, /AI helper/);
  assert.equal(item.final_caption, '');
});

test('price disagreement goes to review', async () => {
  const item = await run(makeEnv(), fakeAi(gown({ entries: [{ label: '', amount: 7500 }] })), 'gown #8500');
  assert.equal(item.status, 'needs_review');
  assert.match(item.note, /confirm/i);
});

test('review switch holds everything for approval', async () => {
  const item = await run(makeEnv({ reviewBeforeSending: true }), fakeAi(gown()), 'gown #8500');
  assert.equal(item.status, 'needs_review');
});

test('vendor price left in the description is caught', async () => {
  const item = await run(makeEnv(), fakeAi(gown({ description: 'Gown was ₦8,500 now cheaper' })), 'gown #8500');
  assert.equal(item.status, 'needs_review');
  assert.match(item.note, /vendor's own price/);
});

test('no price: posts anyway, or skips if you turned that off', async () => {
  const noPrice = fakeAi(gown({ entries: [], description: 'Lovely scarf in 5 colours' }));
  const a = await run(makeEnv(), noPrice, 'Lovely scarf');
  assert.equal(a.status, 'approved');
  assert.equal(a.final_caption, 'Lovely scarf in 5 colours');
  const b = await run(makeEnv({ postItemsWithoutPrice: false }), noPrice, 'Lovely scarf');
  assert.equal(b.status, 'skipped');
});

test('AI busy: tries again later. AI broken: review, prices kept, vendor words never reused', async () => {
  const busy = await run(makeEnv(), fakeAi(async () => { throw new AiTemporaryError('busy'); }), 'gown #8500');
  assert.equal(busy.status, 'incoming');
  assert.ok(busy.process_after > Date.now());
  const broken = await run(makeEnv(), fakeAi(async () => { throw new Error('key not accepted'); }), 'Lovely ankara gown #8500');
  assert.equal(broken.status, 'needs_review');
  assert.match(broken.note, /could not write/);
  assert.match(broken.final_caption, /₦10,500/);
  assert.doesNotMatch(broken.final_caption, /ankara|Lovely/i);
});
