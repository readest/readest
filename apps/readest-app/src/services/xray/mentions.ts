import type { BookDoc } from '@/libs/document';
import { extractSentence } from '@/services/vocabulary/entry';
import { XCFI } from '@/utils/xcfi';
import { hasText, loadSection } from './bookText';

/** Around a mention, enough to hold its sentence. */
const CONTEXT_CHARS = 400;

// The text of the sections of the book being read: their documents are only
// needed again for the mentions shown.
let cached: { bookDoc: BookDoc; texts: Map<number, string> } | null = null;

// A name between other letters is another word; CJK has no spaces to tell.
const CJK = /[぀-ヿ㐀-鿿가-힯]/;
const WORD = /[\p{L}\p{N}]/u;

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
        return CJK.test(name) ? escaped : `${escaped}(?![\\p{L}\\p{N}])`;
      })
      .join('|'),
    'gu',
  );

/** Whether a match starts a word. Older WebKit has no lookbehind to do it in the pattern. */
const startsWord = (text: string, { 0: match, index }: RegExpExecArray) =>
  CJK.test(match) || !WORD.test(text[index - 1] ?? '');

export interface XRayMention {
  /** Its sentence. */
  text: string;
  section: number;
  /** Where it is in the section's text. */
  offset: number;
}

export interface XRayMentions {
  count: number;
  /** The first, and the latest ones. */
  mentions: XRayMention[];
}

const sentenceOf = (text: string, at: number, word: string) =>
  extractSentence(
    text.slice(Math.max(0, at - CONTEXT_CHARS), at),
    word,
    text.slice(at + word.length, at + word.length + CONTEXT_CHARS),
  )
    // A sentence end leaves the closing quote of the sentence before.
    .replace(/^[”’"'»)\]\s]+/, '');

/** Where the book mentions any of `names`, up to the page at `location`. */
export const findMentions = async (
  bookDoc: BookDoc,
  location: string,
  names: readonly string[],
  limit: number,
): Promise<XRayMentions> => {
  const pattern = namePattern(names);
  if (pattern.source === '(?:)') return { count: 0, mentions: [] };
  if (cached?.bookDoc !== bookDoc) cached = { bookDoc, texts: new Map() };
  const { texts } = cached;
  const current = Math.min(XCFI.extractSpineIndex(location), bookDoc.sections.length - 1);
  // The first mention, then a window that slides to the latest ones.
  const found: { section: number; offset: number; word: string }[] = [];
  let count = 0;
  for (let section = 0; section <= current; section++) {
    if (!hasText(bookDoc.sections[section]!)) continue;
    let text = texts.get(section);
    if (text === undefined || section === current) {
      const loaded = await loadSection(bookDoc, section);
      texts.set(section, loaded.text);
      text = section === current ? loaded.text.slice(0, loaded.offsetOf(location)) : loaded.text;
    }
    for (const match of text.matchAll(pattern)) {
      if (!startsWord(text, match)) continue;
      count++;
      if (found.length === limit) found.splice(1, 1);
      found.push({ section, offset: match.index, word: match[0] });
    }
  }
  return {
    count,
    mentions: found.map(({ section, offset, word }) => ({
      text: sentenceOf(texts.get(section)!, offset, word),
      section,
      offset,
    })),
  };
};

/** The CFI of a mention. */
export const cfiOfMention = async (bookDoc: BookDoc, { section, offset }: XRayMention) =>
  (await loadSection(bookDoc, section)).cfiAt(offset);
