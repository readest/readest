import {
  DEFAULT_STATS_TRACKING_CONFIG,
  MAX_READING_SPEED_SAMPLE_MS,
  type ReadingSpeedSample,
  type ReadingSpeedUnit,
} from '@/types/statistics';
import { getRenderedTextFromRange } from '@/utils/sel';

const MIN_SAMPLE_MS = DEFAULT_STATS_TRACKING_CONFIG.minEventSeconds * 1000;
const IDLE_MS = DEFAULT_STATS_TRACKING_CONFIG.idleTimeoutSeconds * 1000;
// A page kept past the idle timeout counts only if read at this pace or
// faster; slower, it was partly time away from the book.
const MIN_UNITS_PER_MINUTE: Record<ReadingSpeedUnit, number> = { words: 60, characters: 120 };
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

type ReadingPosition = { index: number; range?: Range | null };
type VisiblePosition = { index: number; range: Range };

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

/** Measures forward reading from renderer ranges, independently of book page numbering. */
export class ReadingSpeedTracker {
  private previous: (VisiblePosition & { timeMs: number; scrolled: boolean }) | null = null;
  private pending: ReadingSpeedSample | null = null;

  reset() {
    this.previous = null;
    this.pending = null;
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
    this.previous = { index: position.index, range, timeMs: nowMs, scrolled };
    if (!old) return null;
    const durationMs = nowMs - old.timeMs;
    // A long page (a desktop spread) can outlast the idle timeout and is then
    // judged by its pace below. Scrolled text leaves the screen in steps
    // unrelated to how long it took to read, so scrolling keeps the limit.
    if (
      durationMs < 0 ||
      durationMs >= (scrolled ? IDLE_MS : MAX_READING_SPEED_SAMPLE_MS) ||
      (!scrolled && durationMs < MIN_SAMPLE_MS)
    ) {
      this.pending = null;
      return null;
    }
    const passed = getPassedRange(old, this.previous);
    if (!passed) {
      this.pending = null;
      return null;
    }

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
    const text = getRenderedTextFromRange(passed);
    const { unit, count } = countReadingUnits(
      text,
      root?.getAttribute('lang') || root?.getAttribute('xml:lang') || language,
      before,
      after,
    );
    if (durationMs >= IDLE_MS && count * 60_000 < durationMs * MIN_UNITS_PER_MINUTE[unit]) {
      this.pending = null;
      return null;
    }
    const pending = this.pending;
    if (!count && !pending) return null;
    const canJoin =
      pending &&
      (!count || pending.unit === unit) &&
      nowMs - pending.startTimeMs < MAX_READING_SPEED_SAMPLE_MS;
    const sample = canJoin
      ? {
          unit: pending.unit,
          count: pending.count + count,
          startTimeMs: pending.startTimeMs,
          durationMs: nowMs - pending.startTimeMs,
        }
      : { unit, count, startTimeMs: old.timeMs, durationMs };
    this.pending =
      scrolled && sample.count > 0 && sample.durationMs < MIN_SAMPLE_MS ? sample : null;
    return !this.pending && sample.count > 0 && sample.durationMs >= MIN_SAMPLE_MS ? sample : null;
  }
}
