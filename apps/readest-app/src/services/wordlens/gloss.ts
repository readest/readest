// Runtime gloss normalization + English derivational reduction for Word Lens.
//
// These run against the shipped (already-trimmed) gloss packs — no regeneration.
// `cleanGloss` shortens what a reader sees; `baseFormCandidates` +
// `glossesShareMeaning` let a transparent derivation (lazily ⇐ lazy) inherit its
// base's difficulty so it isn't hinted when the base is already known.

// Leading dictionary POS tags: "a." "vt." "interj." (≤6 letters so interj. is covered).
const LEADING_POS = /^\s*(?:[a-zA-Z]{1,6}\.\s*)+/;
// Sense separators in both the zh packs ("，；、") and the en-target packs (",;/").
const SENSE_SEPARATORS = /[,，、;；/]/;
const MAX_GLOSS_LEN = 24;

/** First sense only, POS/bracket/classifier noise stripped, length-capped. */
export function cleanGloss(gloss: string): string {
  if (!gloss) return '';
  const firstSense = gloss.split(SENSE_SEPARATORS)[0] ?? '';
  return firstSense
    .replace(LEADING_POS, '')
    .replace(/\[[^\]]*\]/g, '') // [ge4] pinyin / [医] domain tags
    .replace(/\bCL:.*$/, '') // CC-CEDICT classifier clause
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_GLOSS_LEN);
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
