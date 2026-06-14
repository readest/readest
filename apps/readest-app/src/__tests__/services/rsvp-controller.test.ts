import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
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
  // start() schedules a countdown (setInterval) which then schedules the
  // recurring word-advance (setTimeout). These tests assert synchronously and
  // never stop the controller, so on the real clock those timers fire ~1.5s
  // later — after the test file's jsdom env has been torn down — and throw an
  // unhandled error from emitStateChange's dispatchEvent (a stale-realm
  // CustomEvent), failing the whole run intermittently on CI. Fake only the
  // timer functions so they can never fire on the real clock; useRealTimers in
  // afterEach discards any still-pending fakes. Date/performance stay real, so
  // the CFI/position assertions are unaffected.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  describe('CJK character mode', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    test('cjkCharMode defaults to false and hasCJK is false for Latin text', () => {
      const view = createMockView(0, [makeDoc('Hello world')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      expect(controller.currentState.cjkCharMode).toBe(false);
      expect(controller.currentState.hasCJK).toBe(false);
    });

    test('hasCJK is true when the section contains CJK text', () => {
      const view = createMockView(0, [makeDoc('你好世界')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      expect(controller.currentState.hasCJK).toBe(true);
    });

    test('setCjkCharMode(true) re-segments the active section per-character', () => {
      const view = createMockView(0, [makeDoc('我喜欢阅读')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();
      controller.setCjkCharMode(true);

      expect(controller.currentState.words.map((w) => w.text)).toEqual([
        '我',
        '喜',
        '欢',
        '阅',
        '读',
      ]);
    });

    test('setCjkCharMode persists the choice to localStorage', () => {
      const view = createMockView(0, [makeDoc('你好')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setCjkCharMode(true);

      expect(localStorage.getItem('readest_rsvp_cjk_char_mode')).toBe('1');
    });

    test('keeps the focus character off trailing punctuation in char mode', () => {
      const view = createMockView(0, [makeDoc('是。')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setCjkCharMode(true);
      controller.start();

      const word = controller.currentState.words[0]!;
      expect(word.text).toBe('是。');
      // The focus must land on 是 (index 0), not the trailing 。
      expect(word.orpIndex).toBe(0);
    });

    test('char mode is restored from localStorage on construction', () => {
      localStorage.setItem('readest_rsvp_cjk_char_mode', '1');
      const view = createMockView(0, [makeDoc('我喜欢阅读')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      expect(controller.currentState.cjkCharMode).toBe(true);
      expect(controller.currentState.words.map((w) => w.text)).toEqual([
        '我',
        '喜',
        '欢',
        '阅',
        '读',
      ]);
    });
  });

  describe('start delay (#4478)', () => {
    const START_DELAY_KEY = 'readest_rsvp_start_delay';

    beforeEach(() => {
      localStorage.removeItem(START_DELAY_KEY);
    });

    test('defaults to a 3 second delay', () => {
      const view = createMockView(0, [makeDoc('one two three')]);
      const controller = new RSVPController(view, 'test-book-abc123');

      expect(controller.currentState.startDelaySeconds).toBe(3);
      expect(controller.getStartDelayOptions()).toEqual([0, 1, 2, 3]);
    });

    test('setStartDelay persists and is restored on construction', () => {
      const view = createMockView(0, [makeDoc('one two')]);
      const first = new RSVPController(view, 'test-book-abc123');
      first.setStartDelay(1);
      expect(first.currentState.startDelaySeconds).toBe(1);

      const second = new RSVPController(view, 'test-book-abc123');
      expect(second.currentState.startDelaySeconds).toBe(1);
    });

    test('counts down from N at one-second ticks before playing', () => {
      const view = createMockView(0, [makeDoc('one two three')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setStartDelay(3);
      controller.start();

      expect(controller.currentCountdown).toBe(3);
      vi.advanceTimersByTime(1000);
      expect(controller.currentCountdown).toBe(2);
      vi.advanceTimersByTime(1000);
      expect(controller.currentCountdown).toBe(1);
      vi.advanceTimersByTime(1000);
      expect(controller.currentCountdown).toBeNull();
    });

    test('a delay of 0 skips the countdown entirely and starts playing', () => {
      const view = createMockView(0, [makeDoc('one two three')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.setStartDelay(0);
      controller.start();

      expect(controller.currentCountdown).toBeNull();
      expect(controller.currentState.playing).toBe(true);
    });
  });

  describe('nextWord / prevWord (#4476)', () => {
    test('nextWord advances one word and pauses playback', () => {
      const view = createMockView(0, [makeDoc('one two three')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      expect(controller.currentState.currentIndex).toBe(0);
      controller.nextWord();
      expect(controller.currentState.currentIndex).toBe(1);
      expect(controller.currentState.playing).toBe(false);
    });

    test('prevWord steps back one word', () => {
      const view = createMockView(0, [makeDoc('one two three')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      controller.nextWord();
      controller.nextWord();
      controller.prevWord();
      expect(controller.currentState.currentIndex).toBe(1);
    });

    test('nextWord clamps at the last word', () => {
      const view = createMockView(0, [makeDoc('one two')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      controller.nextWord();
      controller.nextWord();
      expect(controller.currentState.currentIndex).toBe(1);
    });

    test('prevWord clamps at the first word', () => {
      const view = createMockView(0, [makeDoc('one two')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      controller.prevWord();
      expect(controller.currentState.currentIndex).toBe(0);
    });
  });

  describe('syncToCfi / setExternallyDriven (slice 3a, #3235)', () => {
    // These tests need REAL DOM ranges (not the stubbed createRange from
    // makeDoc) so compareBoundaryPoints works for containment + binary search.
    // Build a real jsdom document and a view whose resolveCFI maps a CFI to a
    // collapsed range at an arbitrary character offset in the section text.
    const TEXT = 'one two three four five six';
    // word offsets in TEXT:
    //   one   [0,3)   two [4,7)   three [8,13)   four [14,18)
    //   five  [19,23) six [24,27)

    function makeSyncFixture() {
      const doc = document.implementation.createHTMLDocument('sync');
      doc.body.innerHTML = `<p>${TEXT}</p>`;
      const textNode = doc.body.querySelector('p')!.firstChild as Text;

      // resolveCFI returns an anchor function producing a collapsed range at the
      // offset encoded in the test CFI: epubcfi(/6/2!/4/2/1:<offset>)
      const resolveCFI = vi.fn().mockImplementation((cfi: string) => {
        const m = cfi.match(/!\/4\/2\/1:(\d+)\)/);
        if (!m) return null;
        const offset = parseInt(m[1]!, 10);
        return {
          index: 0,
          anchor: (d: Document) => {
            const r = d.createRange();
            r.setStart(textNode, offset);
            r.setEnd(textNode, offset);
            return r;
          },
        };
      });

      const getCFI = vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0)');
      const view = {
        renderer: {
          primaryIndex: 0,
          getContents: vi.fn().mockReturnValue([{ doc, index: 0 }]),
        },
        book: { toc: [] },
        language: { isCJK: false },
        tts: null,
        getCFI,
        resolveCFI,
      } as unknown as FoliateView;

      const controller = new RSVPController(view, 'sync-book-abc123');
      controller.start();
      return { controller, view, getCFI, resolveCFI };
    }

    // CFI for docIndex 0 is spine step /6/2 (index = (2-2)/2 = 0).
    const cfiAt = (offset: number) => `epubcfi(/6/2!/4/2/1:${offset})`;

    test('containment: a CFI starting mid-token resolves to the CONTAINING word, not the next', () => {
      const { controller } = makeSyncFixture();
      // offset 9 lands inside "three" [8,13) — at the 'h'.
      const ok = controller.syncToCfi(cfiAt(9));
      expect(ok).toBe(true);
      // Must be "three" (index 2), NOT the next word "four".
      expect(controller.currentState.currentIndex).toBe(2);
      expect(controller.currentState.words[2]!.text).toBe('three');
    });

    test('monotonic forward: a sequence of forward CFIs maps to increasing indices', () => {
      const { controller } = makeSyncFixture();
      // Start of each word.
      expect(controller.syncToCfi(cfiAt(0))).toBe(true); // one
      expect(controller.currentState.currentIndex).toBe(0);
      expect(controller.syncToCfi(cfiAt(4))).toBe(true); // two
      expect(controller.currentState.currentIndex).toBe(1);
      expect(controller.syncToCfi(cfiAt(8))).toBe(true); // three
      expect(controller.currentState.currentIndex).toBe(2);
      expect(controller.syncToCfi(cfiAt(19))).toBe(true); // five
      expect(controller.currentState.currentIndex).toBe(4);
      expect(controller.syncToCfi(cfiAt(24))).toBe(true); // six
      expect(controller.currentState.currentIndex).toBe(5);
    });

    test('backward seek: a CFI before the cursor lands on the correct earlier word', () => {
      const { controller } = makeSyncFixture();
      // Advance the cursor forward first.
      controller.syncToCfi(cfiAt(24)); // six -> cursor at 5
      expect(controller.currentState.currentIndex).toBe(5);
      // Now seek backward (binary-search path); offset 5 is inside "two" [4,7).
      const ok = controller.syncToCfi(cfiAt(5));
      expect(ok).toBe(true);
      expect(controller.currentState.currentIndex).toBe(1);
      expect(controller.currentState.words[1]!.text).toBe('two');
    });

    test('gap fallback: a CFI in whitespace maps to the nearest following word', () => {
      const { controller } = makeSyncFixture();
      // offset 3 is the space between "one" [0,3) and "two" [4,7).
      const ok = controller.syncToCfi(cfiAt(3));
      expect(ok).toBe(true);
      // No word contains offset 3 -> nearest following word is "two" (index 1).
      expect(controller.currentState.currentIndex).toBe(1);
    });

    test('no-match: an unresolvable CFI returns false and leaves currentIndex unchanged (NOT 0)', () => {
      const { controller } = makeSyncFixture();
      // Move off index 0 first so we can prove it does not clamp back to 0.
      controller.syncToCfi(cfiAt(8)); // three -> index 2
      expect(controller.currentState.currentIndex).toBe(2);

      // A CFI that resolveCFI cannot resolve (no matching anchor pattern).
      const ok = controller.syncToCfi('epubcfi(/6/2!/9/9/9:bogus)');
      expect(ok).toBe(false);
      expect(controller.currentState.currentIndex).toBe(2);
    });

    test('no-match: an out-of-section CFI returns false and leaves currentIndex unchanged', () => {
      const { controller } = makeSyncFixture();
      controller.syncToCfi(cfiAt(8)); // index 2
      // Spine step /6/8 => index 3, a different section than docIndex 0.
      const ok = controller.syncToCfi('epubcfi(/6/8!/4/2/1:0)');
      expect(ok).toBe(false);
      expect(controller.currentState.currentIndex).toBe(2);
    });

    test('perf guard: view.getCFI is NOT called during a syncToCfi fast-path call', () => {
      const { controller, getCFI } = makeSyncFixture();
      getCFI.mockClear();
      const ok = controller.syncToCfi(cfiAt(9));
      expect(ok).toBe(true);
      expect(getCFI).not.toHaveBeenCalled();
    });

    test('setExternallyDriven(true) suspends auto-advance; (false) restores it', () => {
      const { controller } = makeSyncFixture();
      // Suspend BEFORE the start countdown elapses so no word timer ever arms.
      controller.setExternallyDriven(true);
      // Even after plenty of time, the auto-advance timer must not fire.
      vi.advanceTimersByTime(20000);
      expect(controller.currentState.currentIndex).toBe(0);

      // Restoring should let auto-advance resume.
      controller.setExternallyDriven(false);
      vi.advanceTimersByTime(20000);
      expect(controller.currentState.currentIndex).toBeGreaterThan(0);
    });

    test('syncToCfi displays the word without arming auto-advance (no scheduled next word)', () => {
      const { controller } = makeSyncFixture();
      controller.setExternallyDriven(true);

      controller.syncToCfi(cfiAt(8)); // three -> index 2
      expect(controller.currentState.currentIndex).toBe(2);
      // No timer was armed by syncToCfi: advancing time must not move the index.
      vi.advanceTimersByTime(20000);
      expect(controller.currentState.currentIndex).toBe(2);
    });
  });

  describe('estimator: driveEstimatedFromCfi (slice 5, #3235)', () => {
    // Non-Edge TTS only emits sentence-level marks. The estimator jumps RSVP to
    // the sentence's first word (syncToCfi) then SELF-PACES forward through the
    // following words on a timer at an estimated rate, capped so it can't run
    // away past the (unknown) sentence end. A new sentence drive re-syncs (snap).
    //
    // Build a long single-text-node section so there are plenty of words to
    // advance through and so the cap is reachable. Word i starts at offset i*5
    // ("wNNN " is padded to a fixed width so offsets are predictable).
    // Enough words that the cap (60) is reachable from both anchors used below
    // (10 and 20) without clamping to the last word: 20 + 60 = 80 < 100.
    const WORD_COUNT = 100;
    const WORD_WIDTH = 4; // "w000".."w099" -> 4 chars each, space-separated -> stride 5

    function makeEstimatorFixture() {
      const text = Array.from(
        { length: WORD_COUNT },
        (_, i) => `w${String(i).padStart(3, '0')}`,
      ).join(' ');
      const doc = document.implementation.createHTMLDocument('estimator');
      doc.body.innerHTML = `<p>${text}</p>`;
      const textNode = doc.body.querySelector('p')!.firstChild as Text;

      const resolveCFI = vi.fn().mockImplementation((cfi: string) => {
        const m = cfi.match(/!\/4\/2\/1:(\d+)\)/);
        if (!m) return null;
        const offset = parseInt(m[1]!, 10);
        return {
          index: 0,
          anchor: (d: Document) => {
            const r = d.createRange();
            r.setStart(textNode, offset);
            r.setEnd(textNode, offset);
            return r;
          },
        };
      });

      const view = {
        renderer: {
          primaryIndex: 0,
          getContents: vi.fn().mockReturnValue([{ doc, index: 0 }]),
        },
        book: { toc: [] },
        language: { isCJK: false },
        tts: null,
        getCFI: vi.fn().mockReturnValue('epubcfi(/6/2!/4/2/1:0)'),
        resolveCFI,
      } as unknown as FoliateView;

      const controller = new RSVPController(view, 'estimator-book-abc123');
      controller.start();
      return { controller, view };
    }

    // Offset for the start of word index `i` (stride 5: WORD_WIDTH + 1 space).
    const offsetOf = (i: number) => i * (WORD_WIDTH + 1);
    const cfiAt = (offset: number) => `epubcfi(/6/2!/4/2/1:${offset})`;
    const cfiOfWord = (i: number) => cfiAt(offsetOf(i));

    test('jumps to the sentence first word, then self-advances at the estimated rate', () => {
      const { controller } = makeEstimatorFixture();
      controller.setExternallyDriven(true);

      // ttsRate 1.0 -> 190 wpm -> ~316ms per word.
      controller.driveEstimatedFromCfi(cfiOfWord(10), 190);
      expect(controller.currentState.currentIndex).toBe(10);

      const perWordMs = 60000 / 190;
      vi.advanceTimersByTime(perWordMs + 5);
      expect(controller.currentState.currentIndex).toBe(11);
      vi.advanceTimersByTime(perWordMs + 5);
      expect(controller.currentState.currentIndex).toBe(12);
    });

    test('estimatedWpmFromRate clamps extreme tts rates to FLOOR/CEIL', () => {
      // 190 * rate, clamped to [60, 600].
      expect(RSVPController.estimatedWpmFromRate(1)).toBe(190);
      expect(RSVPController.estimatedWpmFromRate(0.1)).toBe(60); // 19 -> floor 60
      expect(RSVPController.estimatedWpmFromRate(10)).toBe(600); // 1900 -> ceil 600
      expect(RSVPController.estimatedWpmFromRate(2)).toBe(380);
    });

    test('drive seeds the rate via estimatedWpmFromRate so an extreme rate is clamped', () => {
      const { controller } = makeEstimatorFixture();
      controller.setExternallyDriven(true);

      // Very slow rate -> clamp to FLOOR (60 wpm -> 1000ms/word). At 190's
      // rate (316ms) it would have advanced; at 60 it must not yet.
      const wpm = RSVPController.estimatedWpmFromRate(0.1);
      controller.driveEstimatedFromCfi(cfiOfWord(5), wpm);
      expect(controller.currentState.currentIndex).toBe(5);

      vi.advanceTimersByTime(60000 / 190 + 50); // enough for 190, not for 60
      expect(controller.currentState.currentIndex).toBe(5);

      vi.advanceTimersByTime(60000 / 60); // now enough for 60 wpm
      expect(controller.currentState.currentIndex).toBe(6);
    });

    test('HOLDS at MAX_WORDS_AHEAD past the sentence first word (does not run away)', () => {
      const { controller } = makeEstimatorFixture();
      controller.setExternallyDriven(true);

      const startIndex = 2;
      controller.driveEstimatedFromCfi(cfiOfWord(startIndex), 600); // fast
      // Run far longer than needed to advance past the cap.
      vi.advanceTimersByTime(60_000);

      const cap = RSVPController.ESTIMATED_MAX_WORDS_AHEAD;
      // Held at startIndex + cap, never beyond.
      expect(controller.currentState.currentIndex).toBe(startIndex + cap);

      // Still held after even more time (timer stopped, not racing).
      vi.advanceTimersByTime(60_000);
      expect(controller.currentState.currentIndex).toBe(startIndex + cap);
    });

    test('a new sentence drive resets (snaps) to the new sentence first word', () => {
      const { controller } = makeEstimatorFixture();
      controller.setExternallyDriven(true);

      controller.driveEstimatedFromCfi(cfiOfWord(10), 190);
      const perWordMs = 60000 / 190;
      vi.advanceTimersByTime(perWordMs * 3 + 15); // drift forward a few words
      expect(controller.currentState.currentIndex).toBeGreaterThan(10);

      // Next sentence mark snaps to its first word, regardless of drift.
      controller.driveEstimatedFromCfi(cfiOfWord(20), 190);
      expect(controller.currentState.currentIndex).toBe(20);

      // And the cap is measured from the NEW anchor (20), not the old one.
      vi.advanceTimersByTime(60_000);
      expect(controller.currentState.currentIndex).toBe(
        20 + RSVPController.ESTIMATED_MAX_WORDS_AHEAD,
      );
    });

    test('estimator pacing does not co-run with normal auto-advance', () => {
      const { controller } = makeEstimatorFixture();
      controller.setExternallyDriven(true);
      controller.driveEstimatedFromCfi(cfiOfWord(0), 190);

      // Only the estimator timer should be advancing. Over one estimator tick
      // exactly one word advances (not two from a co-running WPM timer).
      const perWordMs = 60000 / 190;
      vi.advanceTimersByTime(perWordMs + 5);
      expect(controller.currentState.currentIndex).toBe(1);
    });

    test('stopping external drive cancels estimator pacing', () => {
      const { controller } = makeEstimatorFixture();
      controller.setExternallyDriven(true);
      controller.driveEstimatedFromCfi(cfiOfWord(10), 190);

      // Disengaging the external driver must clear the estimator timer so it
      // cannot keep advancing on its own.
      controller.stopEstimator();
      const before = controller.currentState.currentIndex;
      vi.advanceTimersByTime(60_000);
      expect(controller.currentState.currentIndex).toBe(before);
    });
  });

  describe('manual-nav decouple signal (slice 5, #3235)', () => {
    // The TTS-sync wiring listens for 'rsvp-manual-nav' to drop following so a
    // user jump isn't immediately overwritten by the next TTS position.
    const navMethods: Array<[string, (c: RSVPController) => void]> = [
      ['skipForward', (c) => c.skipForward()],
      ['skipBackward', (c) => c.skipBackward()],
      ['nextWord', (c) => c.nextWord()],
      ['prevWord', (c) => c.prevWord()],
      ['seekToPosition', (c) => c.seekToPosition(50)],
      ['seekToIndex', (c) => c.seekToIndex(1)],
    ];

    test.each(navMethods)('%s emits rsvp-manual-nav', (_name, run) => {
      const view = createMockView(0, [makeDoc('one two three four')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const onNav = vi.fn();
      controller.addEventListener('rsvp-manual-nav', onNav);
      run(controller);
      expect(onNav).toHaveBeenCalledTimes(1);
    });

    test('syncToCfi does NOT emit rsvp-manual-nav', () => {
      const view = createMockView(0, [makeDoc('one two three')]);
      const controller = new RSVPController(view, 'test-book-abc123');
      controller.start();

      const onNav = vi.fn();
      controller.addEventListener('rsvp-manual-nav', onNav);
      // resolveCFI on the stubbed view returns a real Range but syncToCfi will
      // no-op on the stubbed createRange; either way it must not fire manual-nav.
      controller.syncToCfi('epubcfi(/6/2!/4/2/1:0)');
      expect(onNav).not.toHaveBeenCalled();
    });
  });
});
