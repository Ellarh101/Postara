// Word checks, price reading and price maths. No network, no database: easy to test.

// Clear underwear words. A post containing one of these is never posted.
const HARD_BLOCK = [
  'bra', 'bras', 'brassiere', 'brassieres', 'bralette', 'bralettes',
  'boxer', 'boxers', 'briefs', 'panty', 'panties', 'knickers',
  'underwear', 'underwears', 'underpant', 'underpants', 'undies',
  'lingerie', 'thong', 'thongs', 'g-string', 'gstring', 'jockstrap',
];
// "pants" can mean underwear or trousers, so it needs a closer look (the AI looks at the picture).
const AMBIGUOUS = ['pant', 'pants'];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordRegex(words) {
  if (!words.length) return null;
  const alt = words.map(escapeRe).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, 'iu');
}

const HARD_RE = wordRegex(HARD_BLOCK);
const AMBIG_RE = wordRegex(AMBIGUOUS);

export function checkWords(text, extraWords = []) {
  const t = String(text || '');
  const hard = t.match(HARD_RE);
  if (hard) return { blocked: true, ambiguous: false, word: hard[0].toLowerCase() };
  const extraRe = wordRegex(extraWords);
  const extra = extraRe && t.match(extraRe);
  if (extra) return { blocked: true, ambiguous: false, word: extra[0].toLowerCase() };
  const amb = t.match(AMBIG_RE);
  if (amb) return { blocked: false, ambiguous: true, word: amb[0].toLowerCase() };
  return { blocked: false, ambiguous: false, word: null };
}

// ---------- prices ----------

export function toAmount(numStr, suffix) {
  let n = parseFloat(String(numStr).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const s = (suffix || '').toLowerCase();
  if (s === 'k') n *= 1000;
  if (s === 'm') n *= 1000000;
  return Math.round(n);
}

const NUM = '(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?';
const PRICE_PATTERNS = [
  // ₦8,500  #8500  N8500  NGN 8,500  ₦8.5k
  new RegExp(`(?:₦|\\bNGN\\s?|#|\\bN)\\s?${NUM}(?:\\s?(k|m))?\\b`, 'gi'),
  // 8500 naira, 8.5k naira, 8,500 NGN
  new RegExp(`\\b${NUM}(?:\\s?(k|m))?\\s?(?:naira|ngn)\\b`, 'gi'),
  // 8.5k, 12k
  new RegExp(`\\b${NUM}\\s?(k|m)\\b`, 'gi'),
  // price: 8500 / only 8500 / @8500 / cost - 8500
  new RegExp(`(?:\\b(?:price|prize|amount|cost|only|for)\\b|@)\\s*[:=-]?\\s*${NUM}(?:\\s?(k|m))?\\b`, 'gi'),  // 8,500 (a number with thousands commas)
  new RegExp(`\\b(\\d{1,3}(?:,\\d{3})+)(\\.\\d+)?\\b`, 'g'),
  // Red - 8500, Blue: 9000, Big @ 12000 (a 4 to 6 digit number after a dash, colon or @)
  new RegExp(`[-–—:=@]\\s*(\\d{4,6})(?![\\d,])()\\b`, 'g'),
];

export function findPrices(text) {
  const t = String(text || '');
  const hits = [];
  for (const re of PRICE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const intPart = m[1];
      const frac = m[2] || '';
      const suffix = m[3] || '';
      const amount = toAmount(intPart + frac, suffix);
      const plainDigits = intPart.replace(/,/g, '');
      if (amount === null || amount < 100 || amount > 50_000_000) continue;
      if (!suffix && plainDigits.length >= 9) continue; // looks like a phone number
      // "N" or "for" followed by a non-price number like a size: ignore tiny numbers handled by amount < 100
      hits.push({ amount, start: m.index, end: m.index + m[0].length, raw: m[0] });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && h.start < last.end) continue; // overlaps an earlier, longer match
    out.push(h);
  }
  return out;
}

// Price you post = vendor price + your profit, rounded up.
// profit = percent of the price, plus a fixed amount, and never less than the minimum profit.
export function applyMarkup(amount, { percent = 0, fixed = 0, minProfit = 0, roundTo = 1 } = {}) {
  let price = (amount * (100 + percent)) / 100 + fixed;
  if (price - amount < minProfit) price = amount + minProfit;
  const step = roundTo > 0 ? roundTo : 1;
  return Math.ceil(price / step - 1e-9) * step;
}

export function formatMoney(amount, symbol = '₦') {
  return `${symbol}${Math.round(amount).toLocaleString('en-US')}`;
}

// ---------- reading a vendor caption: description + price lines ----------

const PHONE_RE = /(?:\+?234|\b0)[\s-]?[789][01]\d[\s-]?\d{3}[\s-]?\d{4}|\+?\d[\d\s-]{8,}\d/g;
const LINK_RE = /(https?:\/\/\S+|wa\.me\/\S+|www\.\S+|chat\.whatsapp\.com\/\S+)/gi;
const BOILERPLATE_RE = /\b(dm|call|whatsapp|contact|inbox|order now|to order|hit me up|link in bio|follow us|good (morning|afternoon|evening))\b/i;
const PRICE_HEADING_RE = /^[\s\p{P}\p{S}]*(prices?|price list|amount|cost)[\s\p{P}\p{S}]*$/iu;
const EDGE_JUNK_RE = /^[\s\-–—:=@|•*·>→/,.\u2705\u2714\uFE0F\u{1F449}\u{1F538}\u{1F539}\u25AA]+|[\s\-–—:=@|•*·>→/,.]+$/gu;
const FILLER_WORDS_RE = /(?:^|\s)(price|prize|only|at|for|is|now|just|each|per|cost|amount|bg|bargain|negotiable|fixed)$/i;

const MOQ_RE = /\b(?:moq|min(?:imum)?\.?\s*order(?:\s*qty)?)\b\D{0,12}?(\d+)/i;

function cleanLabel(text) {
  const moq = text.match(MOQ_RE);
  if (moq) return `Buy ${moq[1]} or more`;
  let t = text.replace(EDGE_JUNK_RE, '').trim();
  for (let i = 0; i < 4; i++) {
    const next = t.replace(FILLER_WORDS_RE, '').replace(EDGE_JUNK_RE, '').trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

// Splits a vendor caption into the product description and the price lines.
// "Red - 8,500 / Blue - 9,000" becomes two entries; everything else stays as description.
export function splitCaption(caption) {
  const cleaned = String(caption || '').split(/\r?\n/).map((raw) => raw.replace(LINK_RE, '').replace(PHONE_RE, '').trim());
  const onlyOnePrice = cleaned.reduce((n, line) => n + findPrices(line).length, 0) === 1;
  const desc = [];
  const entries = [];
  for (const line of cleaned) {
    if (!line) { desc.push(''); continue; }
    const prices = findPrices(line);
    if (!prices.length) {
      if (BOILERPLATE_RE.test(line) && line.length < 60) continue;
      if (PRICE_HEADING_RE.test(line)) continue;
      desc.push(line);
      continue;
    }
    let cursor = 0;
    for (const p of prices) {
      let label = cleanLabel(line.slice(cursor, p.start));
      // one price with a lead-in ("Beautiful ankara gown only N8,500"): the lead-in is description, not a label
      if (onlyOnePrice && label.split(/\s+/).filter(Boolean).length >= 2) {
        desc.push(label);
        label = '';
      }
      entries.push({ label, amount: p.amount });
      cursor = p.end;
    }
    const tail = cleanLabel(line.slice(cursor));
    if (tail) desc.push(tail); // text after the price, like "sizes 12-18", is description
  }
  const description = desc.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { description, entries };
}

// ---------- building the final caption ----------

const fill = (tpl, vars) => tpl.replace(/\{(label|price)\}/gi, (_, k) => vars[k.toLowerCase()] ?? '');

// entries: [{ label, final }]. One unlabelled price uses "Price: {price}"; several use one line each.
export function formatPriceBlock(entries, s) {
  if (!entries.length) return '';
  const money = (n) => formatMoney(n, s.currency);
  const allSame = entries.every((e) => e.final === entries[0].final && !e.label);
  if (allSame || (entries.length === 1 && !entries[0].label)) return fill(s.priceSingle, { price: money(entries[0].final) });
  return entries
    .map((e) => (e.label ? fill(s.priceMulti, { label: e.label, price: money(e.final) }) : fill(s.priceSingle, { price: money(e.final) })))
    .join('\n');
}

const TOKEN_RE = /\{(title|colours|colors|sizes|details|description|prices|footer|business)\}/gi;

// Fills your layout. A line made only of empty fields (for example "Sizes: {sizes}" when the vendor gave no
// sizes) is left out, so posts never show blank labels.
export function renderTemplate(template, tokens) {
  const value = (k) => {
    const key = k.toLowerCase() === 'colors' ? 'colours' : k.toLowerCase();
    return tokens[key] ?? '';
  };
  const lines = [];
  for (const line of template.split('\n')) {
    const found = [...line.matchAll(TOKEN_RE)].map((m) => m[1]);
    if (found.length && found.every((k) => !String(value(k)).trim())) continue;
    lines.push(line.replace(TOKEN_RE, (_, k) => value(k)).replace(/[ \t]+$/g, ''));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- your style: words to strip, and fields pulled out of a description ----------

const escapeRe2 = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SYMBOLS = '[\\p{Extended_Pictographic}\\uFE0F\\s*|•!\\-–—]*';

// Removes the words and phrases you never want in a post ("new arrival", "luxury"...),
// together with the emojis and dashes stuck to them, and drops lines that end up empty.
export function stripPhrases(text, phrases = []) {
  const list = phrases.map((p) => String(p).trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!list.length || !text) return text;
  const re = new RegExp(`${SYMBOLS}(?<![\\p{L}\\p{N}])(?:${list.map(escapeRe2).join('|')})s?(?![\\p{L}\\p{N}])${SYMBOLS}`, 'giu');
  const out = [];
  for (const line of String(text).split('\n')) {
    const cleaned = line.replace(re, ' ');
    if (cleaned === line) { out.push(line); continue; }
    const tidy = cleaned.replace(/\s{2,}/g, ' ').replace(/^[\s\-–—:|•*,!.]+|[\s\-–—:|•*,]+$/g, '').trim();
    if (/[\p{L}\p{N}]/u.test(tidy)) out.push(tidy); // a line that was only fluff disappears
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Pulls the named parts out of a description so your layout can place them where you want.
export function extractFields(description) {
  const lines = String(description || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const title = lines[0] || '';
  let colours = '';
  let sizes = '';
  const details = [];
  for (const line of lines.slice(1)) {
    let m;
    if (!colours && (m = line.match(/^(?:available\s+in|colou?rs?)\s*[:\-=]?\s*(.+)$/i))) { colours = m[1].trim(); continue; }
    if (!sizes && (m = line.match(/^(?:sizes?|ages?)\s*[:\-=]?\s*(.+)$/i))) { sizes = m[1].trim(); continue; }
    details.push(line);
  }
  return { title, colours, sizes, details: details.join('\n') };
}

// ---------- sizes ----------

// One way of writing a size range: "37———41", "37–41" and "37 to 41" all become "37-41".
export function cleanSizes(text) {
  return String(text ?? '')
    .replace(/(\d)\s*(?:[-\u2010-\u2015\u2212]+|\bto\b)\s*(\d)/gi, '$1-$2')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:=\-]+|[\s,;:.\-]+$/g, '')
    .trim();
}

// Finds the sizes in a vendor caption: "SIZE RANGE 37-41", "Sizes: 2-7", "size 38 39 40", "Ages 1-7 years".
// Used when the AI leaves the sizes out. Returns '' when the vendor gave none.
export function extractSizes(text) {
  for (const raw of String(text || '').split('\n')) {
    const m = /(?:^|[\s:*(])(?:sizes?|ages?)(?:\s+range)?\s*[:=\-\u2013\u2014]*\s*(.+)$/i.exec(raw.trim());
    if (!m) continue;
    // stop where the price or other wording starts on the same line
    const value = cleanSizes(m[1].split(/\s*\d{1,3},\d{3}|\s\d{4,}|[\u20A6#@]|\s(?:price|cost|only|at|in store)\b/i)[0]);
    if (value && value.length <= 40 && /\d|(?:^|[\s,/-])(?:xs|s|m|l|xl|xxl|xxxl|free)(?:$|[\s,/-])/i.test(value)) return value;
  }
  return '';
}
