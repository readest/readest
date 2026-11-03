import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: generateTextMock };
});
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => vi.fn() }));

import {
  buildSelectionContext,
  lookupInContext,
  parseContextEntry,
  __clearContextCacheForTests,
} from '@/services/dictionaries/contextDictionary';
import type { CustomTranslator } from '@/types/translation';

const translator: CustomTranslator = {
  id: 'llm',
  type: 'openai-compatible',
  name: 'My LLM',
  baseUrl: 'https://llm.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-test',
  addedAt: 1,
  updatedAt: 1,
};

const entryJson = JSON.stringify({
  headword: 'bank',
  pronunciation: '/bæŋk/',
  grammar: 'noun',
  definition: 'the land beside a river',
  explanation: 'Here it is the river side, not a money bank.',
  examples: [{ sentence: 'They sat on the bank.', explanation: 'river side' }],
  synonyms: [{ phrase: 'shore', nuance: 'used for seas and lakes' }],
});

const selectWord = (doc: Document, word: string) => {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const index = node.data.indexOf(word);
    if (index >= 0) {
      const range = doc.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + word.length);
      return range;
    }
  }
  throw new Error(`${word} not found`);
};

describe('buildSelectionContext', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<p>The river ran fast.</p>' +
      '<p>We walked along the <em>bank</em> until dusk.</p>' +
      '<p>Then it rained.</p>' +
      '<p>Far away.</p>';
  });

  it('takes the text around the selection from its paragraph and the neighbouring ones', () => {
    const context = buildSelectionContext(selectWord(document, 'bank'));
    expect(context.before).toBe('The river ran fast. We walked along the');
    expect(context.after).toBe('until dusk. Then it rained.');
  });

  it('keeps the text nearest to the selection when the passage is too long', () => {
    const context = buildSelectionContext(selectWord(document, 'bank'), 12);
    expect(context.before).toBe('along the');
    expect(context.after).toBe('until dusk.');
  });
});

describe('parseContextEntry', () => {
  it('reads a fenced reply after a reasoning block', () => {
    const entry = parseContextEntry('<think>hmm</think>\n```json\n' + entryJson + '\n```');
    expect(entry.headword).toBe('bank');
    expect(entry.definition).toBe('the land beside a river');
    expect(entry.examples).toEqual([
      { sentence: 'They sat on the bank.', explanation: 'river side' },
    ]);
    expect(entry.synonyms).toEqual([{ phrase: 'shore', nuance: 'used for seas and lakes' }]);
  });

  it('drops malformed list items and missing optional fields', () => {
    const entry = parseContextEntry(
      JSON.stringify({
        headword: 'bank',
        definition: 'river side',
        examples: [{ sentence: '' }, 'oops', { sentence: 'On the bank.' }],
        synonyms: null,
      }),
    );
    expect(entry.pronunciation).toBeUndefined();
    expect(entry.examples).toEqual([{ sentence: 'On the bank.', explanation: '' }]);
    expect(entry.synonyms).toEqual([]);
  });

  it('rejects a reply without a definition', () => {
    expect(() => parseContextEntry('{"headword":"bank"}')).toThrow();
    expect(() => parseContextEntry('not json')).toThrow();
  });
});

describe('lookupInContext', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    __clearContextCacheForTests();
  });

  const input = {
    text: 'bank',
    before: 'We walked along the',
    after: 'until dusk.',
    sourceLang: 'en',
    targetLang: 'fr',
    bookTitle: 'River',
    bookAuthor: 'Ann',
  };

  it('asks the model with the passage and the explanation language', async () => {
    generateTextMock.mockResolvedValue({ text: entryJson });
    const entry = await lookupInContext(translator, input, new AbortController().signal);
    expect(entry.definition).toBe('the land beside a river');

    const args = generateTextMock.mock.calls[0]![0] as { system: string; prompt: string };
    expect(args.system).toContain('French');
    expect(args.system).toContain('English');
    expect(JSON.parse(args.prompt)).toMatchObject({
      selectedText: 'bank',
      before: 'We walked along the',
      after: 'until dusk.',
      bookTitle: 'River',
      bookAuthor: 'Ann',
    });
  });

  it('uses custom instructions with book and language variables and accepts a prose reply', async () => {
    generateTextMock.mockResolvedValue({
      text: '<think>reasoning</think>\n## History\nA river bank.',
    });
    const result = await lookupInContext(translator, input, new AbortController().signal, {
      systemPrompt:
        'Explain {{sourceLang}} in {{targetLang}} for {{bookTitle}} by {{bookAuthor}}. Focus on etymology.',
      maxOutputTokens: 4096,
    });
    expect(result).toMatchObject({ headword: 'bank', markdown: '## History\nA river bank.' });
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'Explain English in French for River by Ann. Focus on etymology.',
        maxOutputTokens: 4096,
      }),
    );
  });

  it('does not reuse a response after instructions or the output limit changes', async () => {
    generateTextMock.mockResolvedValue({ text: 'History of the word.' });
    const signal = new AbortController().signal;
    await lookupInContext(translator, input, signal, {
      systemPrompt: 'History',
      maxOutputTokens: 512,
    });
    await lookupInContext(translator, input, signal, {
      systemPrompt: 'History',
      maxOutputTokens: 512,
    });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    await lookupInContext(translator, input, signal, {
      systemPrompt: 'Origins',
      maxOutputTokens: 512,
    });
    await lookupInContext(translator, input, signal, {
      systemPrompt: 'Origins',
      maxOutputTokens: 4096,
    });
    expect(generateTextMock).toHaveBeenCalledTimes(3);
  });

  it('rejects an empty custom response', async () => {
    generateTextMock.mockResolvedValue({ text: '<think>reasoning</think>' });
    await expect(
      lookupInContext(translator, input, new AbortController().signal, {
        systemPrompt: 'Explain the history.',
      }),
    ).rejects.toThrow('The AI provider returned an incomplete entry.');
  });

  it('answers a repeated lookup from the cache', async () => {
    generateTextMock.mockResolvedValue({ text: entryJson });
    await lookupInContext(translator, input, new AbortController().signal);
    await lookupInContext(translator, input, new AbortController().signal);
    expect(generateTextMock).toHaveBeenCalledTimes(1);

    await lookupInContext(
      translator,
      { ...input, after: 'at noon.' },
      new AbortController().signal,
    );
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });

  it('stops waiting when the lookup is cancelled', async () => {
    generateTextMock.mockImplementation(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (abortSignal.aborted) reject(new Error('aborted'));
          abortSignal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const controller = new AbortController();
    const pending = lookupInContext(translator, input, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
