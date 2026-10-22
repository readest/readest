import { Book } from '@/types/book';
import { isSameLang } from '@/utils/lang';
import { getLocale } from '@/utils/misc';

const DAILY_USAGE_KEY = 'translationDailyUsage';

/**
 * Splits a long text into chunks of at most `maxLength` UTF-16 code units,
 * breaking on sentence ends, newlines or spaces whenever possible without
 * splitting a Unicode grapheme cluster. Shared by the providers whose upstream
 * APIs cap the length of a single request.
 */
export function splitTextIntoChunks(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const boundaries = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    ({ index }) => index,
  );
  boundaries.push(text.length);

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start;
    for (const boundary of boundaries) {
      if (boundary <= start) continue;
      if (boundary - start > maxLength) break;
      end = boundary;
    }
    if (end === start) {
      throw new Error('translate cannot fit a grapheme cluster within the request limit');
    }

    const window = text.slice(start, end);
    let cut = end;
    const sentenceEnd = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('! '),
      window.lastIndexOf('? '),
      window.lastIndexOf('\n'),
    );
    if (sentenceEnd > maxLength / 2) {
      cut = start + sentenceEnd + 1;
    } else {
      const space = window.lastIndexOf(' ');
      if (space > maxLength / 2) cut = start + space + 1;
    }
    chunks.push(text.slice(start, cut));
    start = cut;
  }
  return chunks;
}

/**
 * Splits one sentence longer than `maxLength` at clause boundaries (`, ` `; ` or a
 * closing quote; never a colon, which introduces a quotation) into roughly equal pieces.
 * Pieces keep their trailing whitespace, so joining them restores the input.
 */
function splitAtClauses(text: string, maxLength: number): string[] {
  const boundary = /(?:[,;]["”’']?|[”’"])\s+/g;
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > maxLength) {
    // Aim for the fewest equal pieces that fit, so long runs of short clauses are not
    // over-split into many tiny requests.
    const target = rest.length / Math.ceil(rest.length / maxLength);
    let best = -1;
    for (const match of rest.matchAll(boundary)) {
      const end = match.index + match[0].length;
      if (end < rest.length && Math.abs(end - target) < Math.abs(best - target)) best = end;
    }
    if (best <= 0) break;
    pieces.push(rest.slice(0, best));
    rest = rest.slice(best);
  }
  pieces.push(rest);
  return pieces;
}

/**
 * Like `splitTextIntoChunks`, but packs whole sentences into chunks of at most `maxChunk`
 * and pre-splits only sentences longer than `maxSentence` at clause boundaries. Yandex
 * cuts long sentences mid-clause on its own; sending the clauses of such a sentence in
 * separate requests keeps each request a self-contained unit. Joining restores the input.
 */
export function splitTextIntoSentenceChunks(
  text: string,
  maxChunk: number,
  maxSentence: number,
): string[] {
  const sentences = text.match(/[^.!?]*[.!?]+["”’')\]]*|[^.!?]+/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  const add = (piece: string, forceNew: boolean) => {
    if (current && (forceNew || current.length + piece.length > maxChunk)) {
      chunks.push(current);
      current = '';
    }
    current += piece;
  };
  for (const sentence of sentences) {
    const clauses =
      sentence.length > maxSentence ? splitAtClauses(sentence, maxSentence) : [sentence];
    clauses.forEach((clause, clauseIndex) => {
      splitTextIntoChunks(clause, maxChunk).forEach((part, partIndex) =>
        add(part, clauseIndex > 0 || partIndex > 0),
      );
    });
  }
  if (current) chunks.push(current);
  return chunks;
}

export const saveDailyUsage = (usage: number, date?: string) => {
  if (typeof window !== 'undefined') {
    const isoDate = date || new Date().toISOString().split('T')[0]!;
    const dailyUsage = { [isoDate]: usage };
    localStorage.setItem(DAILY_USAGE_KEY, JSON.stringify(dailyUsage));
  }
};

export const getDailyUsage = (date?: string): number | null => {
  if (typeof window !== 'undefined') {
    const isoDate = date || new Date().toISOString().split('T')[0]!;
    const usage = localStorage.getItem(DAILY_USAGE_KEY);
    if (usage) {
      const dailyUsage = JSON.parse(usage);
      if (dailyUsage[isoDate]) {
        return dailyUsage[isoDate];
      }
    }
  }
  return null;
};

export const isTranslationAvailable = (book?: Book | null, targetLanguage?: string | null) => {
  if (!book || book.format === 'PDF') {
    return false;
  }

  const primaryLanguage = book.primaryLanguage || '';
  if (!primaryLanguage || primaryLanguage.toLowerCase() === 'und') {
    return false;
  }

  if (targetLanguage && isSameLang(primaryLanguage, targetLanguage)) {
    return false;
  }

  if (!targetLanguage && isSameLang(primaryLanguage, getLocale())) {
    return false;
  }

  return true;
};
