// The Anki link (#789): reading words back out of Anki notes and deciding what
// an import or a send changes. See
// docs/superpowers/specs/2026-11-04-anki-link-design.md
import { UNSPACED } from './export';

const MAX_WORD_LEN = 40;
const MAX_WORD_COUNT = 5;
const MAX_UNSPACED_LEN = 12;
// The hint input's maxLength in VocabularyDetail.
const MAX_HINT_LEN = 80;

const LANG_TAG_PREFIX = 'readest::lang::';

const BREAKS = /<br\s*\/?>|<\/(?:div|p|li|h[1-6]|tr)\s*>/gi;
const SOUND = /\[sound:[^\]]*\]/g;
const CLOZE = /\{\{c\d+::(.*?)(?:::.*?)?\}\}/;

/** The visible text of an Anki field, one entry per non-empty line. */
export const cleanAnkiField = (html: string): string[] => {
  const marked = html.replace(BREAKS, '\n');
  const text = new DOMParser().parseFromString(marked, 'text/html').body.textContent ?? '';
  return text
    .replace(SOUND, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
};

const tooLong = (word: string) =>
  word.length > MAX_WORD_LEN ||
  word.split(' ').length > MAX_WORD_COUNT ||
  (UNSPACED.test(word) && word.length > MAX_UNSPACED_LEN);

/** The headword a note stands for, or null when it holds no usable word. */
export const ankiWordOf = (fields: string[]): string | null => {
  const lines = cleanAnkiField(fields[0] ?? '');
  const cloze = lines.join('\n').match(CLOZE);
  const word = (cloze ? cloze[1]!.trim() : lines[0]) ?? '';
  return word && !tooLong(word) ? word : null;
};

export const ankiHintOf = (fields: string[]): string | undefined => {
  const line = cleanAnkiField(fields[1] ?? '')[0];
  return line ? line.slice(0, MAX_HINT_LEN) : undefined;
};

export const ankiLangTag = (lang: string): string => `${LANG_TAG_PREFIX}${lang}`;

export const ankiLangOf = (tags: string): string | undefined => {
  const tag = tags
    .split(/\s+/)
    .find((t) => t.toLowerCase().startsWith(LANG_TAG_PREFIX) && t.length > LANG_TAG_PREFIX.length);
  return tag?.slice(LANG_TAG_PREFIX.length);
};
