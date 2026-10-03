import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookupInContext: vi.fn(),
  premium: true,
}));

vi.mock('@/services/dictionaries/contextDictionary', () => ({
  lookupInContext: mocks.lookupInContext,
}));
vi.mock('@/utils/access', () => ({
  getAccessToken: async () => 'token',
  isCustomTranslatorAllowed: () => mocks.premium,
}));

import { contextProvider } from '@/services/dictionaries/providers/contextProvider';
import { useCustomTranslatorStore } from '@/store/customTranslatorStore';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import type { CustomTranslator } from '@/types/translation';

const llm = (id: string, patch: Partial<CustomTranslator> = {}): CustomTranslator => ({
  id,
  type: 'openai-compatible',
  name: `LLM ${id}`,
  baseUrl: 'https://llm.example.com/v1',
  model: 'gpt-test',
  addedAt: 1,
  updatedAt: 1,
  ...patch,
});

const entry = {
  headword: 'bank',
  pronunciation: '/bæŋk/',
  grammar: 'noun',
  definition: 'the land beside a river',
  explanation: 'The river side, not a money bank.',
  examples: [{ sentence: 'They sat on the bank.', explanation: 'river side' }],
  synonyms: [{ phrase: 'shore', nuance: 'seas and lakes' }],
};

const lookup = (container = document.createElement('div')) =>
  contextProvider.lookup('bank', {
    lang: 'en',
    signal: new AbortController().signal,
    container,
    selection: {
      before: 'We walked along the',
      after: 'until dusk.',
      bookTitle: 'River',
      targetLang: 'fr',
    },
  });

const setTranslators = (translators: CustomTranslator[], contextTranslatorId?: string) => {
  useCustomTranslatorStore.setState({ translators, loaded: true });
  useCustomDictionaryStore.setState((state) => ({
    settings: { ...state.settings, contextTranslatorId },
  }));
};

describe('context dictionary provider', () => {
  beforeEach(() => {
    mocks.lookupInContext.mockReset();
    mocks.premium = true;
  });

  it('is unsupported without an OpenAI-compatible translator', async () => {
    setTranslators([{ ...llm('deepl'), type: 'deepl' }, llm('off', { disabled: true })]);
    expect(await lookup()).toEqual({ ok: false, reason: 'unsupported' });
    expect(mocks.lookupInContext).not.toHaveBeenCalled();
  });

  it('is unsupported without premium', async () => {
    mocks.premium = false;
    setTranslators([llm('a')]);
    expect(await lookup()).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('asks the chosen translator with the selection context and renders the entry', async () => {
    setTranslators([llm('a'), llm('b')], 'b');
    mocks.lookupInContext.mockResolvedValue(entry);
    const container = document.createElement('div');

    const outcome = await lookup(container);

    expect(outcome).toEqual({ ok: true, headword: 'bank', sourceLabel: 'LLM b' });
    const [translator, input] = mocks.lookupInContext.mock.calls[0]!;
    expect(translator.id).toBe('b');
    expect(input).toMatchObject({
      text: 'bank',
      before: 'We walked along the',
      after: 'until dusk.',
      sourceLang: 'en',
      targetLang: 'fr',
      bookTitle: 'River',
    });
    expect(container.querySelector('h1')?.textContent).toBe('bank');
    expect(container.textContent).toContain('/bæŋk/');
    expect(container.textContent).toContain('the land beside a river');
    expect(container.textContent).toContain('They sat on the bank.');
    expect(container.textContent).toContain('shore');
  });

  it('falls back to the first translator when the chosen one is gone', async () => {
    setTranslators([llm('a')], 'deleted');
    mocks.lookupInContext.mockResolvedValue(entry);
    await lookup();
    expect(mocks.lookupInContext.mock.calls[0]![0].id).toBe('a');
  });

  it('shows why the lookup failed instead of hiding the card', async () => {
    setTranslators([llm('a')]);
    mocks.lookupInContext.mockRejectedValue(new Error('Unauthorized'));
    const container = document.createElement('div');

    const outcome = await lookup(container);

    expect(outcome.ok).toBe(true);
    expect(container.textContent).toContain('Unauthorized');
  });

  it('does not render an entry for a lookup cancelled while it was pending', async () => {
    setTranslators([llm('a')]);
    const controller = new AbortController();
    mocks.lookupInContext.mockImplementation(async () => {
      controller.abort();
      return entry;
    });
    const container = document.createElement('div');

    const outcome = await contextProvider.lookup('bank', {
      signal: controller.signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    expect(container.childElementCount).toBe(0);
  });
});
