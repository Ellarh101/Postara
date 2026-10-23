import test from 'node:test';
import assert from 'node:assert/strict';
import { dropCutOffEnd, tidyCaption } from '../src/tidy.js';
import { createPipeline } from '../src/pipeline.js';
import { systemPrompt } from '../src/ai.js';
import { addItem, makeEnv } from './helpers.js';

test('underscores are removed', () => {
  assert.equal(tidyCaption('Ankara___gown_size_12'), 'Ankara gown size 12');
  assert.equal(tidyCaption('____\nNice bag\n________'), 'Nice bag');
});

test('rows of hyphens go, and a range keeps exactly one hyphen', () => {
  assert.equal(tidyCaption('Sizes 2--4'), 'Sizes 2-4');
  assert.equal(tidyCaption('Sizes 2-----4 years'), 'Sizes 2-4 years');
  assert.equal(tidyCaption('Sizes 2 - - 4'), 'Sizes 2-4');
  assert.equal(tidyCaption('Age 1—4'), 'Age 1—4', 'a single dash is left alone');
  assert.equal(tidyCaption('Age 1——4'), 'Age 1-4');
  assert.equal(tidyCaption('Size S -- XL'), 'Size S - XL');
  assert.equal(tidyCaption('Size S--XL'), 'Size S-XL');
  assert.equal(tidyCaption('---------\nNew gown\n-----------'), 'New gown');
  assert.equal(tidyCaption('-- Red\n-- Blue'), 'Red\nBlue');
});

test('a single hyphen is never touched', () => {
  assert.equal(tidyCaption('Sizes 2-4, ankara-style gown, size S - XL'), 'Sizes 2-4, ankara-style gown, size S - XL');
});

test('prices in a range keep their single hyphen', () => {
  assert.equal(tidyCaption('N5,000--N6,000'), 'N5,000-N6,000');
});

test('extra spaces and blank lines left behind are tidied', () => {
  assert.equal(tidyCaption('Red   gown\n\n\n\n----\n\nBlue gown  '), 'Red gown\n\nBlue gown');
});

test('a cut-off word at the end of the caption is removed', () => {
  assert.equal(dropCutOffEnd('Available in all colours and fi'), 'Available in all colours and');
  assert.equal(dropCutOffEnd('Available in all colours and fi...'), 'Available in all colours and');
  assert.equal(dropCutOffEnd('Nice bag\nmade of lea…'), 'Nice bag\nmade of lea…', 'only two-letter fragments are judged');
  assert.equal(dropCutOffEnd('fi'), '');
});

test('real endings are kept', () => {
  for (const t of ['Sizes S M L XL', 'Call 0803 DM', 'Price 5000 ok', 'Delivery in Ph', 'Size 40 to 45', 'Nice bag', 'Sizes S M L']) {
    assert.equal(dropCutOffEnd(t), t);
  }
});

test('the AI reads the cleaned caption and its answer is cleaned too', async () => {
  const env = makeEnv({ categories: [] });
  const seen = [];
  const ai = {
    isEnabled: () => true,
    analyze: async ({ caption }) => {
      seen.push(caption);
      return { isUnderwear: false, category: '', itemType: 'gown', title: 'Pretty__gown', colours: 'pink', sizes: '2--4 years', details: '', description: 'Pretty gown_set, sizes 2-----4', entries: [{ label: '', amount: 5000 }] };
    },
  };
  const id = addItem(env.store, { status: 'incoming', original_caption: 'Ankara____gown\n-----------\nsize 2--4 #5000 available in fi' });
  await createPipeline({ store: env.store, getSettings: env.getSettings, ai }).processItem(id);
  assert.equal(seen[0], 'Ankara gown\nsize 2-4 #5000 available in');
  const caption = env.store.getItem(id).final_caption;
  assert.doesNotMatch(caption, /_|--/);
  assert.match(caption, /2-4/);
});

test('the AI is told about underscores, hyphens and cut-off words', () => {
  assert.match(systemPrompt({}), /Never use underscores or rows of hyphens/);
});
