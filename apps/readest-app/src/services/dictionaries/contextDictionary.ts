/**
 * AI context dictionary (#5544).
 *
 * Explains a selected word or phrase as it is used in the passage around it,
 * through one of the user's OpenAI-compatible custom translators. The prompt
 * asks for a JSON dictionary entry so the provider can render it with the
 * same typography as the other dictionary cards.
 */
import type { CustomTranslator } from '@/types/translation';
import { md5Fingerprint } from '@/utils/md5';
import { renderPrompt } from '@/services/translators/custom/prompts';
import {
  createChatModel,
  loadSDK,
  stripReasoning,
} from '@/services/translators/custom/openaiCompatible';

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_CACHE_ENTRIES = 100;

export const CONTEXT_DICTIONARY_PROMPT = `You are a contextual dictionary inside an ebook reader. The reader selected a word or phrase in a book written in {{sourceLang}} and wants to know what it means in this passage.

Use the surrounding passage to pick the sense intended here, not just the most common one. Ground the entry only in the provided passage and do not invent facts about the book.
Write grammar, definition, explanation, example explanations and synonym nuances in {{targetLang}}. Keep the headword, example sentences and synonyms in the language of the book. Write pronunciation as IPA.
If the selection is a whole sentence or longer, explain what it means in context and leave pronunciation, grammar, examples and synonyms empty.
If a field is uncertain, leave it empty rather than guessing.

Return only valid JSON with this shape:
{
  "headword": "the selected text in its dictionary form",
  "pronunciation": "/IPA/",
  "grammar": "part of speech or usage pattern",
  "definition": "concise meaning in this context",
  "explanation": "how the selected text works in this passage",
  "examples": [{"sentence": "another example sentence", "explanation": "what the example shows"}],
  "synonyms": [{"phrase": "an alternative word or phrase", "nuance": "how it differs here"}]
}
Give at most 2 examples and at most 3 synonyms.`;

export interface ContextLookupInput {
  text: string;
  before: string;
  after: string;
  sourceLang?: string;
  targetLang: string;
  bookTitle?: string;
  bookAuthor?: string;
}

export interface ContextEntry {
  headword: string;
  pronunciation?: string;
  grammar?: string;
  definition: string;
  explanation?: string;
  examples: { sentence: string; explanation: string }[];
  synonyms: { phrase: string; nuance: string }[];
}

const BLOCK_SELECTOR = 'p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, pre, figcaption';

const blockOf = (node: Node): Element | null => {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest(BLOCK_SELECTOR) ?? element;
};

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The text before and after a selection: its own paragraph plus the one on
 * either side, cut to `maxChars` per side at a word boundary next to the
 * selection.
 */
export const buildSelectionContext = (
  range: Range,
  maxChars = 1000,
): { before: string; after: string } => {
  const doc = range.startContainer.ownerDocument!;
  const first = blockOf(range.startContainer);
  const last = blockOf(range.endContainer);

  const head = doc.createRange();
  if (first) head.setStartBefore(first);
  head.setEnd(range.startContainer, range.startOffset);
  const tail = doc.createRange();
  tail.setStart(range.endContainer, range.endOffset);
  if (last) tail.setEndAfter(last);
  else tail.collapse(true);

  const before = normalize(`${first?.previousElementSibling?.textContent ?? ''} ${head}`);
  const after = normalize(`${tail} ${last?.nextElementSibling?.textContent ?? ''}`);
  return {
    before: before.length > maxChars ? before.slice(-maxChars).replace(/^\S*\s+/, '') : before,
    after: after.length > maxChars ? after.slice(0, maxChars).replace(/\s+\S*$/, '') : after,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
};

const readList = <T>(value: unknown, read: (item: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(value)
    ? value.filter(isRecord).flatMap((item) => {
        const out = read(item);
        return out ? [out] : [];
      })
    : [];

export const parseContextEntry = (reply: string): ContextEntry => {
  const text = stripReasoning(reply);
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('The AI provider returned an invalid reply.');
  }
  if (!isRecord(parsed)) throw new Error('The AI provider returned an invalid reply.');
  const definition = readString(parsed, 'definition');
  if (!definition) throw new Error('The AI provider returned an incomplete entry.');
  return {
    headword: readString(parsed, 'headword'),
    pronunciation: readString(parsed, 'pronunciation') || undefined,
    grammar: readString(parsed, 'grammar') || undefined,
    definition,
    explanation: readString(parsed, 'explanation') || undefined,
    examples: readList(parsed['examples'], (item) => {
      const sentence = readString(item, 'sentence');
      return sentence ? { sentence, explanation: readString(item, 'explanation') } : null;
    }),
    synonyms: readList(parsed['synonyms'], (item) => {
      const phrase = readString(item, 'phrase');
      return phrase ? { phrase, nuance: readString(item, 'nuance') } : null;
    }),
  };
};

const cache = new Map<string, ContextEntry>();

export const __clearContextCacheForTests = () => cache.clear();

export const lookupInContext = async (
  translator: CustomTranslator,
  input: ContextLookupInput,
  signal: AbortSignal,
): Promise<ContextEntry> => {
  const system = renderPrompt(CONTEXT_DICTIONARY_PROMPT, {
    sourceLang: input.sourceLang || 'AUTO',
    targetLang: input.targetLang,
  });
  const prompt = JSON.stringify({
    selectedText: input.text,
    before: input.before,
    after: input.after,
    bookTitle: input.bookTitle ?? '',
    bookAuthor: input.bookAuthor ?? '',
  });
  const key = md5Fingerprint(
    JSON.stringify([translator.id, translator.updatedAt, translator.model, system, prompt]),
  );
  const cached = cache.get(key);
  if (cached) return cached;

  signal.throwIfAborted();
  // Our own controller rather than the caller's signal: the popup aborts every
  // lookup when it closes, and tauriFetch leaves an unhandled rejection when a
  // finished request's signal fires (see openaiCompatible.ts).
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  signal.addEventListener('abort', abort, { once: true });
  try {
    const [{ generateText }] = await loadSDK();
    const { text } = await generateText({
      model: await createChatModel(translator),
      system,
      prompt,
      temperature: translator.temperature,
      maxRetries: 1,
      abortSignal: controller.signal,
    });
    const entry = parseContextEntry(text);
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, entry);
    return entry;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
};
