// Decides when to post. Every 30 seconds it checks: is it past the post time, are we online,
// and is there room left in today's limit? If yes it sends, spaced out, until the limit is reached.
import { keepHours, todaysCategory } from './categories.js';
import { isConnectionProblem } from './errors.js';

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

export function createScheduler({ store, getSettings, wa, now = () => new Date(), sleep = realSleep, random = Math.random }) {
  let running = false;
  let timer = null;
  let warnedNoTargets = false;

  const targetsOf = (s) => [...s.targetGroups.map((g) => g.jid), ...(s.postToStatus ? ['status'] : [])];
  const labelOf = (s, target) => (target === 'status' ? 'your status' : s.targetGroups.find((g) => g.jid === target)?.name || target);
  const postMinutes = (s) => {
    const [h, m] = s.postTime.split(':').map(Number);
    return h * 60 + m;
  };

  // Which kind of item to take: a category chosen for this run ("post a category now"), otherwise today's
  // category in the rotation (none when the rotation is off).
  function pickOpts(s, day, run = {}) {
    if (run.category) return { category: run.category, ignoreLimit: true };
    return { category: todaysCategory(s, day), fallbackAny: s.categoryFallback };
  }

  // Which picture of a set carries the caption, as chosen in Settings.
  function captionFor(s, item, index) {
    const last = item.files.length - 1;
    const wanted = s.captionPlacement === 'all' || (s.captionPlacement === 'first' && index === 0) || (s.captionPlacement === 'last' && index === last);
    return wanted && item.final_caption ? item.final_caption : undefined;
  }

  // Sends every picture of the item to every chosen place. Safe to call again after an interruption:
  // it carries on from the picture where it stopped and never repeats one that went out.
  async function sendOne(item, s, day) {
    const targets = targetsOf(s);
    if (!targets.length) {
      if (!warnedNoTargets) store.log('warn', 'No groups or status selected, so nothing can be posted. Choose where to post in Settings.');
      warnedNoTargets = true;
      return false;
    }
    warnedNoTargets = false;
    const done = new Map(store.sends(item.id).map((r) => [r.target, r]));
    const total = item.files.length;
    let first = true;

    for (const target of targets) {
      const prev = done.get(target);
      if (prev && (prev.status === 'sent' || prev.status === 'failed')) continue;
      let progress = prev?.progress || 0;
      let failures = prev?.attempts || 0;
      let sameTarget = progress > 0;

      while (progress < total) {
        if (!wa.isOpen()) return false;
        if (!first) await sleep(sameTarget ? 1500 + random() * 2500 : 4000 + random() * 6000);
        first = false;
        sameTarget = true;
        try {
          await wa.sendFile(item, progress, target, captionFor(s, item, progress));
        } catch (e) {
          if (isConnectionProblem(e)) {
            store.log('warn', `Post #${item.id}: connection lost. It will go out when you are back online.`);
            return false;
          }
          failures += 1;
          const gaveUp = failures >= 3;
          store.recordSend(item.id, target, gaveUp ? 'failed' : 'pending', failures, e.message, null, progress);
          done.set(target, { status: gaveUp ? 'failed' : 'pending' });
          store.log('error', `Post #${item.id} to ${labelOf(s, target)} failed (try ${failures}/3): ${e.message}`);
          if (!gaveUp) return false;
          break;
        }
        progress += 1;
        if (!store.getItem(item.id).first_sent_day) store.updateItem(item.id, { first_sent_day: day });
        const complete = progress >= total;
        store.recordSend(item.id, target, complete ? 'sent' : 'pending', failures, '', Date.now(), progress);
        done.set(target, { status: complete ? 'sent' : 'pending' });
        if (complete) store.log('info', `Post #${item.id} sent to ${labelOf(s, target)}${total > 1 ? ` (${total} pictures)` : ''}`);
      }
    }

    const finished = targets.every((t) => ['sent', 'failed'].includes(done.get(t)?.status));
    if (finished) {
      const anySent = targets.some((t) => done.get(t)?.status === 'sent');
      store.updateItem(item.id, {
        status: anySent ? 'sent' : 'failed',
        sent_at: Date.now(),
        note: anySent ? '' : 'Could not be sent to any group. See the Log tab.',
      });
    }
    return finished;
  }

  async function runBatch(day, run = {}) {
    let first = true;
    let started = 0;
    while (wa.isOpen()) {
      const s = getSettings();
      if (!s.enabled) break;
      if (run.count != null && started >= run.count) break;
      const item = store.nextToSend(day, s.itemsPerDay, s.pickOrder, pickOpts(s, day, run));
      if (!item) break;
      if (!first) {
        const minutes = s.gapMinMinutes + random() * (s.gapMaxMinutes - s.gapMinMinutes);
        await sleep(minutes * 60_000);
        if (!wa.isOpen()) break;
      }
      first = false;
      const ok = await sendOne(item, s, day);
      if (!ok) break;
      started += 1;
    }
  }

  // Vendor posts older than the "recent" window are never posted. (With a daily category rotation the window
  // is stretched, so a post is still there when its category's turn comes round.)
  function expireStale(s) {
    const hours = keepHours(s);
    const n = store.expireStale(now().getTime() - hours * 3_600_000,
      `Skipped: the vendor posted this more than ${hours} hours ago. Tap Restore to post it anyway.`);
    if (n) store.log('info', `${n} older vendor post${n === 1 ? '' : 's'} skipped (older than ${hours} hours)`);
  }

  function precheck({ ignoreTime = false, category = null } = {}) {
    const s = getSettings();
    expireStale(s);
    if (running) return { ok: false, reason: 'A run is already in progress.' };
    if (!s.enabled) return { ok: false, reason: 'Posting is paused in Settings.' };
    const { day, minutes } = localParts(now(), s.timezone);
    if (!ignoreTime && minutes < postMinutes(s)) return { ok: false, reason: 'It is not post time yet.' };
    if (!wa.isOpen()) return { ok: false, reason: 'Not connected to WhatsApp yet. Posts wait and go out when you are back online.' };
    if (!store.nextToSend(day, s.itemsPerDay, s.pickOrder, pickOpts(s, day, { category }))) {
      if (category) return { ok: false, reason: 'Nothing ready in that category.' };
      const today = todaysCategory(s, day);
      return { ok: false, reason: today ? `Nothing ready in today's category (${today}), or today's limit is reached.` : 'Nothing ready to post, or today\'s limit is reached.' };
    }
    return { ok: true, day };
  }

  async function tick(opts = {}) {
    const check = precheck(opts);
    if (!check.ok) return check;
    running = true;
    try {
      await runBatch(check.day, { category: opts.category, count: opts.count });
    } catch (e) {
      store.log('error', `Posting run stopped: ${e.message}`);
    } finally {
      running = false;
    }
    return { ok: true };
  }

  // Used by the "Post now" button and by "Post a category now": starts in the background, answers straight away.
  // category: only that kind ('other' = none of the seller's categories); count: how many posts at most.
  function runNow({ category = null, count = null } = {}) {
    const check = precheck({ ignoreTime: true, category });
    if (!check.ok) return check;
    tick({ ignoreTime: true, category, count }).catch(() => {});
    return { ok: true };
  }

  function status() {
    const s = getSettings();
    expireStale(s);
    const { day, minutes } = localParts(now(), s.timezone);
    const sent = store.sentCountForDay(day);
    const ready = store.counts().approved || 0;
    const today = todaysCategory(s, day);
    const readyBy = store.readyByCategory();
    const readyToday = today && !s.categoryFallback ? readyBy[today] || 0 : ready;
    let state;
    if (!s.enabled) state = 'paused';
    else if (!targetsOf(s).length) state = 'no_targets';
    else if (running) state = 'sending';
    else if (minutes < postMinutes(s)) state = 'waiting';
    else if (!wa.isOpen()) state = 'offline';
    else if (!store.nextToSend(day, s.itemsPerDay, s.pickOrder, pickOpts(s, day))) state = sent >= s.itemsPerDay ? 'done' : 'nothing_ready';
    else state = 'due';
    return {
      state, running, sentToday: sent, limit: s.itemsPerDay, postTime: s.postTime, ready, day,
      category: today, readyToday, readyByCategory: readyBy,
    };
  }

  function start() {
    timer = setInterval(() => tick().catch(() => {}), 30_000);
    setTimeout(() => tick().catch(() => {}), 5_000);
  }

  function stop() {
    clearInterval(timer);
  }

  return { start, stop, tick, runNow, status };
}
