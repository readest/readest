// Runtime gloss normalization + English derivational reduction for Word Lens.
//
// These run against the shipped (already-trimmed) gloss packs — no regeneration.
// `cleanGloss` shortens what a reader sees; `baseFormCandidates` +
// `glossesShareMeaning` let a transparent derivation (lazily ⇐ lazy) inherit its
// base's difficulty so it isn't hinted when the base is already known.

// Leading dictionary POS tags: "a." "vt." "interj." (≤6 letters so interj. is covered).
const LEADING_POS = /^\s*(?:[a-zA-Z]{1,6}\.\s*)+/;
// Sense separators: ";" "；" "/". Commas are NOT here — within a cross-lingual sense
// "，"/","/"、" separate near-synonyms, of which only the first is kept.
const SENSE_SEPARATORS = /[;；/]/;
const SYNONYM_SEPARATORS = /[,，、]/;
// DISPLAY length cap. Lives here (not in the build), so changing it does NOT require
// regenerating the gloss packs — they store the full hint and this trims it.
const MAX_GLOSS_LEN = 24;

const capForDisplay = (s: string): string =>
  s.length <= MAX_GLOSS_LEN ? s : s.slice(0, MAX_GLOSS_LEN - 1).trimEnd() + '…';

/**
 * Normalize a stored gloss for display, applying the length cap (the packs store the
 * full hint; the cap is applied here so it can change without regenerating them).
 *
 * Cross-lingual (word) packs: keep at most the first TWO senses; within each sense
 * keep only the first near-synonym (so "阻止, 监禁, 拘留；隔离, 拘留, 滞留" → "阻止；隔离"),
 * POS/bracket/classifier noise stripped, joined by "；".
 *
 * Monolingual (en-en) packs hold the final hint already (a synonym/category, or a
 * ≤2-sense definition where "," is intra-sense content) — so they must NOT be
 * sense/synonym-split here; just normalize whitespace, then cap.
 */
export function cleanGloss(gloss: string, monolingual = false): string {
  if (!gloss) return '';
  if (monolingual) return capForDisplay(gloss.replace(/\s+/g, ' ').trim());
  const senses = gloss
    .split(SENSE_SEPARATORS)
    .map((sense) =>
      sense
        .replace(LEADING_POS, '')
        .replace(/\[[^\]]*\]/g, '') // [ge4] pinyin / [医] domain tags
        .replace(/\bCL:.*$/, '') // CC-CEDICT classifier clause
        .replace(/\s+/g, ' ')
        .trim()
        .split(SYNONYM_SEPARATORS)[0]! // first near-synonym within the sense
        .trim(),
    )
    .filter(Boolean);
  const out = [...new Set(senses)] // dedupe: two senses can share a first synonym
    .slice(0, 2)
    .join('；');
  return capForDisplay(out);
}

// Reverse-derivation rules. Over-generate candidates ("all possibilities"); the
// caller validates each against the index + gloss overlap, so wrong guesses are
// harmless. English-only morphology — gated to English-source packs by the caller.
export function baseFormCandidates(word: string): string[] {
  const w = word.toLowerCase();
  const out = new Set<string>();
  const add = (x: string) => {
    if (x.length >= 2) out.add(x);
  };
  if (w.endsWith('ily') && w.length >= 5) add(w.slice(0, -3) + 'y'); // lazily → lazy
  if (w.endsWith('ly') && w.length >= 4) {
    add(w.slice(0, -2)); // shyly → shy
    add(w.slice(0, -2) + 'e'); // nicely → nice
  }
  if (w.endsWith('ful') && w.length >= 5) {
    add(w.slice(0, -3)); // sorrowful → sorrow
    add(w.slice(0, -4) + 'y'); // beautiful → beauty
  }
  if (w.endsWith('wards') && w.length >= 6) {
    add(w.slice(0, -1)); // downwards → downward
    add(w.slice(0, -5)); // downwards → down
  } else if (w.endsWith('ward') && w.length >= 5) {
    add(w.slice(0, -4)); // inward → in
  }
  if (w.endsWith('ness') && w.length >= 5) {
    add(w.slice(0, -4)); // kindness → kind
    add(w.slice(0, -5) + 'y'); // happiness → happy
  }
  if (w.endsWith('less') && w.length >= 5) add(w.slice(0, -4)); // harmless → harm
  if ((w.endsWith('able') || w.endsWith('ible')) && w.length >= 6) {
    add(w.slice(0, -4)); // comfortable → comfort, sufferable → suffer
    add(w.slice(0, -4) + 'e'); // sensible → sense, lovable → love
  }
  // Negative/reversive prefixes (unhappy → happy, insufferable → suffer once -able is
  // stripped above): peel the prefix off the word and off each suffix candidate.
  for (const stem of [w, ...out]) {
    for (const p of ['un', 'in', 'im', 'ir', 'il']) {
      if (stem.startsWith(p) && stem.length - p.length >= 3) add(stem.slice(p.length));
    }
  }
  out.delete(w);
  return [...out];
}

// Particles that carry no lexical content; dropped before the overlap test so a
// shared 的/地 can't fake a match.
const PARTICLES = /[的地得了着之吗呢啊，,；;、。.\s/]/g;
const HAN = /\p{Script=Han}/u;

/**
 * Do two glosses share core meaning? Used to confirm a derivation is transparent
 * (knowing the base really does mean knowing the derived form). CJK glosses match
 * on a shared Han character; Latin-script glosses match on a shared word (≥3 letters).
 */
/**
 * Does a derived word's gloss literally mention its base form as a whole word?
 * For en-en (definition) packs the base/derived glosses rarely share a word, but a
 * transparent derivation's definition often names the base ("thickly" → "in a thick
 * manner"), which is a strong signal it's transparent and should inherit the rank.
 */
export function glossMentionsWord(gloss: string, word: string): boolean {
  if (!gloss || word.length < 3) return false;
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(gloss);
}

export function glossesShareMeaning(a: string, b: string): boolean {
  const an = (a || '').replace(PARTICLES, '');
  const bn = (b || '').replace(PARTICLES, '');
  if (!an || !bn) return false;
  const hanChars = [...an].filter((ch) => HAN.test(ch));
  if (hanChars.length) return hanChars.some((ch) => bn.includes(ch));
  const wordsA = a.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const wordsB = new Set(b.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  return wordsA.some((w) => wordsB.has(w));
}
