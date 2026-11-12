import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { RSVPController } from '@/services/rsvp/RSVPController';
import { FoliateView } from '@/types/view';
import { RsvpWord } from '@/services/rsvp/types';
import { getChunkEnd, getPrevChunkStart } from '@/services/rsvp/utils';

function makeDoc(text: string): Document {
  const textNode = { nodeType: Node.TEXT_NODE, textContent: text } as unknown as Text;
  const body = {
    nodeType: Node.ELEMENT_NODE,
    tagName: 'BODY',
    childNodes: [textNode],
  } as unknown as HTMLElement;
  const doc = {
    body,
    createRange: vi.fn().mockReturnValue({ setStart: vi.fn(), setEnd: vi.fn() }),
    defaultView: {
      getComputedStyle: vi.fn().mockReturnValue({ display: 'block', visibility: 'visible' }),
    },
  } as unknown as Document;
  (body as unknown as { ownerDocument: Document }).ownerDocument = doc;
  (textNode as unknown as { ownerDocument: Document }).ownerDocument = doc;
  return doc;
}

function makeController(text: string, bookKey = 'book'): RSVPController {
  const view = {
    renderer: {
      primaryIndex: 0,
      getContents: vi.fn().mockReturnValue([{ doc: makeDoc(text), index: 0 }]),
    },
    book: { toc: [] },
    language: { isCJK: false },
    tts: null,
    getCFI: vi.fn().mockReturnValue('epubcfi(/6/4!/4/2/1:0)'),
    resolveCFI: vi.fn().mockReturnValue({ anchor: vi.fn().mockReturnValue(new Range()) }),
  } as unknown as FoliateView;
  return new RSVPController(view, bookKey);
}

const words = (...texts: string[]): RsvpWord[] =>
  texts.map((text) => ({ text, orpIndex: 0, pauseMultiplier: 1 }));

const chunkTexts = (c: RSVPController) =>
  c.currentChunkIndices.map((i) => c.currentState.words[i]!.text);

describe('RSVP chunking utils', () => {
  test('getChunkEnd takes up to chunkSize words', () => {
    const w = words('One', 'Two', 'Three', 'Four');
    expect(getChunkEnd(w, 0, 1)).toBe(1);
    expect(getChunkEnd(w, 0, 3)).toBe(3);
    expect(getChunkEnd(w, 2, 3)).toBe(4);
  });

  test('getChunkEnd ends a chunk after a sentence end, closing quotes included', () => {
    expect(getChunkEnd(words('Stop.', 'Then', 'go.'), 0, 3)).toBe(1);
    expect(getChunkEnd(words('said', 'Peter."', 'Then'), 0, 3)).toBe(2);
    expect(getChunkEnd(words('Right?!', 'Then'), 0, 3)).toBe(1);
    expect(getChunkEnd(words('Hello,', 'there', 'friend'), 0, 3)).toBe(3);
  });

  test('getChunkEnd ends a chunk at the end of a heading or paragraph', () => {
    const w = words('Rabbit', 'Hole', 'Alice', 'was', 'tired');
    w[1]!.blockEnd = true;
    expect(getChunkEnd(w, 0, 3)).toBe(2);
    expect(getPrevChunkStart(w, 2, 3)).toBe(0);
  });

  test('getChunkEnd does not count the blank frame between repeated words', () => {
    // extractWords inserts ' ' between identical consecutive words.
    expect(getChunkEnd(words('the', ' ', 'the', 'end'), 0, 3)).toBe(4);
  });

  test('getPrevChunkStart steps back over the previous chunk, short or full', () => {
    const w = words('Stop.', 'Then', 'go.', 'Next', 'one', 'here', 'now');
    // Forward chunks from 0 with size 3: [0], [1,2], [3,4,5], [6]
    expect(getPrevChunkStart(w, 6, 3)).toBe(3);
    expect(getPrevChunkStart(w, 3, 3)).toBe(1);
    expect(getPrevChunkStart(w, 1, 3)).toBe(0);
    expect(getPrevChunkStart(w, 0, 3)).toBe(0);
  });
});

describe('RSVPController chunking', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('currentChunkIndices follows the chunk size', () => {
    const c = makeController('The quick brown fox jumps over the lazy dog');
    c.start();
    expect(chunkTexts(c)).toEqual(['The']);
    c.setChunkSize(3);
    expect(chunkTexts(c)).toEqual(['The', 'quick', 'brown']);
  });

  test('prevWord retraces exactly the chunks nextWord visited', () => {
    const c = makeController('Stop. Then go now. Next one here and more words. End.');
    c.setChunkSize(3);
    c.start();
    const starts = [c.currentState.currentIndex];
    // Chunks: [Stop.] [Then go now.] [Next one here] [and more words.] [End.]
    for (let i = 0; i < 4; i++) {
      c.nextWord();
      starts.push(c.currentState.currentIndex);
    }
    expect(new Set(starts).size).toBe(starts.length);
    for (let i = starts.length - 2; i >= 0; i--) {
      c.prevWord();
      expect(c.currentState.currentIndex).toBe(starts[i]);
    }
  });

  test('nextWord on the last chunk stays on it', () => {
    const c = makeController('one two three four five');
    c.setChunkSize(3);
    c.start();
    c.nextWord();
    expect(chunkTexts(c)).toEqual(['four', 'five']);
    c.nextWord();
    expect(chunkTexts(c)).toEqual(['four', 'five']);
  });

  test('a hyphenated word alone in a chunk is shown whole', () => {
    const c = makeController('End. state-of-the-art. More words here');
    c.setSplitHyphens(true);
    c.setChunkSize(3);
    c.start();
    c.nextWord();
    expect(chunkTexts(c)).toEqual(['state-of-the-art.']);
    expect(c.currentDisplayWord!.text).toBe('state-of-the-art.');
  });

  test('changing the chunk size keeps the WPM', () => {
    const c = makeController('a b c');
    c.setWpm(500);
    c.setChunkSize(5);
    expect(c.currentState.wpm).toBe(500);
    c.setChunkSize(1);
    expect(c.currentState.wpm).toBe(500);
  });

  test('chunk size is clamped to the options and persists across books', () => {
    const c = makeController('a b c', 'book1');
    c.setChunkSize(9);
    expect(c.currentState.chunkSize).toBe(5);
    c.setChunkSize(0);
    expect(c.currentState.chunkSize).toBe(1);
    c.setChunkSize(4);
    expect(makeController('a b c', 'book2').currentState.chunkSize).toBe(4);
  });

  test('a chunk is shown for the sum of its words and playback steps by chunk', () => {
    const c = makeController('aa bb cc dd ee ff');
    c.setStartDelay(0);
    c.setWpm(300); // 200 ms per word
    c.setChunkSize(2);
    c.start();
    vi.advanceTimersByTime(395);
    expect(c.currentState.currentIndex).toBe(0);
    vi.advanceTimersByTime(10);
    expect(c.currentState.currentIndex).toBe(2);
    expect(chunkTexts(c)).toEqual(['cc', 'dd']);
  });

  test('CJK sections and TTS-driven reading show one word at a time', () => {
    const cjk = makeController('这是一个测试。然后继续阅读。');
    cjk.setChunkSize(3);
    cjk.start();
    expect(cjk.currentState.hasCJK).toBe(true);
    expect(cjk.currentChunkIndices).toEqual([0]);

    const tts = makeController('The quick brown fox jumps');
    tts.setChunkSize(3);
    tts.start();
    tts.setExternallyDriven(true);
    expect(tts.currentChunkIndices).toEqual([0]);
  });
});

describe('RSVPController pacing options', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'],
    });
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const play = (text: string, setup: (c: RSVPController) => void = () => {}) => {
    const c = makeController(text);
    c.setStartDelay(0);
    c.setWpm(300); // 200 ms per word
    setup(c);
    c.start();
    return c;
  };
  const distinctWords = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');

  test('long-word delay is off by default, so pacing matches the plain word timing', () => {
    // "unbelievable" already gets the built-in 1.1x long-word multiplier: 220 ms.
    const c = play('unbelievable next words');
    vi.advanceTimersByTime(225);
    expect(c.currentState.currentIndex).toBe(1);
  });

  test('long-word delay adds 60 ms to long words and numbers', () => {
    const c = play('unbelievable 1984 next', (c) => c.setLongWordDelay(true));
    vi.advanceTimersByTime(275);
    expect(c.currentState.currentIndex).toBe(0);
    vi.advanceTimersByTime(10); // 280 ms
    expect(c.currentState.currentIndex).toBe(1);
    vi.advanceTimersByTime(250); // 1984: 200 + 60 = 260 ms
    expect(c.currentState.currentIndex).toBe(1);
    vi.advanceTimersByTime(10);
    expect(c.currentState.currentIndex).toBe(2);
  });

  test('warm-up starts at 70% speed, reaches full speed, and restarts after a pause', () => {
    const c = play(distinctWords, (c) => c.setWarmup(true));
    vi.advanceTimersByTime(280); // first word: 200 / 0.7 = 286 ms
    expect(c.currentState.currentIndex).toBe(0);
    vi.advanceTimersByTime(10);
    expect(c.currentState.currentIndex).toBe(1);

    vi.advanceTimersByTime(4500);
    const before = c.currentState.currentIndex;
    vi.advanceTimersByTime(2000);
    expect(c.currentState.currentIndex - before).toBe(10);

    c.pause();
    c.resume();
    const resumedAt = c.currentState.currentIndex;
    vi.advanceTimersByTime(280);
    expect(c.currentState.currentIndex).toBe(resumedAt);
    vi.advanceTimersByTime(10);
    expect(c.currentState.currentIndex).toBe(resumedAt + 1);
  });

  test('WPM goes up to 2000', () => {
    const c = makeController('a b c');
    c.setWpm(5000);
    expect(c.currentState.wpm).toBe(2000);
    expect(c.getWpmOptions().at(-1)).toBe(2000);
  });
});
