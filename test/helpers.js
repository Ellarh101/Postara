import { createStore } from '../src/db.js';
import { createSettings } from '../src/settings.js';

export function makeEnv(settingsPatch = {}) {
  const store = createStore(null);
  const settings = createSettings(store);
  settings.save(settingsPatch);
  return { store, settings, getSettings: () => settings.get() };
}

let n = 0;
export function fileEntry() {
  n += 1;
  return { path: `/tmp/fake-${n}.jpg`, type: 'image', mimetype: 'image/jpeg', hash: `hash${n}`, thumb_path: null };
}

export function addItem(store, fields = {}) {
  n += 1;
  const now = Date.now();
  return store.insertItem({
    vendor_jid: '2348000000000@s.whatsapp.net',
    source_jid: '2348000000000@s.whatsapp.net',
    sender_jid: '2348000000000@s.whatsapp.net',
    msg_keys: [`test:${n}`],
    files: [fileEntry()],
    status: 'approved',
    created_at: now,
    posted_at: now,
    last_media_at: now,
    ...fields,
  });
}
