// Everything one account can do: its posts, settings, WhatsApp link and schedule.
// createApi is made once per account, so one account can never see or change another's data.
import express from 'express';
import { normaliseName, OTHER } from './categories.js';
import { composeCaption } from './pipeline.js';
import { localParts } from './scheduler.js';
import { sanitize } from './settings.js';

function publicItem(i, vendors) {
  return {
    id: i.id,
    status: i.status,
    category: i.category || '',
    vendor: vendors.find((v) => v.jid === i.vendor_jid)?.name || '',
    files: i.files.map((f) => ({ type: f.type })),
    originalCaption: i.original_caption,
    finalCaption: i.final_caption,
    priceLines: i.price_lines,
    note: i.note,
    createdAt: i.created_at,
    postedAt: i.posted_at,
    sentAt: i.sent_at,
  };
}

export function createApi({ store, settings, wa, scheduler, pipeline, ai, aiConfig, updater, isAdmin }) {
  const app = express.Router();
  // App updates change the program for everybody on this server, so only the admin may use them.
  const adminOnly = (req, res, next) => (isAdmin() ? next() : res.status(403).json({ error: 'Only the admin can update the app.' }));

  // Only the last day is shown anywhere in the app.
  const since = () => Date.now() - Math.min(24, settings.get().recentHours) * 3_600_000;

  app.get('/status', (req, res) => {
    res.json({
      whatsapp: wa.getState(),
      schedule: scheduler.status(),
      counts: store.counts(since()),
      aiReady: ai.isEnabled(),
    });
  });

  app.get('/ai', (req, res) => res.json(aiConfig.publicView()));
  app.put('/ai', (req, res) => res.json(aiConfig.save(req.body || {})));
  app.post('/ai/test', async (req, res) => {
    try {
      res.json({ ok: true, ...(await ai.test()) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // App updates: look for a newer version, install it, keep your data.
  app.get('/update', adminOnly, (req, res) => res.json({ ...updater.status(), source: store.getKv('updateUrl') || '' }));
  app.post('/update/check', adminOnly, async (req, res) => {
    try {
      res.json({ ...(await updater.check()), source: store.getKv('updateUrl') || '' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app.post('/update/install', adminOnly, (req, res) => {
    updater.install().catch((e) => store.log('error', `Update failed: ${e.message}`));
    res.json(updater.status());
  });
  app.put('/update/source', adminOnly, (req, res) => {
    const url = String(req.body?.url || '').trim();
    if (url && !/^https:\/\//i.test(url)) return res.status(400).json({ error: 'The address must start with https://' });
    store.setKv('updateUrl', url.slice(0, 500));
    res.json({ ok: true, source: url });
  });

  app.get('/settings', (req, res) => res.json(settings.get()));
  app.put('/settings', (req, res) => {
    const body = { ...(req.body || {}) };
    const zone = sanitize({ timezone: body.timezone }, settings.get()).timezone;
    const today = localParts(new Date(), zone).day;
    // The page says "start the rotation today" without knowing the date in the seller's time zone.
    if (body.rotationAnchorDay === '__today__') body.rotationAnchorDay = today;
    let saved = settings.save(body);
    // Rotation switched on for the first time: today is the first category in the list.
    if (saved.rotateCategories && saved.categories.length && !saved.rotationAnchorDay) {
      saved = settings.save({ rotationAnchorDay: today, rotationAnchorName: saved.categories[0] });
    }
    pipeline.reclassify();
    res.json(saved);
  });

  app.get('/chats', (req, res) => {
    const chats = store.listChats();
    res.json({
      groups: chats.filter((c) => c.kind === 'group'),
      people: chats.filter((c) => c.kind === 'person'),
    });
  });
  app.post('/chats/refresh', async (req, res) => {
    await wa.refreshGroups();
    res.json({ ok: true });
  });

  app.get('/items', (req, res) => {
    const status = String(req.query.status || 'all');
    const vendors = settings.get().vendorChats;
    res.json(store.listItems(status, 150, since()).map((i) => publicItem(i, vendors)));
  });

  app.get('/items/:id/thumb/:n?', (req, res) => {
    const item = store.getItem(Number(req.params.id));
    const b64 = item && store.thumbBase64(item.files[Number(req.params.n || 0)]?.thumb_path);
    if (!b64) return res.status(404).end();
    res.type('jpeg').set('Cache-Control', 'private, max-age=3600').send(Buffer.from(b64, 'base64'));
  });

  function withItem(handler) {
    return async (req, res) => {
      const item = store.getItem(Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'Post not found' });
      try {
        await handler(item, req, res);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    };
  }

  app.put('/items/:id', withItem((item, req, res) => {
    if (['sent'].includes(item.status)) return res.status(400).json({ error: 'This post was already sent.' });
    const caption = String(req.body?.finalCaption ?? item.final_caption).slice(0, 3000);
    const fields = { final_caption: caption };
    if (typeof req.body?.category === 'string') {
      const c = normaliseName(req.body.category);
      if (c && c !== OTHER && !settings.get().categories.includes(c)) return res.status(400).json({ error: 'That category is not in your list. Add it in Settings first.' });
      fields.category = c === OTHER ? '' : c;
    }
    store.updateItem(item.id, fields);
    res.json({ ok: true });
  }));

  app.post('/items/:id/approve', withItem((item, req, res) => {
    if (!['needs_review', 'skipped'].includes(item.status)) return res.status(400).json({ error: 'This post cannot be approved now.' });
    if (typeof req.body?.finalCaption === 'string') store.updateItem(item.id, { final_caption: req.body.finalCaption.slice(0, 3000) });
    store.updateItem(item.id, { status: 'approved', note: '', ...(item.status === 'skipped' ? { no_expire: true } : {}) });
    res.json({ ok: true });
  }));

  app.post('/items/:id/skip', withItem((item, req, res) => {
    if (item.status === 'sent') return res.status(400).json({ error: 'This post was already sent.' });
    store.updateItem(item.id, { status: 'skipped', note: 'Skipped by you.' });
    res.json({ ok: true });
  }));

  // Brings a skipped post back: re-prepares it ignoring the underwear filter, then it follows your review setting.
  app.post('/items/:id/restore', withItem(async (item, req, res) => {
    if (item.status !== 'skipped') return res.status(400).json({ error: 'Only skipped posts can be restored.' });
    store.updateItem(item.id, { status: 'incoming', process_attempts: 0, process_after: 0, no_expire: true });
    await pipeline.processItem(item.id, { force: true });
    res.json({ ok: true });
  }));

  // "Post now", or "post a category now" when a category is given.
  app.post('/run-now', (req, res) => {
    const wanted = normaliseName(req.body?.category);
    if (!wanted) return res.json(scheduler.runNow());
    if (wanted !== OTHER && !settings.get().categories.includes(wanted)) return res.status(400).json({ error: 'That category is not in your list.' });
    const count = Math.max(1, Math.min(100, Math.round(Number(req.body?.count)) || settings.get().itemsPerDay));
    res.json(scheduler.runNow({ category: wanted, count }));
  });

  // Shows how a caption will look with the settings on screen (not saved yet).
  app.post('/preview', (req, res) => {
    const s = sanitize(req.body || {}, settings.get());
    const fields = {
      title: 'Hoodie bow 2 piece set', colours: 'pink and blue', sizes: '1-7 years', details: '',
      description: 'Hoodie bow 2 piece set\nAvailable in pink and blue',
    };
    const one = composeCaption({ fields, entries: [{ label: '', amount: 17800 }], settings: s, vendorJid: null });
    const bulk = composeCaption({
      fields,
      entries: [{ label: '', amount: 17800 }, { label: 'Buy 3 or more', amount: 16500 }],
      settings: s, vendorJid: null,
    });
    res.json({ single: one.caption, multi: bulk.caption });
  });

  app.post('/test-status', async (req, res) => {
    try {
      res.json({ ok: true, ...(await wa.sendTestStatus()) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/test-message', async (req, res) => {
    const targets = settings.get().targetGroups;
    if (!targets.length) return res.status(400).json({ error: 'Choose at least one group in Settings first.' });
    const sent = [];
    try {
      for (const g of targets) {
        await wa.sendText(g.jid, '✅ Test message from my posting app. Please ignore.');
        sent.push(g.name);
      }
      res.json({ ok: true, sent });
    } catch (e) {
      res.status(500).json({ error: e.message, sent });
    }
  });

  app.post('/pairing-code', async (req, res) => {
    let d = String(req.body?.phone || '').replace(/\D/g, '');
    if (d.startsWith('0') && d.length === 11) d = `234${d.slice(1)}`;
    else if (d.length === 10) d = `234${d}`;
    if (d.length < 11 || d.length > 15) return res.status(400).json({ error: 'That phone number does not look right. Use the number with country code, like 0803 123 4567.' });
    try {
      res.json({ code: await wa.requestPairing(d) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/relink', async (req, res) => {
    try {
      await wa.relink();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/log', (req, res) => res.json(store.recentLogs(150)));

  return app;
}
