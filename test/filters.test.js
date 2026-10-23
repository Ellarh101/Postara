import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMarkup, checkWords, extractFields, findPrices, formatMoney, formatPriceBlock, renderTemplate, splitCaption, stripPhrases } from '../src/filters.js';

test('blocks underwear words but not trousers', () => {
  assert.equal(checkWords('Lovely lace BRA set').blocked, true);
  assert.equal(checkWords('Men boxers 3 in 1').blocked, true);
  assert.equal(checkWords('Cotton panties').blocked, true);
  assert.equal(checkWords('Nice ankara gown').blocked, false);
  assert.equal(checkWords('Brazil vintage jersey').blocked, false);
  assert.equal(checkWords('Cargo pants for men').ambiguous, true);
  assert.equal(checkWords('Cargo pants for men').blocked, false);
  assert.equal(checkWords('Silk scarf', ['scarf']).blocked, true);
});

test('reads the many ways Nigerians write prices', () => {
  const amounts = (t) => findPrices(t).map((p) => p.amount);
  assert.deepEqual(amounts('Price: ₦8,500'), [8500]);
  assert.deepEqual(amounts('Only #8500 !!'), [8500]);
  assert.deepEqual(amounts('N8500 each'), [8500]);
  assert.deepEqual(amounts('8.5k'), [8500]);
  assert.deepEqual(amounts('8,500 naira'), [8500]);
  assert.deepEqual(amounts('price - 12000'), [12000]);
  assert.deepEqual(amounts('Small #6,000 / Big #9,500'), [6000, 9500]);
  assert.deepEqual(amounts('Red - 8,500'), [8500]);
  assert.deepEqual(amounts('Blue - 9000'), [9000]);
  assert.deepEqual(amounts('Brown @ 15000 each'), [15000]);
  assert.deepEqual(amounts('Call 08012345678 for sizes 38 40 42'), []);
  assert.deepEqual(amounts('Available in 3 colours, size 38-42'), []);
});

test('profit: percentage, fixed amount, minimum, rounding', () => {
  assert.equal(applyMarkup(8500, { percent: 20, roundTo: 500 }), 10500);
  assert.equal(applyMarkup(10000, { percent: 20, roundTo: 500 }), 12000);
  assert.equal(applyMarkup(10000, { percent: 0, roundTo: 500 }), 10000);
  assert.equal(applyMarkup(8500, { percent: 20, roundTo: 1 }), 10200);
  assert.equal(applyMarkup(8500, { percent: 10, fixed: 300, roundTo: 100 }), 9700);
  assert.equal(applyMarkup(1000, { percent: 5, minProfit: 300, roundTo: 50 }), 1300);
  assert.equal(formatMoney(10500), '₦10,500');
});

test('splits a vendor caption into description and price list', () => {
  const r = splitCaption('Good morning fam!\nNew ankara tops, free size\nRed - ₦8,500\nBlue — 9k\nSmall #6,000 / Big #9,500\nCall 08031234567 to order');
  assert.equal(r.description, 'New ankara tops, free size');
  assert.deepEqual(r.entries, [
    { label: 'Red', amount: 8500 }, { label: 'Blue', amount: 9000 },
    { label: 'Small', amount: 6000 }, { label: 'Big', amount: 9500 },
  ]);
});

test('a single price keeps its words as description', () => {
  const r = splitCaption('Beautiful ankara gown now only N8,500 sizes 12-18');
  assert.deepEqual(r.entries, [{ label: '', amount: 8500 }]);
  assert.equal(r.description, 'Beautiful ankara gown\nsizes 12-18');
  const r2 = splitCaption('Ankara gown\nPrice: ₦8,500 each\nCall 08031234567');
  assert.equal(r2.description, 'Ankara gown');
  assert.deepEqual(r2.entries, [{ label: '', amount: 8500 }]);
});

test('price block follows your formats', () => {
  const s = { currency: '₦', priceSingle: 'Price: {price}', priceMulti: '{label}: {price}' };
  assert.equal(formatPriceBlock([{ label: '', final: 10500 }], s), 'Price: ₦10,500');
  assert.equal(formatPriceBlock([{ label: 'Red', final: 10500 }, { label: 'Blue', final: 11000 }], s), 'Red: ₦10,500\nBlue: ₦11,000');
  assert.equal(formatPriceBlock([{ label: '', final: 10500 }, { label: '', final: 10500 }], s), 'Price: ₦10,500');
  assert.equal(formatPriceBlock([{ label: 'Red', final: 9000 }], { ...s, priceMulti: '{label} only {price} 🔥' }), 'Red only ₦9,000 🔥');
  assert.equal(formatPriceBlock([], s), '');
});

test('caption layout fills in your tokens and tidies empty parts', () => {
  const t = '🔥 NEW IN 🔥\n{description}\n\n{prices}\n\n{footer}';
  assert.equal(renderTemplate(t, { description: 'Gown', prices: 'Price: ₦1', footer: '' }), '🔥 NEW IN 🔥\nGown\n\nPrice: ₦1');
  assert.equal(renderTemplate('{business}\n{description}', { description: 'Gown', business: 'Ruchies' }), 'Ruchies\nGown');
});

test('strips the words you never want, with the emojis stuck to them', () => {
  const out = stripPhrases('🔥NEW ARRIVAL🔥\nLuxury ankara gown - new arrivals\nSizes 12-18', ['new arrival', 'luxury']);
  assert.equal(out, 'ankara gown\nSizes 12-18');
  assert.equal(stripPhrases('Brand new gown', ['new arrival']), 'Brand new gown');
  assert.equal(stripPhrases('Luxurious gown', ['luxury']), 'Luxurious gown', 'only whole words');
});

test('pulls title, colours and sizes out of a description', () => {
  const f = extractFields('Hoodie bow 2 piece set\nAvailable in pink and blue\nSize: 1-7years\nSoft cotton');
  assert.deepEqual(f, { title: 'Hoodie bow 2 piece set', colours: 'pink and blue', sizes: '1-7years', details: 'Soft cotton' });
});

test('your layout leaves out lines whose fields are empty', () => {
  const t = '🛍️ {title}\n🎨 {colours}\n📏 Size: {sizes}\n🧵 {details}\n💰 {prices}';
  const out = renderTemplate(t, { title: 'Set', colours: 'pink', sizes: '', details: '', prices: 'Price: ₦1' });
  assert.equal(out, '🛍️ Set\n🎨 pink\n💰 Price: ₦1');
});

test('vendor shorthand "MOQ of 3" becomes "Buy 3 or more"', () => {
  const r = splitCaption('Hoodie set\nPrice: 17,800\n\nMoq of 3 16,500 bg');
  assert.equal(r.description, 'Hoodie set');
  assert.deepEqual(r.entries, [{ label: '', amount: 17800 }, { label: 'Buy 3 or more', amount: 16500 }]);
  const s = { currency: '₦', priceSingle: 'Price: {price}', priceMulti: '{label}: {price}' };
  assert.equal(formatPriceBlock([{ label: '', final: 21500 }, { label: 'Buy 3 or more', final: 20000 }], s), 'Price: ₦21,500\nBuy 3 or more: ₦20,000');
});
