import { normaliseName, OTHER } from './categories.js';

export const SETTINGS_VERSION = 2;

export const DEFAULTS = {
  enabled: true,
  vendorChats: [],          // [{ jid, name, profitPercent? }]  profitPercent here overrides the default for that vendor
  targetGroups: [],         // [{ jid, name }]
  postToStatus: true,

  // schedule
  postTime: '09:00',
  timezone: 'Africa/Lagos',
  itemsPerDay: 10,
  pickOrder: 'newest',      // 'oldest' | 'newest'
  gapMinMinutes: 2,
  gapMaxMinutes: 5,
  recentHours: 24,          // the app only keeps and posts items from the last this many hours (1-24)
  bundleWaitSeconds: 60,    // pictures sent close together by one vendor are one post

  // kinds of items, e.g. bags today, shoes tomorrow, sandals after
  categories: [],           // the seller's kinds of items, in the order the rotation goes through them
  rotateCategories: false,  // post only one kind each day, then move to the next
  rotationAnchorDay: '',    // the rotation is remembered as: on this day (YYYY-MM-DD)...
  rotationAnchorName: '',   // ...this category was "today"
  categoryFallback: false,  // if today's category has nothing ready, post other items instead of nothing

  // your price
  showSizes: true,          // add "Sizes: ..." to the caption whenever the vendor gave sizes, even if the layout has no {sizes}
  profitPercent: 20,
  profitFixed: 0,           // extra amount added after the percentage
  minProfit: 0,             // never earn less than this on an item
  roundUpTo: 500,
  currency: '₦',
  postItemsWithoutPrice: true,

  // your captions
  template: '{description}\n\n{prices}\n\n{footer}',
  priceSingle: 'Price: {price}',
  priceMulti: '{label}: {price}',
  businessName: '',
  footer: '',
  captionLanguage: 'English',
  emojiLevel: 'few',        // 'none' | 'few' | 'lots'
  captionLength: 'short',   // 'short' | 'medium' | 'long'
  hashtags: false,
  captionStyle: 'Warm and friendly, like a good online seller in Nigeria.',
  captionExample: '',       // a post written in the seller's own style, for the AI to copy
  removePhrases: [],        // words and phrases cut out of every vendor caption, like "new arrival"
  captionPlacement: 'all',  // which pictures of a set carry the caption: 'first' | 'last' | 'all'
  reviewBeforeSending: false,
  extraBlockedWords: [],
};

const ROUND_OPTIONS = [1, 10, 50, 100, 500, 1000];
const JID_RE = /^\d+(-\d+)?@(s\.whatsapp\.net|g\.us|lid)$/;

function num(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function chatList(v, fallback, withProfit = false) {
  if (!Array.isArray(v)) return fallback;
  const seen = new Set();
  const out = [];
  for (const c of v) {
    const jid = String(c?.jid || '').trim();
    if (!JID_RE.test(jid) || seen.has(jid)) continue;
    seen.add(jid);
    const row = { jid, name: String(c?.name || jid.split('@')[0]).slice(0, 100) };
    if (withProfit && c?.profitPercent !== undefined && c.profitPercent !== null && c.profitPercent !== '') {
      const p = Number(c.profitPercent);
      if (Number.isFinite(p)) row.profitPercent = Math.min(1000, Math.max(0, p));
    }
    out.push(row);
  }
  return out;
}

function validZone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const text = (v, max, fallback = '') => {
  const t = String(v ?? '').slice(0, max);
  return t.trim() ? t : fallback;
};

export function sanitize(input, base = DEFAULTS) {
  const s = { ...base };
  const i = input || {};
  const has = (k) => k in i;

  if (has('enabled')) s.enabled = !!i.enabled;
  if (has('vendorChats')) s.vendorChats = chatList(i.vendorChats, s.vendorChats, true);
  if (has('targetGroups')) s.targetGroups = chatList(i.targetGroups, s.targetGroups);
  if (has('postToStatus')) s.postToStatus = !!i.postToStatus;

  if (has('postTime') && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(i.postTime))) s.postTime = String(i.postTime);
  if (has('timezone') && validZone(String(i.timezone))) s.timezone = String(i.timezone);
  if (has('itemsPerDay')) s.itemsPerDay = Math.round(num(i.itemsPerDay, s.itemsPerDay, 1, 500));
  if (has('pickOrder')) s.pickOrder = oneOf(i.pickOrder, ['oldest', 'newest'], s.pickOrder);
  if (has('gapMinMinutes')) s.gapMinMinutes = num(i.gapMinMinutes, s.gapMinMinutes, 0, 120);
  if (has('gapMaxMinutes')) s.gapMaxMinutes = num(i.gapMaxMinutes, s.gapMaxMinutes, 0, 120);
  if (s.gapMaxMinutes < s.gapMinMinutes) s.gapMaxMinutes = s.gapMinMinutes;
  if (has('recentHours')) s.recentHours = Math.round(num(i.recentHours, s.recentHours, 1, 24));
  if (has('bundleWaitSeconds')) s.bundleWaitSeconds = Math.round(num(i.bundleWaitSeconds, s.bundleWaitSeconds, 10, 600));

  if (has('categories')) {
    const list = Array.isArray(i.categories) ? i.categories : String(i.categories).split(/[,\n]/);
    s.categories = [...new Set(list.map(normaliseName).filter((w) => w.length >= 2 && w !== OTHER))].slice(0, 30);
  }
  if (has('rotateCategories')) s.rotateCategories = !!i.rotateCategories;
  if (has('rotationAnchorDay')) s.rotationAnchorDay = /^\d{4}-\d{2}-\d{2}$/.test(String(i.rotationAnchorDay)) ? String(i.rotationAnchorDay) : '';
  if (has('rotationAnchorName')) s.rotationAnchorName = normaliseName(i.rotationAnchorName);
  if (has('categoryFallback')) s.categoryFallback = !!i.categoryFallback;

  if (has('showSizes')) s.showSizes = !!i.showSizes;
  if (has('profitPercent')) s.profitPercent = num(i.profitPercent, s.profitPercent, 0, 1000);
  if (has('profitFixed')) s.profitFixed = num(i.profitFixed, s.profitFixed, 0, 10_000_000);
  if (has('minProfit')) s.minProfit = num(i.minProfit, s.minProfit, 0, 10_000_000);
  if (has('roundUpTo') && ROUND_OPTIONS.includes(Number(i.roundUpTo))) s.roundUpTo = Number(i.roundUpTo);
  if (has('currency')) s.currency = String(i.currency).trim().slice(0, 5) || DEFAULTS.currency;
  if (has('postItemsWithoutPrice')) s.postItemsWithoutPrice = !!i.postItemsWithoutPrice;

  if (has('template')) s.template = text(i.template, 1500, DEFAULTS.template);
  if (has('priceSingle')) s.priceSingle = /\{price\}/i.test(String(i.priceSingle)) ? text(i.priceSingle, 100, DEFAULTS.priceSingle) : DEFAULTS.priceSingle;
  if (has('priceMulti')) s.priceMulti = /\{price\}/i.test(String(i.priceMulti)) ? text(i.priceMulti, 100, DEFAULTS.priceMulti) : DEFAULTS.priceMulti;
  if (has('businessName')) s.businessName = String(i.businessName).trim().slice(0, 80);
  if (has('footer')) s.footer = String(i.footer).slice(0, 500);
  if (has('captionLanguage')) s.captionLanguage = text(i.captionLanguage, 60, DEFAULTS.captionLanguage).trim();
  if (has('emojiLevel')) s.emojiLevel = oneOf(i.emojiLevel, ['none', 'few', 'lots'], s.emojiLevel);
  if (has('captionLength')) s.captionLength = oneOf(i.captionLength, ['short', 'medium', 'long'], s.captionLength);
  if (has('hashtags')) s.hashtags = !!i.hashtags;
  if (has('captionStyle')) s.captionStyle = String(i.captionStyle).slice(0, 500);
  if (has('captionExample')) s.captionExample = String(i.captionExample).slice(0, 1500);
  if (has('removePhrases')) {
    const list = Array.isArray(i.removePhrases) ? i.removePhrases : String(i.removePhrases).split(/[,\n]/);
    s.removePhrases = [...new Set(list.map((w) => String(w).trim().toLowerCase().slice(0, 60)).filter(Boolean))].slice(0, 100);
  }
  if (has('captionPlacement')) s.captionPlacement = oneOf(i.captionPlacement, ['first', 'last', 'all'], s.captionPlacement);
  if (has('reviewBeforeSending')) s.reviewBeforeSending = !!i.reviewBeforeSending;
  if (has('extraBlockedWords')) {
    const list = Array.isArray(i.extraBlockedWords) ? i.extraBlockedWords : String(i.extraBlockedWords).split(/[,\n]/);
    s.extraBlockedWords = [...new Set(list.map((w) => String(w).trim().toLowerCase()).filter(Boolean))].slice(0, 100);
  }
  return s;
}

export function createSettings(store) {
  let cache = null;
  function load() {
    let saved = {};
    try {
      saved = JSON.parse(store.getKv('settings') || '{}');
    } catch {
      saved = {};
    }
    cache = sanitize(saved, DEFAULTS);
    // Version 2: every picture of a set carries the caption (older versions put it on the last one only).
    if ((saved.settingsVersion || 1) < SETTINGS_VERSION) {
      cache.captionPlacement = 'all';
      store.setKv('settings', JSON.stringify({ ...cache, settingsVersion: SETTINGS_VERSION }));
    }
    return cache;
  }
  return {
    get() {
      return cache || load();
    },
    save(patch) {
      const next = sanitize(patch, this.get());
      store.setKv('settings', JSON.stringify({ ...next, settingsVersion: SETTINGS_VERSION }));
      cache = next;
      return next;
    },
  };
}
