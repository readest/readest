// @vitest-environment happy-dom
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { countReadingUnits, ReadingSpeedTracker } from '@/services/statistics/readingSpeed';
import { getDailyReadingSpeeds } from '@/services/statistics/readingStats';

describe('countReadingUnits', () => {
  it.each([
    ['你好，世界！', 'zh-Hans', 'characters', 4],
    ['天地。', 'zho', 'characters', 2],
    ['廣東話閱讀測試', 'yue-Hant-HK', 'characters', 7],
    ['にほんご、テスト。', 'ja', 'characters', 7],
    ['𠮷野家。', '', 'characters', 3],
    ['An English sentence mentioning 字.', '', 'words', 5],
    ["Don't count punctuation, please!", 'en', 'words', 4],
    ['안녕 세상!', 'ko', 'words', 2],
    ['ภาษาไทย', 'th', 'words', 2],
  ])('counts %s using the %s locale', (text, language, unit, count) => {
    expect(countReadingUnits(text, language)).toEqual({ unit, count });
  });
});

const section = (text: string, index = 0) => {
  const doc = new Window().document as unknown as Document;
  const node = doc.createTextNode(text);
  doc.body.append(node);
  return (start: number, end = node.length) => {
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return { index, range };
  };
};

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
// How long a page of `n` words takes at 250 words/min.
const readingMs = (n: number) => n * 240;

describe('ReadingSpeedTracker', () => {
  const boundaryText = `${words(19)} reading ${words(20)} end`;
  const readingAt = boundaryText.indexOf('reading');
  const endAt = boundaryText.lastIndexOf('end');

  it('does not count a word twice when the next page starts inside it', () => {
    const position = section(boundaryText);
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0, readingAt + 3), 0, false, 'en');
    expect(
      tracker.onPosition(position(readingAt + 3, endAt), readingMs(20), false, 'en'),
    ).toMatchObject({ count: 20 });
    expect(tracker.onPosition(position(endAt), readingMs(40), false, 'en')).toMatchObject({
      count: 20,
    });
  });

  it('keeps the word boundary when the next page starts at collapsible whitespace', () => {
    const position = section(boundaryText);
    const space = readingAt + 'reading'.length;
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0, space), 0, false, 'en');
    expect(tracker.onPosition(position(space, endAt), readingMs(20), false, 'en')).toMatchObject({
      count: 20,
    });
    expect(tracker.onPosition(position(endAt), readingMs(40), false, 'en')).toMatchObject({
      count: 20,
    });
  });

  it('drops a page turned faster or slower than people read', () => {
    const turn = (text: string, end: number, ms: number, language = 'en') => {
      const position = section(text);
      const tracker = new ReadingSpeedTracker();
      tracker.onPosition(position(0, end), 0, false, language);
      return tracker.onPosition(position(end), ms, false, language);
    };
    // a two-page desktop spread at 250 words/min, past the idle timeout
    expect(turn(`${words(750)} next`, 3750, 180_000)).toMatchObject({ count: 750 });
    // skimmed: 750 words in 10 seconds, or 1,000 characters in 15
    expect(turn(`${words(750)} next`, 3750, 10_000)).toBeNull();
    expect(turn(`${'字'.repeat(1000)}。下`, 1000, 15_000, 'zh')).toBeNull();
    // a pause: 20 words in a minute, or 300 characters in 3 minutes
    expect(turn(`${words(20)} next`, 100, 60_000)).toBeNull();
    expect(turn(`${'字'.repeat(300)}。下`, 300, 180_000, 'zh')).toBeNull();
    expect(turn(`${'字'.repeat(450)}。下`, 450, 180_000, 'zh')).toMatchObject({ count: 450 });
    // no page is timed past the hard limit
    expect(turn(`${words(5000)} next`, 25_000, 16 * 60_000)).toBeNull();
  });

  it('times a scrolled screen from when it shows until all of it has scrolled past', () => {
    const position = section('一二三四五六七八九，'.repeat(8));
    const tracker = new ReadingSpeedTracker();
    // The screen holds 40 characters. Each scroll step passes a few of them,
    // one only a comma: no single step is a sample.
    expect(tracker.onPosition(position(0, 40), 0, true)).toBeNull();
    expect(tracker.onPosition(position(9, 49), 3000, true)).toBeNull();
    expect(tracker.onPosition(position(10, 50), 4000, true)).toBeNull();
    expect(tracker.onPosition(position(25, 65), 8000, true)).toBeNull();
    expect(tracker.onPosition(position(40, 80), 12_000, true)).toEqual({
      unit: 'characters',
      count: 36,
      startTimeMs: 0,
      durationMs: 12_000,
    });
  });

  it('drops a scrolled screen flung past or left on screen too long', () => {
    // A 100-word screen (characters 0-500) scrolled in steps of 50 words.
    const scroll = (stepMs: number) => {
      const position = section(`${words(200)} end`);
      const tracker = new ReadingSpeedTracker();
      return [0, 250, 500].map((start, step) =>
        tracker.onPosition(position(start, start + 500), step * stepMs, true, 'en'),
      );
    };
    // 100 words in 2 seconds, and in 200 seconds
    expect(scroll(1000)).toEqual([null, null, null]);
    expect(scroll(100_000)).toEqual([null, null, null]);
    expect(scroll(12_000)).toEqual([null, null, expect.objectContaining({ count: 100 })]);
  });

  it('does not count backward moves, distant jumps, or a page left open', () => {
    const position = section('one two three four five six');
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0, 3), 0, false);
    expect(tracker.onPosition(position(14, 18), 10_000, false)).toBeNull();
    expect(tracker.onPosition(position(4, 7), 20_000, false)).toBeNull();
    expect(tracker.onPosition(position(8, 13), 150_000, false)).toBeNull();
  });

  it('omits quick page flips and starts timing again after a reset', () => {
    const position = section(`${words(40)} end`);
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0, 100), 0, false, 'en');
    expect(tracker.onPosition(position(100, 200), 500, false, 'en')).toBeNull();
    tracker.reset();
    expect(tracker.onPosition(position(100, 200), 15_000, false, 'en')).toBeNull();
    expect(tracker.onPosition(position(200), 15_000 + readingMs(20), false, 'en')).toMatchObject({
      count: 20,
      startTimeMs: 15_000,
      durationMs: readingMs(20),
    });
  });

  it('does not count a new range caused by switching the reading layout', () => {
    const position = section('one two three four five');
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0, 3), 0, false);
    expect(tracker.onPosition(position(4, 18), 5000, true, 'en')).toBeNull();
  });

  it('counts an ordinary turn past text hidden between two pages', () => {
    const doc = new Window().document as unknown as Document;
    doc.body.innerHTML = `<p>${words(20)}</p><aside style="display: none">Hidden note</aside><p>${words(20)}</p>`;
    const paragraphs = doc.querySelectorAll('p');
    const position = (index: number) => {
      const range = doc.createRange();
      range.selectNodeContents(paragraphs[index]!);
      return { index: 0, range };
    };
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0), 0, false, 'en');
    expect(tracker.onPosition(position(1), readingMs(20), false, 'en')).toMatchObject({
      count: 20,
    });
  });

  it('counts an adjacent chapter turn only after finishing the previous chapter', () => {
    const first = section(words(20), 0);
    const next = section(words(20), 1);
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(first(0, 50), 0, false, 'en');
    expect(tracker.onPosition(next(0), readingMs(20), false, 'en')).toBeNull();
    tracker.reset();
    tracker.onPosition(first(0), 30_000, false, 'en');
    expect(tracker.onPosition(next(0), 30_000 + readingMs(20), false, 'en')).toMatchObject({
      count: 20,
    });
  });
});

describe('getDailyReadingSpeeds', () => {
  it('weighs by elapsed time, separates units, and splits reading at local midnight', () => {
    const midnight = new Date(2026, 10, 8).getTime();
    const daily = getDailyReadingSpeeds(
      [
        { unit: 'words', count: 90, durationMs: 60_000, startTimeMs: midnight - 30_000 },
        { unit: 'words', count: 30, durationMs: 15_000, startTimeMs: midnight + 30_000 },
        { unit: 'characters', count: 200, durationMs: 60_000, startTimeMs: midnight },
      ],
      midnight - 60_000,
      midnight + 60_000,
    );
    expect(daily.get('2026-11-07')).toEqual([{ unit: 'words', count: 45, durationMs: 30_000 }]);
    expect(daily.get('2026-11-08')).toEqual([
      { unit: 'words', count: 75, durationMs: 45_000 },
      { unit: 'characters', count: 200, durationMs: 60_000 },
    ]);
  });
});
