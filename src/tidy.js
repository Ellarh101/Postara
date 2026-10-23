// Cleans up the wording of a vendor caption: no underscores, no rows of hyphens, no cut-off word at the end.

const DASH = '[-\\u2010-\\u2015\\u2212]'; // hyphen, other dashes and the minus sign
const RUN = new RegExp(`[ \\t]*${DASH}(?:[ \\t]*${DASH})+[ \\t]*`, 'g'); // two or more in a row, also "- - -"
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

// Underscores go. A row of hyphens becomes a single hyphen when it sits between two things (2--4 -> 2-4),
// and disappears when it is only decoration (----- lines, "-- " at the start of a line).
// A single hyphen is never touched.
export function tidyCaption(text) {
  let t = String(text ?? '');
  // lines that are only a row of hyphens or underscores are dropped completely
  t = t.split('\n').filter((line) => !/^[ \t]*(?:[_\-\u2010-\u2015\u2212][ \t]*){2,}$/.test(line)).join('\n');
  t = t.replace(/_+/g, ' ');
  t = t.replace(RUN, (m, offset, whole) => {
    const before = /(\S)[ \t]*$/.exec(whole.slice(0, offset));
    const after = /^[ \t]*(\S)/.exec(whole.slice(offset + m.length));
    if (!before || !after || !LETTER_OR_DIGIT.test(before[1]) || !LETTER_OR_DIGIT.test(after[1])) return ' '; // decoration
    if (/\d/.test(before[1]) && /\d/.test(after[1])) return '-'; // 2--4 and 2 -- 4 both become 2-4
    return /^[ \t]/.test(m) && /[ \t]$/.test(m) ? ' - ' : '-';
  });
  return t
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Two-letter endings that are real words, sizes or units. Anything else at the very end is treated as a cut-off word.
const COMPLETE = new Set([
  'xl', 'xs', 'ok', 'pm', 'am', 'tv', 'uk', 'us', 'id', 'no', 'go', 'me', 'up', 'oh', 'hi', 'pc', 'is', 'it', 'on', 'in',
  'at', 'to', 'of', 'or', 'by', 'as', 'an', 'if', 'so', 'we', 'be', 'my', 'he', 'do', 'ng', 'na', 'ya', 'yo', 'ah', 'ha',
  'eh', 'ph', 'dm', 'cm', 'kg', 'mm', 'ft', 'ml', 'gb', 'ac', 'lg', 'hp', 'fc', 'ex', 'vs', 'op', 'pr',
]);

// Vendor captions are sometimes cut off mid-word ("... available in fi"). A last word of two letters that is not
// a real word is removed, together with a trailing "..." if it has one.
export function dropCutOffEnd(text) {
  const t = String(text ?? '');
  const m = /(?:^|\s)([A-Za-z]{2})(?:\.{2,}|…)?[ \t]*$/.exec(t);
  if (!m || COMPLETE.has(m[1].toLowerCase())) return t;
  return t.slice(0, m.index).trimEnd();
}
