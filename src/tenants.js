// One independent copy of the whole app per account: its own WhatsApp link, settings, posts, AI key and schedule.
import fs from 'node:fs';
import path from 'node:path';
import { createAi } from './ai.js';
import { createAiConfig } from './aiconfig.js';
import { createStore } from './db.js';
import { createPipeline } from './pipeline.js';
import { createScheduler } from './scheduler.js';
import { createSettings } from './settings.js';
import { createWhatsApp } from './whatsapp.js';

export function createTenants({ config, users, factories = {}, intervals = { prepare: 15_000, cleanup: 15 * 60_000 }, startGapMs = 2000 }) {
  const running = new Map();

  function build(user) {
    const dir = path.join(config.dataDir, users.dirOf(user.id) || '');
    const cfg = { ...config, dataDir: dir, mediaDir: path.join(dir, 'media'), authDir: path.join(dir, 'auth'), dbPath: path.join(dir, 'poster.json') };
    for (const d of [cfg.dataDir, cfg.mediaDir, cfg.authDir]) fs.mkdirSync(d, { recursive: true });

    const store = createStore(cfg.dbPath);
    const settings = createSettings(store);
    const getSettings = () => settings.get();
    const aiConfig = createAiConfig(store, cfg);
    const ai = (factories.createAi || createAi)({ getConfig: aiConfig.get });
    const pipeline = createPipeline({ store, getSettings, ai });
    const wa = (factories.createWhatsApp || createWhatsApp)({ config: cfg, store, getSettings });
    const scheduler = createScheduler({ store, getSettings, wa });

    const timers = [
      setInterval(() => pipeline.processDue().catch((e) => store.log('error', e.message)), intervals.prepare),
      setInterval(() => dropOld(), intervals.cleanup),
    ];
    // Only the last day of posts is kept: older posts (and their pictures) are deleted.
    const dropOld = () => store.dropOlderThan(Date.now() - Math.min(24, settings.get().recentHours) * 3_600_000);
    for (const t of timers) t.unref?.();

    return {
      user, dir, store, settings, aiConfig, ai, pipeline, wa, scheduler,
      begin() {
        pipeline.reclassify();
        dropOld();
        wa.start();
        scheduler.start();
        store.log('info', 'App started');
      },
      stop() {
        for (const t of timers) clearInterval(t);
        store.flush();
        scheduler.stop();
        wa.stop();
      },
    };
  }

  const api = {
    // The running copy for an account (made and started the first time it is asked for).
    get(userId) {
      let t = running.get(userId);
      if (!t) {
        const user = users.get(userId);
        if (!user) return null;
        t = build(user);
        running.set(userId, t);
        t.begin();
      }
      return t;
    },
    peek: (userId) => running.get(userId) || null,
    ids: () => [...running.keys()],

    // Starts everybody, one after the other, so a server with many accounts is not hit all at once.
    async startAll() {
      for (const u of users.list()) {
        api.get(u.id);
        if (startGapMs) await new Promise((r) => setTimeout(r, startGapMs));
      }
    },

    stop(userId) {
      const t = running.get(userId);
      if (t) { t.stop(); running.delete(userId); }
    },

    // Stops an account and deletes everything it stored (its own folder only; never the shared one).
    destroy(userId, dirName) {
      api.stop(userId);
      if (dirName) fs.rmSync(path.join(config.dataDir, dirName), { recursive: true, force: true });
    },

    stopAll() {
      for (const id of [...running.keys()]) api.stop(id);
    },
  };
  return api;
}
