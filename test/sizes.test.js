import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSizes, extractSizes } from '../src/filters.js';
import { composeCaption, createPipeline } from '../src/pipeline.js';
import { tidyCaption } from '../src/tidy.js';
import { DEFAULTS } from '../src/settings.js';
import { addItem, makeEnv } from './helpers.js';

test('size ranges are written one way', () => {
  assert.equal(cleanSizes('37———41'), '37-41');
  assert.equal(cleanSizes('37–41'), '37-41');
  assert.equal(cleanSizes('37 to 41'), '37-41');
  assert.equal(cleanSizes('2 - 7'), '2-7');
  assert.equal(cleanSizes(' S-XL. '), 'S-XL');
});

test('sizes are found in the way vendors write them', () => {
  assert.equal(extractSizes(tidyCaption('TOP (QUALITY SLIDE)\n\nSIZE RANGE 37———41\nPRICE 18,000 ONLY')), '37-41');
  assert.equal(extractSizes('Sizes: 2-7\nPrice 9000'), '2-7');
  assert.equal(extractSizes('Ladies shoe, size 38 39 40 41 #12,000'), '38 39 40 41');
  assert.equal(extractSizes('Kids set, ages 1-7 years'), '1-7 years');
  assert.equal(extractSizes('Size S M L XL only 8500'), 'S M L XL');
  assert.equal(extractSizes('SIZE RANGE 40 to 45 PRICE 15,000'), '40-45');
});

test('no sizes in the caption means no sizes', () => {
  assert.equal(extractSizes('Lovely leather bag\nPrice 25,000 ONLY'), '');
  assert.equal(extractSizes('Sizes available on request'), '');
  assert.equal(extractSizes(''), '');
});

const fields = (sizes, description = 'Quality slide sandals') => ({ title: '', colours: '', sizes, details: '', description });
const entries = [{ label: '', amount: 18000 }];

test('sizes reach the caption even when the layout has no sizes line', () => {
  const { caption } = composeCaption({ fields: fields('37-41'), entries, settings: { ...DEFAULTS, profitPercent: 0, roundUpTo: 0 }, vendorJid: null });
  assert.equal(caption, 'Quality slide sandals\n\nSizes: 37-41\n\nPrice: ₦18,000');
});

test('an item without sizes gets no sizes line', () => {
  const { caption } = composeCaption({ fields: fields(''), entries, settings: { ...DEFAULTS, profitPercent: 0, roundUpTo: 0 }, vendorJid: null });
  assert.equal(caption, 'Quality slide sandals\n\nPrice: ₦18,000');
});

test('sizes are not repeated when the description already says them', () => {
  const { caption } = composeCaption({ fields: fields('37-41', 'Quality slide sandals in sizes 37 - 41'), entries, settings: { ...DEFAULTS, profitPercent: 0, roundUpTo: 0 }, vendorJid: null });
  assert.equal((caption.match(/37/g) || []).length, 1);
});

test('your own sizes line is used as written, not doubled', () => {
  const { caption } = composeCaption({ fields: fields('37-41'), entries, settings: { ...DEFAULTS, profitPercent: 0, roundUpTo: 0, template: '{description}\n📏 Size range: {sizes}\n{prices}' }, vendorJid: null });
  assert.equal(caption, 'Quality slide sandals\n📏 Size range: 37-41\nPrice: ₦18,000');
});

test('the always-show-sizes switch can be turned off', () => {
  const { caption } = composeCaption({ fields: fields('37-41'), entries, settings: { ...DEFAULTS, profitPercent: 0, roundUpTo: 0, showSizes: false }, vendorJid: null });
  assert.doesNotMatch(caption, /37/);
});

const ai = (result) => ({ isEnabled: () => true, analyze: async () => result });
const slide = (extra = {}) => ({ isUnderwear: false, category: '', itemType: 'slide sandals', title: '', colours: '', sizes: '', details: '', description: 'Quality slide sandals with a cut-out strap', entries: [{ label: '', amount: 18000 }], ...extra });
async function run(env, fake, caption) {
  const id = addItem(env.store, { status: 'incoming', original_caption: caption });
  await createPipeline({ store: env.store, getSettings: env.getSettings, ai: fake }).processItem(id);
  return env.store.getItem(id);
}
const VENDOR = 'TOP (QUALITY SLIDE)\n\nSIZE RANGE 37———41\nPRICE 18,000 ONLY\nIN STORE';

test('a real shoe post: the size range from the vendor is in the caption, whatever the AI says', async () => {
  for (const sizes of ['', '37—41', '37-41']) {
    const item = await run(makeEnv({ profitPercent: 0, roundUpTo: 0 }), ai(slide({ sizes })), VENDOR);
    assert.match(item.final_caption, /Sizes: 37-41/, `AI said "${sizes}"`);
    assert.match(item.final_caption, /₦18,000/);
  }
});

test('a post with no sizes stays free of a sizes line', async () => {
  const item = await run(makeEnv({ profitPercent: 0, roundUpTo: 0 }), ai(slide({ itemType: 'bag', description: 'Lovely leather bag' })), 'Ladies bag\nPRICE 25,000 ONLY');
  assert.doesNotMatch(item.final_caption, /Sizes/);
});

test('if the AI fails on a post, the vendor\'s sizes are still in the draft caption you review', async () => {
  const broken = { isEnabled: () => true, analyze: async () => { throw new Error('the AI is down'); } };
  const item = await run(makeEnv({ profitPercent: 0, roundUpTo: 0 }), broken, VENDOR);
  assert.equal(item.status, 'needs_review');
  assert.match(item.final_caption, /Sizes: 37-41/);
});
