import type { DictionaryProvider } from '@/services/dictionaries/types';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';
import { lookupInContext } from '@/services/dictionaries/contextDictionary';
import { getContextTranslator } from '@/services/dictionaries/providers/contextProvider';
import { getSignedInToken, isCustomTranslatorAllowed } from '@/utils/access';
import type { VocabularyOccurrence } from './types';

// Where a Word Lens hint for a saved word can come from besides typing it
// (#6613): the reader's own dictionaries, or the AI context dictionary.

const MAX_HINT_LEN = 40;
// One or more /…/ or […] pronunciations with only marks between and after them
// (ECDICT: `[ә'ridʒineit] - ★★`). Words or numbers after a bracket make it a
// sense: `[数学] 区间 [0, 1]`, `[数学] 0, 1`.
const PRONUNCIATION = /^(?:(?:\/[^/]*\/|\[[^\]]*\])[^\p{L}\p{N}/[]*)+$/u;
const SENSE_BREAK = /[;；]|\.(?:\s|$)/;

const capAtWord = (s: string) => {
  if (s.length <= MAX_HINT_LEN) return s;
  const cut = s.slice(0, MAX_HINT_LEN);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim();
};

/** The first sense in a dictionary entry's plain text, short enough for a hint. */
export const firstSense = (text: string, word: string): string => {
  const headword = word.trim().toLowerCase();
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    // The headword line, with or without its pronunciation after it.
    if (line.toLowerCase().startsWith(headword)) line = line.slice(headword.length).trim();
    if (!line || PRONUNCIATION.test(line)) continue;
    line = line
      .replace(/^(?:\d+[.)]|\[\d+\])\s*/, '') // sense number: 1. or [1]
      .replace(/^\([^)]*\)\s*/, '') // (noun)
      .replace(/^[a-z]{1,6}\.\s+/i, '') // n. / vt.
      .split(SENSE_BREAK)[0]!
      .trim();
    if (line) return capAtWord(line);
  }
  return '';
};

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'LI',
  'OL',
  'UL',
  'DL',
  'DT',
  'DD',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HGROUP',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'BLOCKQUOTE',
  'TABLE',
  'TR',
  'BR',
]);

// Stylesheets and scripts a dictionary renders hold no definition text (#7446).
const NON_TEXT = 'style, script';

// Text of a rendered entry, one line per block, including the open shadow
// roots MDict renders into. The container is detached, so block boundaries
// come from tag names (computed styles don't exist off-document).
const textOf = (node: Node): string => {
  if (node instanceof Element && node.matches(NON_TEXT)) return '';
  if (node instanceof Element && node.shadowRoot) return textOf(node.shadowRoot);
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    // Line breaks in HTML source show as spaces; a plain-text entry's <pre> keeps them.
    return node.parentElement?.closest('pre') ? text : text.replace(/\s+/g, ' ');
  }
  const parts: string[] = [];
  for (const child of node.childNodes) parts.push(textOf(child));
  return parts.join('') + (node instanceof Element && BLOCK_TAGS.has(node.tagName) ? '\n' : '');
};

// A numbered sense: an <ol> item, or a <dd> numbered by its own `[1]` (German
// Wiktionary) or by the <dt> before it (Spanish Wiktionary). Unordered lists
// hold notes and examples (#7707).
const isNumberedSense = (el: Element) => {
  if (el.matches('ol > li')) return true;
  const dt = el.previousElementSibling;
  return (
    /^\s*\[\d+\]/.test(el.textContent ?? '') ||
    (!!dt && dt.matches('dt') && /^\s*\d/.test(dt.textContent ?? ''))
  );
};

// The first sense (its own text, without nested examples): for Wiktionary the
// first numbered one, else the first list item. Searches open shadow roots too.
const firstDefinition = (root: Element | ShadowRoot, numbered: boolean): string => {
  const item =
    (numbered ? Array.from(root.querySelectorAll('ol > li, dd')).find(isNumberedSense) : null) ??
    root.querySelector('li');
  if (item) {
    const own = item.cloneNode(true) as Element;
    own.querySelectorAll(`ul, ol, ${NON_TEXT}`).forEach((el) => el.remove());
    return own.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      const found = firstDefinition(el.shadowRoot, numbered);
      if (found) return found;
    }
  }
  return '';
};

/** The dictionaries a hint can be taken from: no web searches, no paid AI. */
export const hintProviders = (providers: DictionaryProvider[]) =>
  providers.filter((p) => p.kind !== 'web' && p.id !== BUILTIN_PROVIDER_IDS.context);

export const hintFromDictionary = async (
  word: string,
  lang: string,
  providers: DictionaryProvider[],
  signal: AbortSignal = new AbortController().signal,
): Promise<string> => {
  for (const provider of hintProviders(providers)) {
    const container = document.createElement('div');
    try {
      await provider.init?.();
      const outcome = await provider.lookup(word, { lang, signal, container });
      if (!outcome.ok) continue;
      const numbered = provider.id === BUILTIN_PROVIDER_IDS.wiktionary;
      const sense = firstSense(firstDefinition(container, numbered) || textOf(container), word);
      if (sense) return sense;
    } catch (err) {
      console.warn('[vocabulary] dictionary hint failed', provider.id, err);
    }
  }
  return '';
};

/** Whether the AI context dictionary can be asked (premium + an LLM translator). */
export const canAskAIForHint = async (): Promise<boolean> =>
  !!getContextTranslator() && isCustomTranslatorAllowed(getSignedInToken());

export const hintFromAI = async (
  word: string,
  occurrence: VocabularyOccurrence | undefined,
  sourceLang: string,
  targetLang: string,
  signal: AbortSignal,
): Promise<string> => {
  const translator = getContextTranslator();
  if (!translator) return '';
  const sentence = occurrence?.sentence ?? word;
  const at = sentence.toLowerCase().indexOf(word.toLowerCase());
  const entry = await lookupInContext(
    translator,
    {
      text: word,
      before: at >= 0 ? sentence.slice(0, at) : sentence,
      after: at >= 0 ? sentence.slice(at + word.length) : '',
      sourceLang,
      targetLang,
      bookTitle: occurrence?.bookTitle,
      bookAuthor: occurrence?.bookAuthor,
    },
    signal,
  );
  return capAtWord(entry.definition.split(SENSE_BREAK)[0]!.trim());
};
