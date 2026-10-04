import type { LanguageModel } from 'ai';
import { getAIFetch } from '@/services/ai/utils/httpFetch';
import { getPromptTemplate } from '@/store/customTranslatorStore';
import { md5Fingerprint } from '@/utils/md5';
import type { CustomTranslator } from '@/types/translation';
import { ErrorCodes, TranslationContext, TranslationProvider } from '../types';
import { renderPrompt } from './prompts';
import { CUSTOM_TRANSLATOR_PREFIX } from './constants';

const BATCH_DELAY_MS = 50;
const MAX_BATCH_ITEMS = 4;
const MAX_BATCH_CHARS = 3000;
const MAX_INFLIGHT_BATCHES = 4;
const REQUEST_TIMEOUT_MS = 60_000;

const SINGLE_RULES =
  "Output only the translation of the user's text, without explanations, notes or quotation marks.";
const batchRules = (n: number) =>
  `The user's text contains ${n} numbered blocks, each starting with a marker line like [n]. ` +
  `Translate every block and output exactly ${n} blocks in the same order, each starting with its original [n] marker line. ` +
  'Output only the translations, without explanations or notes.';

interface Item {
  text: string;
  resolve: (text: string) => void;
  reject: (err: unknown) => void;
  cancelled?: boolean;
}

interface PendingBatch {
  system: string;
  items: Item[];
  chars: number;
  timer?: ReturnType<typeof setTimeout>;
}

// Only a leading reasoning block: a book may legitimately quote `</think>`.
// The AI SDK is loaded on first use: it pulls in Node-only modules at import
// time, and the reader imports this file whether or not an LLM is configured.
let sdk: Promise<[typeof import('ai'), typeof import('@ai-sdk/openai-compatible')]> | undefined;
export const loadSDK = () =>
  (sdk ??= Promise.all([import('ai'), import('@ai-sdk/openai-compatible')]));

export const stripReasoning = (text: string) =>
  text.replace(/^\s*<think>[\s\S]*?<\/think>/, '').trim();

export const createChatModel = async (config: CustomTranslator): Promise<LanguageModel> => {
  const [, { createOpenAICompatible }] = await loadSDK();
  return createOpenAICompatible({
    name: 'custom',
    baseURL: (config.baseUrl ?? '').replace(/\/+$/, ''),
    apiKey: config.apiKey || undefined,
    fetch: getAIFetch(),
  }).chatModel(config.model ?? '');
};

/** Splits a `[1]\n…\n\n[2]\n…` reply; returns null unless it holds exactly blocks 1..n. */
const splitNumbered = (text: string, n: number): string[] | null => {
  // A marker starts a line; some models continue the translation on that line.
  const parts = text.split(/^[ \t]*\[(\d+)\][ \t]*/m);
  const blocks: string[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    if (Number(parts[i]) !== blocks.length + 1) return null;
    blocks.push(parts[i + 1]!.trim());
  }
  return blocks.length === n ? blocks : null;
};

const toTranslatorError = (err: unknown): Error => {
  const status = (err as { statusCode?: number }).statusCode;
  if (status === 401 || status === 403) return new Error(ErrorCodes.UNAUTHORIZED);
  return err instanceof Error ? err : new Error(String(err));
};

export const createOpenAICompatibleTranslator = (config: CustomTranslator): TranslationProvider => {
  let model: LanguageModel | undefined;
  const pending = new Map<string, PendingBatch>();
  const queue: PendingBatch[] = [];
  let inflight = 0;

  const getModel = async () => (model ??= await createChatModel(config));

  const renderSystem = (sourceLang: string, targetLang: string, context?: TranslationContext) =>
    renderPrompt(getPromptTemplate(context?.promptId), {
      sourceLang,
      targetLang,
      bookTitle: context?.bookTitle,
      bookAuthor: context?.bookAuthor,
    });

  const callModel = async (system: string, prompt: string): Promise<string> => {
    // Not AbortSignal.timeout: tauriFetch cancels from the signal's abort
    // listener without handling the result, so a timer that fires after the
    // reply leaves an unhandled "resource id is invalid" rejection.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const [{ generateText }] = await loadSDK();
      const { text } = await generateText({
        model: await getModel(),
        system,
        prompt,
        temperature: config.temperature,
        maxRetries: 2,
        abortSignal: controller.signal,
      });
      return stripReasoning(text);
    } catch (err) {
      throw toTranslatorError(err);
    } finally {
      clearTimeout(timer);
    }
  };

  const translateBatch = async (system: string, items: Item[]) => {
    if (items.length === 1) {
      items[0]!.resolve(await callModel(`${system}\n\n${SINGLE_RULES}`, items[0]!.text));
      return;
    }
    const prompt = items.map((item, i) => `[${i + 1}]\n${item.text}`).join('\n\n');
    const reply = await callModel(`${system}\n\n${batchRules(items.length)}`, prompt);
    const blocks = splitNumbered(reply, items.length);
    if (blocks) {
      items.forEach((item, i) => item.resolve(blocks[i]!));
      return;
    }
    // The model merged or dropped blocks; translate one by one instead.
    await Promise.all(
      items.map(async (item) => {
        try {
          item.resolve(await callModel(`${system}\n\n${SINGLE_RULES}`, item.text));
        } catch (err) {
          item.reject(err);
        }
      }),
    );
  };

  const pump = () => {
    while (inflight < MAX_INFLIGHT_BATCHES && queue.length > 0) {
      const batch = queue.shift()!;
      const items = batch.items.filter((item) => !item.cancelled);
      if (items.length === 0) continue;
      inflight++;
      translateBatch(batch.system, items)
        .catch((err) => items.forEach((item) => item.reject(err)))
        .finally(() => {
          inflight--;
          pump();
        });
    }
  };

  const flush = (system: string) => {
    const batch = pending.get(system);
    if (!batch) return;
    clearTimeout(batch.timer);
    pending.delete(system);
    queue.push(batch);
    pump();
  };

  const enqueue = (system: string, item: Item) => {
    const batch = pending.get(system);
    if (
      batch &&
      (batch.items.length >= MAX_BATCH_ITEMS || batch.chars + item.text.length > MAX_BATCH_CHARS)
    ) {
      flush(system);
    }
    let current = pending.get(system);
    if (!current) {
      current = { system, items: [], chars: 0 };
      current.timer = setTimeout(() => flush(system), BATCH_DELAY_MS);
      pending.set(system, current);
    }
    current.items.push(item);
    current.chars += item.text.length;
  };

  return {
    name: `${CUSTOM_TRANSLATOR_PREFIX}${config.id}`,
    label: config.name,
    concurrency: 16,
    getCacheKey: (sourceLang, targetLang, context) =>
      `${CUSTOM_TRANSLATOR_PREFIX}${config.id}#${md5Fingerprint(
        `${config.model}\n${renderSystem(sourceLang, targetLang, context)}`,
      )}`,
    translate: async (texts, sourceLang, targetLang, _token, _useCache, signal, context) => {
      signal?.throwIfAborted();
      const system = renderSystem(sourceLang, targetLang, context);
      const items: Item[] = [];
      const results = texts.map((text) => {
        if (!text?.trim()) return Promise.resolve(text);
        return new Promise<string>((resolve, reject) => {
          const item: Item = { text, resolve, reject };
          items.push(item);
          enqueue(system, item);
        });
      });
      const all = Promise.all(results);
      if (!signal) return all;
      return new Promise<string[]>((resolve, reject) => {
        const onAbort = () => {
          items.forEach((item) => (item.cancelled = true));
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        all.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
      });
    },
  };
};
