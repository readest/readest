import type { DictionaryProvider } from '@/services/dictionaries/types';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';
import { lookupInContext } from '@/services/dictionaries/contextDictionary';
import { getContextTranslator } from '@/services/dictionaries/providers/contextProvider';
import { getAccessToken, isCustomTranslatorAllowed } from '@/utils/access';
import type { VocabularyOccurrence } from './types';

// Where a Word Lens hint for a saved word can come from besides typing it
// (#6613): the reader's own dictionaries, or the AI context dictionary.

const MAX_HINT_LEN = 40;
const PRONUNCIATION = /^[/[].*[/\]]$/;
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
      .replace(/^\d+[.)]\s*/, '') // sense number
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

// Text of a rendered entry, one line per block, including the open shadow
// roots MDict renders into. The container is detached, so block boundaries
// come from tag names (computed styles don't exist off-document).
const textOf = (node: Node): string => {
  if (node instanceof Element && node.shadowRoot) return textOf(node.shadowRoot);
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  const parts: string[] = [];
  for (const child of node.childNodes) parts.push(textOf(child));
  return parts.join('') + (node instanceof Element && BLOCK_TAGS.has(node.tagName) ? '\n' : '');
};

// The first definition list item (its own text, without nested examples),
// searching open shadow roots too.
const firstDefinition = (root: Element | ShadowRoot): string => {
  const li = root.querySelector('li');
  if (li) {
    const own = li.cloneNode(true) as Element;
    own.querySelectorAll('ul, ol').forEach((list) => list.remove());
    return own.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      const found = firstDefinition(el.shadowRoot);
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
      const sense = firstSense(firstDefinition(container) || textOf(container), word);
      if (sense) return sense;
    } catch (err) {
      console.warn('[vocabulary] dictionary hint failed', provider.id, err);
    }
  }
  return '';
};

/** Whether the AI context dictionary can be asked (premium + an LLM translator). */
export const canAskAIForHint = async (): Promise<boolean> =>
  !!getContextTranslator() && isCustomTranslatorAllowed(await getAccessToken());

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
