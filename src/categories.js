// Product categories: which category is "today's" in the rotation, and a word-based guess
// for posts the AI did not label (or that were prepared before categories existed).

// A name the seller cannot use for her own category: "other" means "none of my categories".
export const OTHER = 'other';

export function normaliseName(v) {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
}

// '2026-10-20' -> number of days since 1970. Works on plain dates, so there are no clock-change surprises.
export function dayNumber(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// The category to post on `day` (a local 'YYYY-MM-DD'), or null when the rotation is off.
// The rotation is remembered as "on <anchor day>, the category was <anchor name>"; every day moves one step on.
export function todaysCategory(s, day) {
  if (!s.rotateCategories || !s.categories.length) return null;
  const n = s.categories.length;
  const start = Math.max(0, s.categories.indexOf(s.rotationAnchorName));
  const anchor = DAY_RE.test(s.rotationAnchorDay || '') ? s.rotationAnchorDay : day;
  const steps = dayNumber(day) - dayNumber(anchor);
  return s.categories[(((start + steps) % n) + n) % n];
}

// How long a vendor post is kept: the last day at most. Older posts are skipped, hidden and deleted.
export function keepHours(s) {
  return Math.min(24, s.recentHours);
}

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Looks for a category name (or its singular/plural) in the text. The one mentioned first wins.
export function classifyByWords(text, categories) {
  const hay = String(text || '').toLowerCase();
  let best = null;
  for (const name of categories) {
    const forms = new Set([name]);
    if (name.endsWith('es')) forms.add(name.slice(0, -2));
    if (name.endsWith('s')) forms.add(name.slice(0, -1));
    const alt = [...forms].filter((f) => f.length >= 2).map(esc).join('|');
    if (!alt) continue;
    const m = new RegExp(`(?<![a-z])(?:${alt})(?:s|es)?(?![a-z])`).exec(hay);
    if (m && (!best || m.index < best.index)) best = { name, index: m.index };
  }
  return best ? best.name : '';
}

// The AI's choice if it is one of the seller's categories, otherwise a guess from the words. '' means "other".
export function pickCategory(aiCategory, text, categories) {
  const a = normaliseName(aiCategory);
  if (a && categories.includes(a)) return a;
  return classifyByWords(text, categories);
}
