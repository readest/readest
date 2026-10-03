/**
 * Built-in AI context dictionary (#5544).
 *
 * Explains the selection as it is used in its passage, through one of the
 * user's OpenAI-compatible custom translators. Custom translators are a
 * premium feature, so the provider is unsupported (its card hidden) without
 * premium or without such a translator.
 */
import i18n from '@/i18n/i18n';
import { getAccessToken, isCustomTranslatorAllowed } from '@/utils/access';
import { getTargetLang } from '@/utils/misc';
import { getLLMTranslators } from '@/store/customTranslatorStore';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import type { CustomTranslator } from '@/types/translation';
import type { DictionaryProvider } from '../types';
import { BUILTIN_PROVIDER_IDS } from '../types';
import { lookupInContext, type ContextEntry } from '../contextDictionary';

const _ = (key: string, options?: Record<string, string>) =>
  i18n.t(key, { defaultValue: key, ...options });

/** The translator the context dictionary asks, or undefined when none is usable. */
export const getContextTranslator = (): CustomTranslator | undefined => {
  const translators = getLLMTranslators();
  const id = useCustomDictionaryStore.getState().settings.contextTranslatorId;
  return translators.find((t) => t.id === id) ?? translators[0];
};

const append = (parent: HTMLElement, tag: string, className: string, text: string) => {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  parent.append(el);
  return el;
};

const renderEntry = (container: HTMLElement, word: string, entry: ContextEntry) => {
  const hgroup = document.createElement('hgroup');
  append(hgroup, 'h1', 'text-lg font-bold', entry.headword || word);
  const meta = [entry.pronunciation, entry.grammar].filter(Boolean).join(' · ');
  if (meta) append(hgroup, 'p', 'text-sm italic not-eink:opacity-75', meta);
  container.append(hgroup);

  append(container, 'p', 'mt-2 font-medium', entry.definition);
  if (entry.explanation) append(container, 'p', 'mt-2', entry.explanation);

  if (entry.examples.length) {
    append(container, 'h2', 'text-base font-semibold mt-4', _('Examples'));
    const ul = append(container, 'ul', 'list-disc ps-6', '');
    for (const { sentence, explanation } of entry.examples) {
      const li = append(ul, 'li', 'mt-1', '');
      append(li, 'span', 'italic', sentence);
      if (explanation) append(li, 'span', 'not-eink:opacity-75', ` — ${explanation}`);
    }
  }
  if (entry.synonyms.length) {
    append(container, 'h2', 'text-base font-semibold mt-4', _('Synonyms'));
    const ul = append(container, 'ul', 'list-disc ps-6', '');
    for (const { phrase, nuance } of entry.synonyms) {
      const li = append(ul, 'li', 'mt-1', '');
      append(li, 'span', 'font-medium', phrase);
      if (nuance) append(li, 'span', 'not-eink:opacity-75', ` — ${nuance}`);
    }
  }
};

export const contextProvider: DictionaryProvider = {
  id: BUILTIN_PROVIDER_IDS.context,
  kind: 'builtin',
  label: 'Context Dictionary',
  async lookup(word, ctx) {
    if (!isCustomTranslatorAllowed(await getAccessToken())) {
      return { ok: false, reason: 'unsupported' };
    }
    const translator = getContextTranslator();
    if (!translator) return { ok: false, reason: 'unsupported' };
    const { selection } = ctx;
    try {
      const entry = await lookupInContext(
        translator,
        {
          text: word,
          before: selection?.before ?? '',
          after: selection?.after ?? '',
          sourceLang: ctx.lang,
          targetLang: selection?.targetLang || getTargetLang(),
          bookTitle: selection?.bookTitle,
          bookAuthor: selection?.bookAuthor,
        },
        ctx.signal,
      );
      // A cache hit resolves without looking at the signal; once cancelled,
      // the container belongs to the next lookup.
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
      renderEntry(ctx.container, word, entry);
      return { ok: true, headword: entry.headword || word, sourceLabel: translator.name };
    } catch (err) {
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
      // Unlike a dictionary miss, a failed AI request (bad key, quota, model
      // name) is something the user has to fix, so it stays visible.
      append(
        ctx.container,
        'p',
        'text-sm text-error',
        _('Context Dictionary failed: {{message}}', {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return { ok: true, headword: word, sourceLabel: translator.name };
    }
  },
};
