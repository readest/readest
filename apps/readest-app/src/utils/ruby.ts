// Ruby (furigana) helpers shared by TTS text extraction and TTS highlighting.
//
// Japanese kanji readings are not derivable from the base characters: most
// kanji have several readings picked by context, proper names follow no rule
// at all, fiction authors deliberately assign readings (義訓 — 神聖文字 glossed
// as ヒエログリフ), and older EPUBs render rare kanji as an <img> so the base
// carries no text whatsoever. The <rt> is the only ground truth, so TTS speaks
// it and mutes the base run it annotates (#5539).
//
// The swap is gated on the reading being kana, which is what keeps every other
// use of ruby markup working as before: emphasis dots (傍点), pinyin, zhuyin,
// latin/kanji glosses and Readest's own injected WordLens glosses all keep
// speaking the base and muting the annotation, exactly as they did before.

// Kana letters proper — the marks that make a reading pronounceable. Notably
// excludes ・ (U+30FB), which is a separator inside katakana loanwords but is
// also the character books use for emphasis dots.
const KANA_LETTER = /[ぁ-ゖゝ-ゟァ-ヺヽ-ヿ]/;
// Everything a kana reading may otherwise contain: voicing marks, the
// prolonged sound mark ー, the loanword separator ・, and whitespace.
const KANA_TEXT = /^[ぁ-ゖ゛-ゟァ-ヿ\s]+$/;

/** Whether an `<rt>` holds a Japanese reading rather than a gloss or an emphasis mark. */
export const isKanaReading = (text: string): boolean =>
  KANA_LETTER.test(text) && KANA_TEXT.test(text);

// Injected, non-book annotations (WordLens glosses) are marked `cfi-inert`;
// they are never book content and so never speech.
const isSpokenReading = (rt: Element): boolean =>
  !rt.closest('[cfi-inert]') && isKanaReading(rt.textContent ?? '');

/**
 * The `<rt>` annotating the base run that `child` — a direct child of `<ruby>` —
 * belongs to. Ruby content alternates base run / annotation, so it is simply
 * the next `<rt>` sibling.
 */
const rtForBaseRun = (child: Node): Element | null => {
  for (let node = child.nextSibling; node; node = node.nextSibling) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const name = (node as Element).tagName.toLowerCase();
    // A second annotation layer (double-sided ruby) rather than a mono pair:
    // its readings are not interleaved with the bases, so leave the base alone.
    if (name === 'rtc') return null;
    if (name === 'rt') return node as Element;
  }
  return null;
};

/**
 * Whether `node` is the silent side of its ruby pair — the side TTS must not
 * speak. That is the base run when its reading is spoken in its place, and the
 * annotation otherwise. `<rp>` and `<rtc>` are always silent, and so is an
 * `<rt>` that ended up outside any `<ruby>`.
 *
 * Nodes with no ruby involvement are never muted.
 */
export const isMutedRubyNode = (node: Node): boolean => {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el?.closest) return false;
  if (el.closest('rp, rtc')) return true;
  const rt = el.closest('rt');
  if (rt) return !isSpokenReading(rt);
  const ruby = el.closest('ruby');
  if (!ruby || node === ruby) return false;
  // Climb to the direct child of <ruby> holding this node — the base run whose
  // reading decides whether it is spoken.
  let child: Node = node;
  while (child.parentNode && child.parentNode !== ruby) child = child.parentNode;
  if (child.parentNode !== ruby) return false;
  const reading = rtForBaseRun(child);
  return !!reading && isSpokenReading(reading);
};

/**
 * The `<ruby>` around `node`, but ONLY when `node` sits in a reading TTS
 * actually speaks. Anywhere else the range is already anchored on the base,
 * which paints on its own.
 */
const spokenReadingRuby = (node: Node): Element | null => {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const rt = el?.closest?.('rt');
  if (!rt || !isSpokenReading(rt)) return null;
  return rt.closest('ruby');
};

/**
 * Widen a range that starts or ends inside a spoken `<rt>` so it covers the
 * whole `<ruby>`. TTS ranges are anchored on the text it speaks, which for a
 * Japanese book is the `<rt>` reading — and the overlayer never paints `<rt>`,
 * so an unexpanded range would highlight nothing at all. Expanding puts the
 * highlight on the base the reader is actually looking at.
 *
 * Gloss ruby (WordLens, pinyin, emphasis dots) is deliberately NOT expanded:
 * there the base is what TTS speaks and what the range already covers, and
 * widening it is actively destructive for the injected kind. A WordLens gloss
 * carries `cfi-skip`, so the element contributes no CFI step — setStartBefore
 * and setEndAfter then resolve to the SAME position and collapse the range to
 * nothing, e.g. `/4/2/4,/1:13,/1:20` ("manuals") becoming `/4/2,/4,/4` (""),
 * which the overlayer draws as an empty highlight. That is why word-granularity
 * TTS skipped every glossed word while sentence granularity was fine: sentence
 * ranges rarely begin or end inside a ruby, so they never hit the expansion.
 */
export const expandRangeOverRuby = (range: Range): Range => {
  const startRuby = spokenReadingRuby(range.startContainer);
  const endRuby = spokenReadingRuby(range.endContainer);
  if (!startRuby && !endRuby) return range;
  const expanded = range.cloneRange();
  if (startRuby) expanded.setStartBefore(startRuby);
  if (endRuby) expanded.setEndAfter(endRuby);
  return expanded;
};
