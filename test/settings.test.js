import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/db.js';
import { createSettings } from '../src/settings.js';

test('older saved settings get the caption on every picture, once', () => {
  const store = createStore(null);
  store.setKv('settings', JSON.stringify({ captionPlacement: 'last', profitPercent: 30 }));
  const settings = createSettings(store);
  assert.equal(settings.get().captionPlacement, 'all');
  assert.equal(settings.get().profitPercent, 30);
  settings.save({ captionPlacement: 'first' });
  const again = createSettings(store);
  assert.equal(again.get().captionPlacement, 'first', 'a choice made afterwards is kept');
});

test('words to remove are cleaned up and de-duplicated', () => {
  const settings = createSettings(createStore(null));
  settings.save({ removePhrases: [' New Arrival ', 'luxury', 'LUXURY', ''] });
  assert.deepEqual(settings.get().removePhrases, ['new arrival', 'luxury']);
});
