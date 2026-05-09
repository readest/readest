import { describe, test, expect, vi, beforeEach } from 'vitest';
import { RSVPController } from '@/services/rsvp/RSVPController';
import { FoliateView } from '@/types/view';

const POSITION_KEY = 'readest_rsvp_pos_test';

function makeTextNode(text: string): Text {
  return { nodeType: Node.TEXT_NODE, textContent: text } as unknown as Text;
}

function makeDoc(text: string): Document {
  const textNode = makeTextNode(text);
  const body = {
    nodeType: Node.ELEMENT_NODE,
    tagName: 'BODY',
    childNodes: [textNode],
    ownerDocument: null as unknown as Document,
  } as unknown as HTMLElement;

  const doc = {
    body,
    createRange: vi.fn().mockReturnValue({
      setStart: vi.fn(),
      setEnd: vi.fn(),
    }),
    defaultView: {
      getComputedStyle: vi.fn().mockReturnValue({ display: 'block', visibility: 'visible' }),
    },
  } as unknown as Document;

  (body as unknown as { ownerDocument: Document }).ownerDocument = doc;
  (textNode as unknown as { ownerDocument: Document }).ownerDocument = doc;
  return doc;
}

function createMockView(primaryIndex: number, docs: Document[]): FoliateView {
  return {
    renderer: {
      primaryIndex,
      getContents: vi.fn().mockReturnValue(docs.map((doc, i) => ({ doc, index: i }))),
    },
    book: { toc: [] },
    language: { isCJK: false },
    tts: null,
    getCFI: vi.fn().mockReturnValue('epubcfi(/6/4!/4/2/1:0)'),
    resolveCFI: vi.fn().mockReturnValue({ anchor: vi.fn().mockReturnValue(new Range()) }),
  } as unknown as FoliateView;
}

describe('RSVPController', () => {
  describe('start()', () => {
    test('extracts words from primary spine document only', () => {
      const ch1Doc = makeDoc('Hello world');
      const ch2Doc = makeDoc('Foo bar baz');
      const view = createMockView(0, [ch1Doc, ch2Doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      controller.start();

      // Should only have words from doc at primaryIndex 0
      expect(controller.currentState.words.length).toBe(2);
      expect(controller.currentState.words[0]!.text).toBe('Hello');
      expect(controller.currentState.words[1]!.text).toBe('world');
    });

    test('sets active state after start', () => {
      const doc = makeDoc('one two three');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      controller.start();

      expect(controller.currentState.active).toBe(true);
      expect(controller.currentState.currentIndex).toBe(0);
    });

    test('uses secondary doc when primaryIndex is 1', () => {
      const ch1Doc = makeDoc('Hello world');
      const ch2Doc = makeDoc('Foo bar');
      const view = createMockView(1, [ch1Doc, ch2Doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      controller.start();

      expect(controller.currentState.words.length).toBe(2);
      expect(controller.currentState.words[0]!.text).toBe('Foo');
    });
  });

  describe('currentDisplayWord', () => {
    test('returns full word when splitHyphens is false', () => {
      const doc = makeDoc('well-known');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setSplitHyphens(false);
      controller.start();

      expect(controller.currentDisplayWord?.text).toBe('well-known');
    });

    test('returns first part only when splitHyphens is true', () => {
      const doc = makeDoc('well-known');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setSplitHyphens(true);
      controller.start();

      expect(controller.currentDisplayWord?.text).toBe('well-');
    });

    test('returns unsplit word when splitHyphens is true but no hyphen pattern', () => {
      const doc = makeDoc('hello');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setSplitHyphens(true);
      controller.start();

      expect(controller.currentDisplayWord?.text).toBe('hello');
    });
  });

  describe('ORP calculation', () => {
    test('places ORP near the start of short Latin words', () => {
      const doc = makeDoc('Hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      // 5-letter words: ORP at index 1
      expect(words[0]!.orpIndex).toBe(1);
      expect(words[1]!.orpIndex).toBe(1);
    });

    test('places ORP based on letter count for Cyrillic words', () => {
      // "Привет" = 6 letters, "мир" = 3 letters
      const doc = makeDoc('Привет мир');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      expect(words[0]!.text).toBe('Привет');
      // 6-letter word should have ORP at index 2 (same as Latin "Hellos")
      expect(words[0]!.orpIndex).toBe(2);
      expect(words[1]!.text).toBe('мир');
      // 3-letter word: ORP at index 0
      expect(words[1]!.orpIndex).toBe(0);
    });

    test('places ORP based on letter count for accented Latin words', () => {
      // "naïve" = 5 letters with combining/precomposed diacritic
      const doc = makeDoc('naïve');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      expect(words[0]!.text).toBe('naïve');
      // Should be treated as a 5-letter word, ORP at index 1
      expect(words[0]!.orpIndex).toBe(1);
    });
  });

  describe('seedPosition', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    test('overwrites stale local position with cloud-synced position', () => {
      // Device B has a stale local entry from a previous session.
      const stale = { cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'stale' };
      localStorage.setItem(POSITION_KEY, JSON.stringify(stale));

      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      // Cloud-synced position arrives via BookConfig.rsvpPosition.
      const fresh = { cfi: 'epubcfi(/6/8!/4/2/1:0)', wordText: 'fresh' };
      controller.seedPosition(fresh);

      expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual(fresh);
    });

    test('writes provided position when localStorage is empty', () => {
      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const position = { cfi: 'epubcfi(/6/8!/4/2/1:0)', wordText: 'fresh' };
      controller.seedPosition(position);

      expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual(position);
    });

    test('skips redundant write when value already matches', () => {
      const position = { cfi: 'epubcfi(/6/8!/4/2/1:0)', wordText: 'same' };
      localStorage.setItem(POSITION_KEY, JSON.stringify(position));

      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      controller.seedPosition(position);

      const positionWrites = setItemSpy.mock.calls.filter(([key]) => key === POSITION_KEY);
      expect(positionWrites).toHaveLength(0);
      setItemSpy.mockRestore();
    });

    test('falls back to start of synced chapter when rsvpPosition is in a different chapter than location', () => {
      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const stalePosition = { cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'stale' };
      const currentLocation = 'epubcfi(/6/8!/4/2/1:0)';

      controller.seedPosition(stalePosition, currentLocation);

      expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual({
        cfi: 'epubcfi(/6/8)',
        wordText: '',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[RSVP]'),
        expect.objectContaining({ rsvpCfi: stalePosition.cfi, locationCfi: currentLocation }),
      );
      warnSpy.mockRestore();
    });

    test('section-start fallback overwrites a stale local entry on chapter mismatch', () => {
      const stale = { cfi: 'epubcfi(/6/2!/4/2/1:0)', wordText: 'stale' };
      localStorage.setItem(POSITION_KEY, JSON.stringify(stale));

      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      controller.seedPosition(
        { cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'fresh' },
        'epubcfi(/6/8!/4/2/1:0)',
      );

      expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual({
        cfi: 'epubcfi(/6/8)',
        wordText: '',
      });
      warnSpy.mockRestore();
    });

    test('skips redundant write when section-start fallback already matches stored value', () => {
      const fallback = { cfi: 'epubcfi(/6/8)', wordText: '' };
      localStorage.setItem(POSITION_KEY, JSON.stringify(fallback));

      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      controller.seedPosition(
        { cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'fresh' },
        'epubcfi(/6/8!/4/2/1:0)',
      );

      const positionWrites = setItemSpy.mock.calls.filter(([key]) => key === POSITION_KEY);
      expect(positionWrites).toHaveLength(0);
      setItemSpy.mockRestore();
      warnSpy.mockRestore();
    });

    test('seeds normally when rsvpPosition and location share a spine section', () => {
      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const position = { cfi: 'epubcfi(/6/8!/4/2/1:0)', wordText: 'fresh' };
      const currentLocation = 'epubcfi(/6/8!/4/2/3:5)'; // same spine, different offset

      controller.seedPosition(position, currentLocation);

      expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual(position);
    });

    test('seeds normally when no current location is provided', () => {
      const doc = makeDoc('hello world');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');

      const position = { cfi: 'epubcfi(/6/4!/4/2/1:0)', wordText: 'fresh' };
      controller.seedPosition(position);

      expect(JSON.parse(localStorage.getItem(POSITION_KEY)!)).toEqual(position);
    });
  });

  describe('em-dash and en-dash splitting', () => {
    test('splits compound word joined by em-dash into separate words', () => {
      const doc = makeDoc('best—of all possible—worlds');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words.map((w) => w.text);
      expect(words).toEqual(['best—', 'of', 'all', 'possible—', 'worlds']);
    });

    test('splits compound word joined by en-dash into separate words', () => {
      const doc = makeDoc('pages 10–15 covered');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words.map((w) => w.text);
      expect(words).toEqual(['pages', '10–', '15', 'covered']);
    });
  });

  describe('duplicate word blank insertion', () => {
    test('inserts blank between two consecutive identical words', () => {
      const doc = makeDoc('the the cat');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      expect(words[0]!.text).toBe('the');
      expect(words[1]!.text).toBe(' ');
      expect(words[2]!.text).toBe('the');
      expect(words[3]!.text).toBe('cat');
    });

    test('does not insert blank between different words', () => {
      const doc = makeDoc('the cat');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const words = controller.currentState.words;
      expect(words.length).toBe(2);
      expect(words[0]!.text).toBe('the');
      expect(words[1]!.text).toBe('cat');
    });
  });
});
