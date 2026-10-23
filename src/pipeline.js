// Turns a raw vendor post (pictures + caption) into a ready-to-send post:
// filter, price + profit, and a caption laid out the way you chose.
import { AiTemporaryError } from './ai.js';
import { classifyByWords, pickCategory } from './categories.js';
import { dropCutOffEnd, tidyCaption } from './tidy.js';
import { cleanSizes, extractSizes } from './filters.js';
import { applyMarkup, checkWords, extractFields, formatPriceBlock, renderTemplate, splitCaption, stripPhrases } from './filters.js';

const MAX_AI_ATTEMPTS = 5;

const sameAmounts = (a, b) => {
  if (a.length !== b.length) return false;
  const x = [...a].sort((m, n) => m - n);
  const y = [...b].sort((m, n) => m - n);
  return x.every((v, i) => v === y[i]);
};

function numberShownIn(text, amount) {
  const flat = text.replace(/,/g, '');
  if (new RegExp(`(?<![\\d.])${amount}(?![\\d])`).test(flat)) return true;
  return amount % 1000 === 0 && new RegExp(`(?<![\\d.])${amount / 1000}\\s?k\\b`, 'i').test(flat);
}

// Up to four pictures spread across the set, so the AI sees the whole post without a huge request.
function pickThumbs(files, max = 4) {
  const withThumb = files.filter((f) => f.thumb_path);
  if (withThumb.length <= max) return withThumb;
  return Array.from({ length: max }, (_, i) => withThumb[Math.round((i * (withThumb.length - 1)) / (max - 1))]);
}

export function profitFor(settings, vendorJid) {
  const vendor = settings.vendorChats.find((v) => v.jid === vendorJid);
  return {
    percent: vendor?.profitPercent ?? settings.profitPercent,
    fixed: settings.profitFixed,
    minProfit: settings.minProfit,
    roundTo: settings.roundUpTo,
  };
}

// Builds the caption from the named parts of the post and the vendor's price entries, using the seller's layout.
// fields: { title, colours, sizes, details, description }
// True when the sizes already appear in the text, so they are not repeated.
const alreadyMentions = (text, sizes) => {
  const norm = (t) => String(t || '').toLowerCase().replace(/[\s\u2013\u2014]/g, '');
  return !!sizes && norm(text).includes(norm(sizes));
};

export function composeCaption({ fields, entries, settings, vendorJid }) {
  const profit = profitFor(settings, vendorJid);
  const lines = entries.map((e) => ({ label: e.label, vendor: e.amount, final: applyMarkup(e.amount, profit) }));
  const prices = formatPriceBlock(lines.map((l) => ({ label: l.label, final: l.final })), settings);
  // When the vendor gave sizes (shoes: 37-41), they always reach the caption, even if the layout has no {sizes} line.
  let template = settings.template;
  const sizes = String(fields.sizes || '').trim();
  if (settings.showSizes !== false && sizes && !/\{sizes\}/i.test(template)
    && !alreadyMentions(`${fields.description} ${fields.details}`, sizes)) {
    template = /\{prices\}/i.test(template) ? template.replace(/\{prices\}/i, 'Sizes: {sizes}\n\n{prices}') : `${template}\n\nSizes: {sizes}`;
  }
  const caption = renderTemplate(template, {
    ...fields, prices, footer: settings.footer.trim(), business: settings.businessName,
  });
  return { caption, lines };
}

export function createPipeline({ store, getSettings, ai }) {
  async function processItem(id, { force = false } = {}) {
    const item = store.getItem(id);
    if (!item) return;
    const settings = getSettings();
    const original = item.original_caption || '';

    // 1. Clear underwear words: skip straight away, no AI cost.
    const words = checkWords(original, settings.extraBlockedWords);
    if (!force && words.blocked) {
      store.updateItem(id, { status: 'skipped', note: `Skipped: caption mentions "${words.word}"` });
      return;
    }

    // 2. The caption is always written fresh by the AI helper. Without one, the post simply waits.
    if (!ai.isEnabled()) {
      store.updateItem(id, {
        process_after: Date.now() + 120_000,
        note: 'Waiting for an AI helper. Add a key in Settings and this post will be prepared automatically.',
      });
      return;
    }

    // Words you never want are cut out first; prices are read from the vendor text (facts, not wording).
    const cleaned = stripPhrases(original, settings.removePhrases);
    const byPattern = splitCaption(cleaned);
    // What the AI reads: no underscores or rows of hyphens, and no word cut off at the end.
    const forAi = dropCutOffEnd(tidyCaption(cleaned));
    const notes = [];
    let needsReview = false;
    let result = null;

    try {
      result = await ai.analyze({
        caption: forAi,
        thumbs: pickThumbs(item.files).map((f) => store.thumbBase64(f.thumb_path)).filter(Boolean),
        prefs: {
          language: settings.captionLanguage, emojiLevel: settings.emojiLevel, length: settings.captionLength,
          hashtags: settings.hashtags, style: settings.captionStyle, business: settings.businessName,
          example: settings.captionExample.trim(), removePhrases: settings.removePhrases,
          categories: settings.categories,
        },
      });
    } catch (e) {
      const attempts = item.process_attempts + 1;
      if (e instanceof AiTemporaryError && attempts < MAX_AI_ATTEMPTS) {
        store.updateItem(id, { process_attempts: attempts, process_after: Date.now() + 3 * 60_000 });
        store.log('warn', `Post #${id}: ${e.message}. Will try again in 3 minutes.`);
        return;
      }
      store.log('error', `Post #${id}: the AI helper failed (${e.message}).`);
      notes.push(`The AI helper could not write this post (${e.message}). Write the caption yourself, or try again later.`);
      needsReview = true;
    }

    let fields = { title: '', colours: '', sizes: '', details: '', description: '' };
    let entries = byPattern.entries; // the vendor's prices, if the AI could not help
    if (result) {
      if (!force && result.isUnderwear) {
        store.updateItem(id, { status: 'skipped', note: `Skipped: looks like underwear (${result.itemType || 'AI check'})` });
        return;
      }
      const derived = extractFields(result.description);
      fields = {
        title: result.title || derived.title,
        colours: result.colours || derived.colours,
        sizes: result.sizes || derived.sizes,
        details: result.details || derived.details,
        description: result.description,
      };
      entries = result.entries;
      const found = byPattern.entries.map((e) => e.amount);
      const said = entries.map((e) => e.amount);
      if (found.length && !said.length) {
        entries = byPattern.entries;
        notes.push('A price was found in the caption but the AI did not report one. Please check the price.');
        needsReview = true;
      } else if (found.length && !sameAmounts(found, said)) {
        notes.push(`Price check: the AI read ${said.join(', ')} but the caption pattern says ${found.join(', ')}. Please confirm.`);
        needsReview = true;
      }
    } else if (words.ambiguous) {
      needsReview = true;
    }

    if (!entries.length && !settings.postItemsWithoutPrice && !force) {
      store.updateItem(id, { status: 'skipped', note: 'Skipped: no price found in the vendor post.' });
      return;
    }

    // Sizes: what the AI read, else what the description says, else the vendor's own words ("SIZE RANGE 37-41").
    fields.sizes = cleanSizes(fields.sizes) || extractSizes(forAi);

    // Enforce the removed words even if the AI slipped one in.
    for (const k of Object.keys(fields)) fields[k] = tidyCaption(stripPhrases(fields[k], settings.removePhrases));
    const { caption, lines } = composeCaption({ fields, entries, settings, vendorJid: item.vendor_jid });

    // The vendor's own price must not survive in the text we write.
    const finals = lines.map((l) => l.final);
    const leaked = lines.some((l) => !finals.includes(l.vendor) && numberShownIn(fields.description, l.vendor));
    if (leaked) {
      notes.push("The vendor's own price may still appear in the caption. Please check.");
      needsReview = true;
    }

    // Which of the seller's categories this is (bags, shoes...). The AI says; the words are the back-up.
    const category = pickCategory(result?.category, `${result?.itemType || ''} ${fields.title} ${original}`, settings.categories);

    store.updateItem(id, {
      final_caption: caption,
      category,
      price_lines: lines,
      status: settings.reviewBeforeSending || needsReview ? 'needs_review' : 'approved',
      note: notes.join(' '),
    });
  }

  async function processDue() {
    for (const id of store.dueIncoming(Date.now())) {
      try {
        await processItem(id);
      } catch (e) {
        store.log('error', `Post #${id} could not be prepared: ${e.message}`);
        store.updateItem(id, { status: 'needs_review', note: `Could not be prepared automatically: ${e.message}. Write the caption yourself.`, final_caption: '' });
      }
    }
  }

  // Gives a category to waiting posts that have none, by the words in their captions. Cheap, no AI.
  // Used at start-up and whenever the list of categories changes.
  function reclassify() {
    const cats = getSettings().categories;
    if (!cats.length) return 0;
    return store.fillCategories(cats, (i) => classifyByWords(`${i.original_caption} ${i.final_caption}`, cats));
  }

  return { processItem, processDue, reclassify };
}
