import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { RSVPController } from '@/services/rsvp/RSVPController';
import { FoliateView } from '@/types/view';
import { getChunkForIndex, isTerminalPunctuation, isLongWordOrNumber } from '@/services/rsvp/utils';

function makeDoc(text: string): Document {
  const textNode = { nodeType: Node.TEXT_NODE, textContent: text } as unknown as Text;
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

describe('RSVP Multi-Word Chunking & Pacing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getChunkForIndex utility', () => {
    test('extracts single word when chunkSize is 1', () => {
      const words = [
        { text: 'One', orpIndex: 0, pauseMultiplier: 1 },
        { text: 'Two', orpIndex: 0, pauseMultiplier: 1 },
      ];
      const res = getChunkForIndex(words, 0, 1);
      expect(res.words.length).toBe(1);
      expect(res.words[0]!.text).toBe('One');
      expect(res.indices).toEqual([0]);
    });

    test('extracts multiple words up to chunkSize', () => {
      const words = [
        { text: 'One', orpIndex: 0, pauseMultiplier: 1 },
        { text: 'Two', orpIndex: 0, pauseMultiplier: 1 },
        { text: 'Three', orpIndex: 1, pauseMultiplier: 1 },
        { text: 'Four', orpIndex: 1, pauseMultiplier: 1 },
      ];
      const res = getChunkForIndex(words, 0, 3);
      expect(res.words.length).toBe(3);
      expect(res.words.map((w) => w.text)).toEqual(['One', 'Two', 'Three']);
      expect(res.indices).toEqual([0, 1, 2]);
    });

    test('breaks early on terminal punctuation so sentences do not cross chunks', () => {
      const words = [
        { text: 'Stop.', orpIndex: 1, pauseMultiplier: 1 },
        { text: 'Then', orpIndex: 1, pauseMultiplier: 1 },
        { text: 'go.', orpIndex: 0, pauseMultiplier: 1 },
      ];
      const res = getChunkForIndex(words, 0, 3);
      expect(res.words.length).toBe(1);
      expect(res.words[0]!.text).toBe('Stop.');
      expect(res.endsWithBoundary).toBe(true);

      // Next chunk begins cleanly with "Then"
      const nextChunk = getChunkForIndex(words, 1, 3);
      expect(nextChunk.words.map((w) => w.text)).toEqual(['Then', 'go.']);
    });

    test('recognizes dialogue quotes with terminal punctuation', () => {
      expect(isTerminalPunctuation('said Peter."')).toBe(true);
      expect(isTerminalPunctuation('Right?!')).toBe(true);
      expect(isTerminalPunctuation('Hello,')).toBe(false);
    });

    test('recognizes long words and numbers', () => {
      expect(isLongWordOrNumber('unbelievable')).toBe(true); // 12 chars
      expect(isLongWordOrNumber('1984')).toBe(true); // 4 digits
      expect(isLongWordOrNumber('short')).toBe(false); // 5 chars
    });
  });

  describe('RSVPController chunk navigation', () => {
    test('currentChunk reflects configured chunkSize', () => {
      const doc = makeDoc('The quick brown fox jumps over the lazy dog');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-chunk-1');

      controller.setChunkSize(3);
      controller.start();

      expect(controller.currentState.chunkSize).toBe(3);
      expect(controller.currentChunk.length).toBe(3);
      expect(controller.currentChunk.map((w) => w.text)).toEqual(['The', 'quick', 'brown']);
      expect(controller.currentChunkIndices).toEqual([0, 1, 2]);
    });

    test('nextWord() and prevWord() step by chunk size when chunkSize > 1', () => {
      const doc = makeDoc('The quick brown fox jumps over');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'test-chunk-2');

      controller.setChunkSize(3);
      controller.start();

      expect(controller.currentState.currentIndex).toBe(0);

      // Step forward by chunk
      controller.nextWord();
      expect(controller.currentState.currentIndex).toBe(3);
      expect(controller.currentChunk.map((w) => w.text)).toEqual(['fox', 'jumps', 'over']);

      // Step backward by chunk
      controller.prevWord();
      expect(controller.currentState.currentIndex).toBe(0);
      expect(controller.currentChunk.map((w) => w.text)).toEqual(['The', 'quick', 'brown']);
    });

    test('persists chunk size and settings globally in localStorage', () => {
      const doc = makeDoc('Testing settings persistence');
      const view = createMockView(0, [doc]);
      const controller1 = new RSVPController(view, 'book-1');

      controller1.setChunkSize(4);
      controller1.setEnableWarmup(true);
      controller1.setAdaptiveLongWordDelay(true);

      expect(controller1.currentState.chunkSize).toBe(4);
      expect(controller1.currentState.enableWarmup).toBe(true);

      // New controller instance for a different book loads the global preferences
      const controller2 = new RSVPController(view, 'book-2');
      expect(controller2.currentState.chunkSize).toBe(4);
      expect(controller2.currentState.enableWarmup).toBe(true);
      expect(controller2.currentState.adaptiveLongWordDelay).toBe(true);
    });

    test('scales WPM proportionally when chunkSize changes', () => {
      const doc = makeDoc('Testing wpm scaling with chunk size');
      const view = createMockView(0, [doc]);
      const controller = new RSVPController(view, 'book-wpm-scale');

      controller.setWpm(300);
      controller.setChunkSize(1);
      expect(controller.currentState.wpm).toBe(300);

      // Increase to 2 words per flash -> WPM doubles to 600
      controller.setChunkSize(2);
      expect(controller.currentState.wpm).toBe(600);

      // Increase to 3 words per flash -> WPM scales by 3/2 to 900
      controller.setChunkSize(3);
      expect(controller.currentState.wpm).toBe(900);

      // Decrease back to 1 word per flash -> WPM scales back to 300
      controller.setChunkSize(1);
      expect(controller.currentState.wpm).toBe(300);
    });
  });
});
