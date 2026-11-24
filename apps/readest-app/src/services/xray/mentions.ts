import type { BookDoc } from '@/libs/document';
import { extractSentence } from '@/services/vocabulary/entry';
import { XCFI } from '@/utils/xcfi';
import { loadSection, type SectionText } from './bookText';
import type { XRayQuote } from './types';

/** Around a mention, enough to hold its sentence. */
const CONTEXT_CHARS = 400;

// The text of the sections of the book being read: their documents are only
// needed again for the mentions shown.
let cached: { bookDoc: BookDoc; texts: Map<number, string> } | null = null;

// A name between other letters is another word; CJK has no spaces to tell.
const namePattern = (names: readonly string[]) =>
  new RegExp(
    names
      .filter((name) => name.trim())
      .sort((a, b) => b.length - a.length)
      .map((name) => {
        const escaped = name
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\s+/g, ' ');
        const cjk = /[぀-ヿ㐀-鿿가-힯]/.test(name);
        return cjk ? escaped : `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`;
      })
      .join('|'),
    'gu',
  );

export interface XRayMentions {
  count: number;
  /** The first, and the latest ones. */
  quotes: XRayQuote[];
}

/** Where the book mentions any of `names`, up to the page at `location`. */
export const findMentions = async (
  bookDoc: BookDoc,
  location: string,
  names: readonly string[],
  limit: number,
): Promise<XRayMentions> => {
  const pattern = namePattern(names);
  if (!pattern.source || pattern.source === '(?:)') return { count: 0, quotes: [] };
  if (cached?.bookDoc !== bookDoc) cached = { bookDoc, texts: new Map() };
  const { texts } = cached;
  const current = Math.min(XCFI.extractSpineIndex(location), bookDoc.sections.length - 1);
  const found: { index: number; at: number; word: string }[] = [];
  let first: (typeof found)[number] | undefined;
  let count = 0;
  for (let index = 0; index <= current; index++) {
    if (bookDoc.sections[index]!.linear === 'no') continue;
    let text = texts.get(index);
    if (text === undefined || index === current) {
      const section = await loadSection(bookDoc, index);
      text = section.text;
      texts.set(index, text);
      if (index === current) text = text.slice(0, section.offsetOf(location));
    }
    for (const match of text.matchAll(pattern)) {
      const mention = { index, at: match.index, word: match[0] };
      first ??= mention;
      count++;
      found.push(mention);
      if (found.length > limit) found.shift();
    }
  }
  if (first && !found.includes(first)) found.splice(0, found.length === limit ? 1 : 0, first);
  const sections = new Map<number, SectionText>();
  const quotes: XRayQuote[] = [];
  for (const { index, at, word } of found) {
    const section = sections.get(index) ?? (await loadSection(bookDoc, index));
    sections.set(index, section);
    const { text } = section;
    quotes.push({
      // A sentence end leaves the closing quote of the sentence before.
      text: extractSentence(
        text.slice(Math.max(0, at - CONTEXT_CHARS), at),
        word,
        text.slice(at + word.length, at + word.length + CONTEXT_CHARS),
      ).replace(/^[”’"'»)\]\s]+/, ''),
      cfi: section.cfiAt(at),
    });
  }
  return { count, quotes };
};
