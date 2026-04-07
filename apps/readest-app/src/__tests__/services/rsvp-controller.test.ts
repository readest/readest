import { describe, test, expect, vi } from 'vitest';
import { RSVPController } from '@/services/rsvp/RSVPController';
import { FoliateView } from '@/types/view';

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
