// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  premium: true,
  location: '',
  generateChatText: vi.fn(),
  bookData: {} as Record<string, unknown>,
  appService: {} as Record<string, unknown>,
}));

vi.mock('@/utils/access', () => ({
  getSignedInToken: () => 'token',
  isCustomTranslatorAllowed: () => h.premium,
}));
vi.mock('@/services/translators/custom/openaiCompatible', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/translators/custom/openaiCompatible')>()),
  generateChatText: h.generateChatText,
}));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  default: { getAppService: async () => h.appService },
}));
vi.mock('@/store/readerProgressStore', () => ({
  getBookProgress: () => ({ location: h.location }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: { getState: () => ({ getBookData: () => h.bookData }) },
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: { getState: () => ({ getViewSettings: () => ({ translateTargetLang: 'de' }) }) },
}));

import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { xrayProvider } from '@/services/dictionaries/providers/xrayProvider';
import { readPassages, type XRayPassage } from '@/services/xray/bookText';
import { extractXRay, groundXRay } from '@/services/xray/extract';
import { XRay } from '@/services/xray/snapshot';
import { cfiOfMention, findMentions } from '@/services/xray/mentions';
import { __resetXRayStoreForTests } from '@/services/xray/store';
import {
  clearBookXRay,
  getBookXRay,
  stopXRayUpdate,
  updateXRay,
  useXRayStore,
} from '@/services/xray/xrayService';
import type { XRayData } from '@/services/xray/types';
import type { BookDoc } from '@/libs/document';
import { useCustomTranslatorStore } from '@/store/customTranslatorStore';

const BOOK = 'hash-1';
const mergeXRay = (batches: XRayData[]) => {
  const xray = new XRay();
  for (const batch of batches) xray.add(batch);
  return xray;
};
const CHAPTERS = [
  'Anna met Boris in Kazan. ',
  'Boris betrayed Anna at sea. ',
  'Anna forgave Boris. ',
];

const createBook = (repeat = 60) => {
  const parsed: number[] = [];
  const sections = CHAPTERS.map((text, index) => ({
    createDocument: async () => {
      parsed.push(index);
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = `<p>${text.repeat(repeat)}</p>`;
      return doc;
    },
  }));
  return { bookDoc: { sections } as unknown as BookDoc, parsed };
};
const pageAt = (section: number, offset = 0) => `epubcfi(/6/${(section + 1) * 2}!/4/2/1:${offset})`;
const collect = async (bookDoc: BookDoc, position: number, location: string) => {
  const passages: XRayPassage[] = [];
  for await (const passage of readPassages(bookDoc, position, location)) passages.push(passage);
  return passages;
};

const entity = (name: string, quote: string, passage = 0, aliases: string[] = []) => ({
  name,
  type: 'character',
  aliases,
  description: `${name} description`,
  facts: [{ key: 'Home', value: 'Kazan' }],
  quotes: [{ passage, text: quote }],
});
const reply = (...entities: object[]) => JSON.stringify({ entities });

let db: NodeDatabaseService;
beforeEach(async () => {
  db = (await NodeDatabaseService.open(':memory:')) as NodeDatabaseService;
  await migrate(db, getMigrations('xray'));
  h.appService = { openDatabase: async () => db };
  h.premium = true;
  h.generateChatText.mockReset();
  useCustomTranslatorStore.setState({
    loaded: true,
    translators: [{ id: 'llm', type: 'openai-compatible', name: 'LLM', addedAt: 1, updatedAt: 1 }],
  });
  useXRayStore.setState({ updates: {}, revision: 0 });
  __resetXRayStoreForTests();
});
afterEach(() => db.close());

describe('a book without text, such as a comic', () => {
  it('has no passages and no mentions', async () => {
    const sections = [{ load: async () => 'page.jpg' }, { load: async () => 'page.jpg' }];
    const bookDoc = { sections } as unknown as BookDoc;
    await expect(collect(bookDoc, -1, pageAt(1))).resolves.toEqual([]);
    await expect(findMentions(bookDoc, pageAt(1), ['Anna'], 2)).resolves.toEqual({
      count: 0,
      mentions: [],
    });
  });
});

describe('readPassages', () => {
  it('ends before the page being read and parses only the sections it needs', async () => {
    const { bookDoc, parsed } = createBook();
    const read = await collect(bookDoc, -1, pageAt(1, 1100));
    expect(read.some(({ text }) => text.includes('met Boris'))).toBe(true);
    expect(read.filter(({ text }) => text.includes('betrayed')).length).toBeGreaterThan(0);
    expect(read.at(-1)!.text.length).toBeLessThan(1000);
    expect(read.some(({ text }) => text.includes('forgave'))).toBe(false);

    parsed.length = 0;
    const next = await collect(bookDoc, read.at(-1)!.position, pageAt(2));
    expect(next.every(({ text }) => text.includes('betrayed'))).toBe(true);
    expect(parsed).not.toContain(0);
    // Nothing is read twice, and nothing is skipped.
    expect([...read, ...next].map(({ text }) => text).join('')).toBe(
      `${CHAPTERS[0]!.repeat(60)}${CHAPTERS[1]!.repeat(60)}`,
    );
  });
});

describe('groundXRay', () => {
  const passages: XRayPassage[] = [
    { position: 0, text: 'Soon Anna met Boris.', cfiAt: (offset) => `cfi-${offset}` },
    { position: 1, text: 'Then Clara left.', cfiAt: (offset) => `next-${offset}` },
  ];

  it('keeps only items quoted from the passages sent', () => {
    const data = groundXRay(
      {
        entities: [
          entity('Anna', 'Anna met Boris.'),
          entity('Boris', 'Boris is the killer.'),
          { name: 'broken' },
        ],
        events: 'not a list',
      },
      passages,
    );
    expect(data.entities.map(({ name }) => name)).toEqual(['Anna']);
    expect(data.entities[0]!.quotes).toEqual([{ text: 'Anna met Boris.', cfi: 'cfi-5' }]);
    expect(data.events).toEqual([]);
  });

  it('places a verbatim quote that the reply says is in another passage', () => {
    // Local models often number the passage wrong, then every item was lost.
    const data = groundXRay(
      { entities: [entity('Clara', 'Clara left.', 0), entity('Anna', 'Anna met Boris.', 7)] },
      passages,
    );
    expect(data.entities.map(({ quotes }) => quotes)).toEqual([
      [{ text: 'Clara left.', cfi: 'next-5' }],
      [{ text: 'Anna met Boris.', cfi: 'cfi-5' }],
    ]);
  });
});

describe('extractXRay', () => {
  afterEach(() => vi.useRealTimers());

  it('waits for a busy server to start its reply, then stops one gone silent', async () => {
    vi.useFakeTimers();
    let options!: { abortSignal: AbortSignal; onProgress: (type: string) => void };
    h.generateChatText.mockImplementation((_translator, sent) => {
      options = sent;
      return new Promise(() => {});
    });
    const passages = [{ position: 0, text: 'Soon Anna met Boris.', cfiAt: () => '' }];
    const input = { bookTitle: 'Sea', bookAuthor: 'A', sourceLang: 'en', targetLang: 'de' };
    const translator = useCustomTranslatorStore.getState().translators[0]!;
    void extractXRay(translator, passages, [], input, new AbortController().signal).catch(() => {});
    // The SDK starts its stream at once; a local server answers one request at
    // a time, so the others sent with it wait their turn.
    options.onProgress('start');
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(options.abortSignal.aborted).toBe(false);
    options.onProgress('text-delta');
    await vi.advanceTimersByTimeAsync(59_000);
    expect(options.abortSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(options.abortSignal.aborted).toBe(true);
  });
});

describe('XRay', () => {
  const batch = (name: string, aliases: string[], cfi: string): XRayData => ({
    entities: [
      {
        name,
        type: 'character',
        aliases,
        description: name,
        facts: [],
        quotes: [{ text: name, cfi }],
      },
    ],
    relationships: [],
    events: [],
  });

  it('joins one character met under several names', () => {
    const merged = mergeXRay([
      batch('Anna', [], 'a'),
      batch('Anna Petrovna', ['anna'], 'b'),
      batch('Mrs. Petrovna', ['Anna Petrovna'], 'c'),
    ]);
    expect(merged.entities).toHaveLength(1);
    expect(merged.entities[0]!.aliases).toEqual(['Anna Petrovna', 'Mrs. Petrovna']);
    expect(merged.find(' mrs.  petrovna')?.name).toBe('Anna');
  });

  it('joins two names once the book says they are one, and not for a shared alias', () => {
    const merged = mergeXRay([
      batch('Mr. Darcy', ['the gentleman'], 'a'),
      batch('Fitzwilliam Darcy', [], 'b'),
      batch('Mr. Wickham', ['the gentleman'], 'c'),
      batch('Fitzwilliam Darcy', ['Mr. Darcy', 'Darcy'], 'd'),
    ]);
    expect(merged.entities.map(({ name }) => name)).toEqual(['Mr. Darcy', 'Mr. Wickham']);
    expect(merged.find('darcy')).toBe(merged.find('Fitzwilliam Darcy'));
    expect(merged.find('Darcy')?.quotes.map(({ cfi }) => cfi)).toEqual(['a', 'b', 'd']);
  });
});

describe('XRay links', () => {
  it('connects the two ends of a relationship, by any of their names', () => {
    const person = (name: string, aliases: string[] = []) => ({
      ...entity(name, ''),
      type: 'character' as const,
      aliases,
      quotes: [],
    });
    const anna = person('Anna', ['Mrs. Petrovna']);
    const boris = person('Boris');
    const data: XRayData = {
      entities: [anna, boris],
      relationships: [{ source: 'mrs. petrovna', target: 'Boris', type: 'mother of', quotes: [] }],
      events: [],
    };
    const xray = mergeXRay([data]);
    expect(xray.linksOf(xray.find('Anna')!)[0]!.other?.name).toBe('Boris');
    expect(xray.linksOf(xray.find('boris')!)[0]!.other?.name).toBe('Anna');
  });
});

describe('findMentions', () => {
  it('counts a name as a word up to the page, and keeps the first and latest', async () => {
    const sections = [
      '<p>Ann saw Anna. Annabel and JoAnna slept.</p>',
      '<p>Later\n   Anna &amp; Boris left.</p><p>“No!” Anna wept.</p>',
      '<p>Anna died.</p>',
    ].map((html) => ({
      createDocument: async () => {
        const doc = document.implementation.createHTMLDocument();
        doc.body.innerHTML = html;
        return doc;
      },
    }));
    const bookDoc = { sections } as unknown as BookDoc;
    const { count, mentions } = await findMentions(bookDoc, pageAt(2), ['Anna'], 2);
    expect(count).toBe(3);
    expect(mentions.map(({ text }) => text)).toEqual(['Ann saw Anna.', 'Anna wept.']);
    // The quote's CFI is the name's own place, past the collapsed white space.
    const later = await findMentions(bookDoc, pageAt(2), ['Boris'], 2);
    expect(await cfiOfMention(bookDoc, later.mentions[0]!)).toBe('epubcfi(/6/4!/4/2/1:16)');
  });
});

describe('updateXRay', () => {
  beforeEach(() => {
    h.bookData = {
      book: { title: 'Sea', author: 'A', primaryLanguage: 'en' },
      bookDoc: createBook().bookDoc,
    };
  });

  it('stays spoiler-free when the reader goes back, and never asks twice', async () => {
    h.generateChatText.mockResolvedValueOnce(reply(entity('Anna', 'Anna met Boris in Kazan.')));
    h.location = pageAt(1);
    await updateXRay(BOOK);
    h.generateChatText.mockResolvedValueOnce(reply(entity('Boris', 'Boris betrayed Anna at sea.')));
    h.location = pageAt(2);
    await updateXRay(BOOK);
    await updateXRay(BOOK);
    expect(h.generateChatText).toHaveBeenCalledTimes(2);
    expect((await getBookXRay(BOOK))!.entities.map(({ name }) => name)).toEqual(['Anna', 'Boris']);

    h.location = pageAt(1);
    expect((await getBookXRay(BOOK))!.entities.map(({ name }) => name)).toEqual(['Anna']);
    h.location = pageAt(0);
    expect(await getBookXRay(BOOK)).toBeNull();

    // Also from disk.
    __resetXRayStoreForTests();
    h.location = pageAt(1);
    expect((await getBookXRay(BOOK))!.entities.map(({ name }) => name)).toEqual(['Anna']);
  });

  it('leaves a partial batch for later while reading', async () => {
    h.location = pageAt(1);
    await updateXRay(BOOK, { wholeBatches: true });
    expect(h.generateChatText).not.toHaveBeenCalled();
  });

  it('tells the AI which names the X-Ray already has', async () => {
    h.generateChatText.mockResolvedValue(reply(entity('Anna', 'Anna met Boris in Kazan.')));
    h.location = pageAt(1);
    await updateXRay(BOOK);
    h.location = pageAt(2);
    await updateXRay(BOOK);
    const prompts = h.generateChatText.mock.calls.map(([, { prompt }]) => JSON.parse(prompt));
    expect(prompts.map(({ known }) => known)).toEqual([[], ['Anna']]);
  });

  describe('with a long book', () => {
    const passagesOf = ([, options]: unknown[]): string[] =>
      JSON.parse((options as { prompt: string }).prompt).passages;
    const answer = (index: number) => reply(entity(`Name ${index}`, 'Anna met Boris in Kazan.'));
    beforeEach(() => {
      h.bookData['bookDoc'] = createBook(2500).bookDoc;
      h.location = pageAt(1);
    });

    it('asks several batches at once and saves them in reading order', async () => {
      const waiting: ((text: string) => void)[] = [];
      h.generateChatText.mockImplementation(() => new Promise((done) => waiting.push(done)));
      const update = updateXRay(BOOK);
      await vi.waitFor(() => expect(waiting).toHaveLength(4));
      for (const index of [3, 2, 1]) waiting[index]!(answer(index));
      await new Promise((done) => setTimeout(done, 20));
      expect(await getBookXRay(BOOK)).toBeNull();
      waiting[0]!(answer(0));
      await vi.waitFor(() => expect(waiting.length).toBeGreaterThan(5));
      for (let i = 4; i < 6; i++) waiting[i]!(answer(i));
      await vi.waitFor(() => expect(useXRayStore.getState().revision).toBe(6));
      await update;
      expect(h.generateChatText).toHaveBeenCalledTimes(6);
      const sent = h.generateChatText.mock.calls.flatMap(passagesOf).join('');
      expect(sent).toBe(CHAPTERS[0]!.repeat(2500));
    });

    it('keeps the batches before a failure and reads on from there', async () => {
      h.generateChatText.mockImplementation(async () => {
        const call = h.generateChatText.mock.calls.length;
        if (call === 3) throw new Error('quota');
        return answer(call);
      });
      await updateXRay(BOOK);
      expect(useXRayStore.getState().updates['hash']).toEqual({ running: false, error: 'quota' });
      expect(useXRayStore.getState().revision).toBe(2);
      h.generateChatText.mockClear();
      h.generateChatText.mockImplementation(async () => answer(9));
      await updateXRay(BOOK);
      expect(h.generateChatText).toHaveBeenCalledTimes(4);
    });

    it('stops without an error when asked to', async () => {
      h.generateChatText.mockImplementation(
        (_translator: unknown, { abortSignal }: { abortSignal: AbortSignal }) =>
          new Promise((_done, fail) =>
            abortSignal.addEventListener('abort', () => fail(new Error('aborted'))),
          ),
      );
      const update = updateXRay(BOOK);
      await vi.waitFor(() => expect(h.generateChatText).toHaveBeenCalled());
      stopXRayUpdate(BOOK);
      await update;
      expect(useXRayStore.getState().updates['hash']).toEqual({ running: false });
    });
  });

  it('is cleared only once confirmed', async () => {
    h.generateChatText.mockResolvedValue(reply(entity('Anna', 'Anna met Boris in Kazan.')));
    h.location = pageAt(1);
    await updateXRay(BOOK);
    h.appService['ask'] = async () => false;
    await clearBookXRay(BOOK, 'Sure?');
    expect(await getBookXRay(BOOK)).not.toBeNull();
    h.appService['ask'] = async () => true;
    await clearBookXRay(BOOK, 'Sure?');
    expect(await getBookXRay(BOOK)).toBeNull();
  });

  it('asks nothing without premium', async () => {
    h.premium = false;
    h.location = pageAt(2);
    await updateXRay(BOOK);
    expect(h.generateChatText).not.toHaveBeenCalled();
  });

  it('keeps a failure to show, and what was read before it', async () => {
    h.generateChatText.mockResolvedValueOnce(reply(entity('Anna', 'Anna met Boris in Kazan.')));
    h.location = pageAt(1);
    await updateXRay(BOOK);
    h.generateChatText.mockRejectedValueOnce(new Error('quota'));
    h.location = pageAt(2);
    await updateXRay(BOOK);
    expect(useXRayStore.getState().updates['hash']).toEqual({ running: false, error: 'quota' });
    expect((await getBookXRay(BOOK))!.entities).toHaveLength(1);
  });

  it('answers a lookup from what was read, without asking the AI', async () => {
    h.generateChatText.mockResolvedValueOnce(reply(entity('Anna', 'Anna met Boris in Kazan.')));
    h.location = pageAt(1);
    await updateXRay(BOOK);
    const container = document.createElement('div');
    const lookUp = (word: string) =>
      xrayProvider.lookup(word, {
        container,
        signal: new AbortController().signal,
        selection: { before: '', after: '', bookKey: BOOK },
      });
    expect(await lookUp('anna')).toMatchObject({ ok: true, headword: 'Anna' });
    expect(container.textContent).toContain('Anna met Boris in Kazan.');
    expect(await lookUp('Zoe')).toEqual({ ok: false, reason: 'empty' });
    expect(h.generateChatText).toHaveBeenCalledTimes(1);
    h.premium = false;
    expect(await lookUp('anna')).toEqual({ ok: false, reason: 'unsupported' });
  });
});
