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
