import { segmentNearbyWords } from '@/utils/nearbySearch';

export interface TextMatch {
  start: number;
  end: number;
}

export const compileSearchRegex = (pattern: string, matchCase: boolean): RegExp => {
  try {
    return new RegExp(pattern, matchCase ? 'g' : 'gi');
  } catch {
    const error = new Error('Invalid regular expression');
    Object.assign(error, { code: 'INVALID_REGEX' });
    throw error;
  }
};

export const findRegexMatches = (text: string, regex: RegExp, limit = Infinity): TextMatch[] => {
  const matches: TextMatch[] = [];
  regex.lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    if (match[0].length === 0) continue;
    matches.push({ start: match.index, end: match.index + match[0].length });
    if (matches.length >= limit) break;
  }
  return matches;
};

// Keep only matches whose span starts at a word start and ends at a word end,
// per Intl.Segmenter word segmentation (dictionary-based for CJK locales).
export const filterWholeWordMatches = (
  text: string,
  matches: TextMatch[],
  locale?: string,
): TextMatch[] => {
  if (!matches.length) return matches;
  const words = segmentNearbyWords(text, locale ?? 'en');
  const starts = new Set<number>();
  const ends = new Set<number>();
  for (const word of words) {
    starts.add(word.start);
    ends.add(word.end);
  }
  return matches.filter((match) => starts.has(match.start) && ends.has(match.end));
};
