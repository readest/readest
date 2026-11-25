import {
  DEFAULT_STATS_TRACKING_CONFIG,
  MAX_READING_SPEED_SAMPLE_MS,
  type ReadingSpeedSample,
  type ReadingSpeedUnit,
} from '@/types/statistics';
import { getRenderedTextFromRange } from '@/utils/sel';

type ReadingPosition = { index: number; range?: Range | null };
type VisiblePosition = { index: number; range: Range };

const MIN_SAMPLE_MS = DEFAULT_STATS_TRACKING_CONFIG.minEventSeconds * 1000;
// The paces, per minute, a page counts at. Slower, part of the time was spent
// away from it; faster, it was skimmed or flipped past.
const READING_PACE: Record<ReadingSpeedUnit, { slowest: number; fastest: number }> = {
  words: { slowest: 60, fastest: 1000 },
  characters: { slowest: 120, fastest: 2500 },
};

const isReadingPace = ({ unit, count, durationMs }: ReadingSpeedSample) => {
  if (durationMs < MIN_SAMPLE_MS || durationMs >= MAX_READING_SPEED_SAMPLE_MS) return false;
  const pace = (count * 60_000) / durationMs;
  return pace >= READING_PACE[unit].slowest && pace <= READING_PACE[unit].fastest;
};

/** Whether all of `screen` is above the start of `next`. */
const hasLeftScreen = (screen: VisiblePosition, next: VisiblePosition) =>
  next.index !== screen.index ||
  next.range.compareBoundaryPoints(Range.END_TO_START, screen.range) >= 0;

const readable = /[\p{L}\p{N}]/u;
const eastAsian = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const needsDictionary = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const fallbackWord = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’][\p{L}\p{N}\p{M}]+)*/gu;
const segmenters = new Map<string, Intl.Segmenter>();
// Include nearby text from the same node to segment words cut by a viewport edge.
const WORD_CONTEXT_LENGTH = 64;

const getLocale = (language: string) => {
  if (!language || /^(und|mul|zxx)$/i.test(language)) return '';
  try {
    return Intl.getCanonicalLocales(language.replaceAll('_', '-'))[0] ?? '';
  } catch {
    return '';
  }
};

export const countReadingUnits = (
  text: string,
  language: string,
  before = '',
  after = '',
): { unit: ReadingSpeedUnit; count: number } => {
  const locale = getLocale(language);
  const source = before + text + after;
  const letters = !locale && eastAsian.test(source) ? source.match(/\p{L}/gu) : null;
  const predominantlyEastAsian =
    letters && letters.filter((letter) => eastAsian.test(letter)).length * 2 > letters.length;
  if (/^(zh|ja|yue)(-|$)/i.test(locale) || predominantlyEastAsian) {
    return {
      unit: 'characters',
      count: text.normalize('NFC').match(/[\p{L}\p{N}]/gu)?.length ?? 0,
    };
  }

  const start = before.length;
  const end = start + text.length;
  const startsInRange = (index: number) => index >= start && index < end;
  let count = 0;
  if (typeof Intl.Segmenter === 'function') {
    let segmenter = segmenters.get(locale);
    if (!segmenter) {
      segmenter = new Intl.Segmenter(locale || undefined, { granularity: 'word' });
      segmenters.set(locale, segmenter);
    }
    for (const word of segmenter.segment(source)) {
      if (word.index >= end) break;
      if (word.isWordLike && startsInRange(word.index)) count++;
    }
  } else if (!needsDictionary.test(source)) {
    for (const word of source.matchAll(fallbackWord)) {
      if (startsInRange(word.index)) count++;
    }
  }
  return { unit: 'words', count };
};

const hasReadableText = (range: Range) =>
  readable.test(range.toString()) && readable.test(getRenderedTextFromRange(range));

/** Extract only text that was on screen and has now passed the viewport start. */
const getPassedRange = (previous: VisiblePosition, next: VisiblePosition): Range | null => {
  const before = previous.range;
  const after = next.range;
  const doc = before.startContainer.ownerDocument;
  const nextDoc = after.startContainer.ownerDocument;
  if (doc && nextDoc && doc !== nextDoc) {
    // Crossing a section counts only if the screen reached its end and the
    // next section starts at its beginning. A TOC jump must not read the gap.
    if (next.index !== previous.index + 1 || !doc.body || !nextDoc.body) return null;
    const tail = before.cloneRange();
    tail.collapse(false);
    tail.setEnd(doc.body, doc.body.childNodes.length);
    const head = after.cloneRange();
    head.collapse(true);
    head.setStart(nextDoc.body, 0);
    return hasReadableText(tail) || hasReadableText(head) ? null : before;
  }
  if (next.index !== previous.index || !doc) return null;

  const passed = before.cloneRange();
  passed.setEnd(after.startContainer, after.startOffset);
  if (passed.collapsed) return null;
  const gap = before.cloneRange();
  gap.collapse(false);
  gap.setEnd(after.startContainer, after.startOffset);
  return hasReadableText(gap) ? null : passed;
};

/** Count the words or characters in `passed`, with the text around it for cut-off words. */
const countPassedUnits = (passed: Range, language: string) => {
  const { startContainer, startOffset, endContainer, endOffset } = passed;
  const root = startContainer.ownerDocument?.documentElement;
  const startText =
    startContainer.nodeType === Node.TEXT_NODE ? (startContainer.nodeValue ?? '') : '';
  const prefix = startText.slice(Math.max(0, startOffset - WORD_CONTEXT_LENGTH), startOffset);
  // Rendered extraction drops leading collapsible space. Keep its word boundary.
  const before = /[\t\n\r ]/.test(startText.charAt(startOffset)) ? `${prefix} ` : prefix;
  const after =
    endContainer.nodeType === Node.TEXT_NODE
      ? endContainer.nodeValue?.slice(endOffset, endOffset + WORD_CONTEXT_LENGTH)
      : '';
  return countReadingUnits(
    getRenderedTextFromRange(passed),
    root?.getAttribute('lang') || root?.getAttribute('xml:lang') || language,
    before,
    after,
  );
};

/**
 * Measures forward reading from renderer ranges, independently of book page
 * numbering. A sample is one page: a page turn, or while scrolling, the screen
 * shown when the sample started, until all of it has scrolled past.
 */
export class ReadingSpeedTracker {
  private previous: (VisiblePosition & { timeMs: number; scrolled: boolean }) | null = null;
  // While scrolling: the screen the current sample started on, and its total.
  private screen: { start: VisiblePosition; sample: ReadingSpeedSample } | null = null;

  reset() {
    this.previous = null;
    this.screen = null;
  }

  onPosition(position: ReadingPosition | null, nowMs: number, scrolled: boolean, language = '') {
    const range = position?.range;
    if (!position || !range || range.collapsed) {
      this.reset();
      return null;
    }
    if (this.previous && this.previous.scrolled !== scrolled) this.reset();
    const old = this.previous;
    if (
      old?.range.startContainer === range.startContainer &&
      old.range.startOffset === range.startOffset
    ) {
      old.range = range;
      return null;
    }
    const next = { index: position.index, range };
    this.previous = { ...next, timeMs: nowMs, scrolled };
    if (!old) return null;
    const passed = nowMs >= old.timeMs ? getPassedRange(old, next) : null;
    if (!passed) {
      this.screen = null;
      return null;
    }
    const { unit, count } = countPassedUnits(passed, language);

    if (!scrolled) {
      const sample = { unit, count, startTimeMs: old.timeMs, durationMs: nowMs - old.timeMs };
      return isReadingPace(sample) ? sample : null;
    }
    // One scroll step says nothing about pace: the text passing the top edge
    // was read while it was lower on the screen. A whole screen does.
    const screen =
      this.screen && (this.screen.sample.unit === unit || !count)
        ? this.screen
        : { start: old, sample: { unit, count: 0, startTimeMs: old.timeMs, durationMs: 0 } };
    screen.sample.count += count;
    screen.sample.durationMs = nowMs - screen.sample.startTimeMs;
    this.screen = hasLeftScreen(screen.start, next) ? null : screen;
    return !this.screen && isReadingPace(screen.sample) ? screen.sample : null;
  }
}
