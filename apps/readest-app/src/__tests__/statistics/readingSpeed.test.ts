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

describe('ReadingSpeedTracker', () => {
  it('does not count a word twice when the next viewport starts inside it', () => {
    const position = section('reading faster today');
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0, 10), 0, false, 'en');
    expect(tracker.onPosition(position(3, 18), 4000, false, 'en')).toMatchObject({ count: 1 });
    expect(tracker.onPosition(position(15), 8000, false, 'en')).toMatchObject({ count: 1 });
  });

  it('keeps the word boundary when the viewport starts at collapsible whitespace', () => {
    const position = section('reading faster today');
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0, 14), 0, false, 'en');
    expect(tracker.onPosition(position(7, 18), 4000, false, 'en')).toMatchObject({ count: 1 });
    expect(tracker.onPosition(position(15), 8000, false, 'en')).toMatchObject({ count: 1 });
  });

  it('keeps an accumulated character sample when scrolling past punctuation', () => {
    const position = section('你好，世界。');
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0), 0, true);
    tracker.onPosition(position(2), 1000, true);
    tracker.onPosition(position(3), 2000, true);
    expect(tracker.onPosition(position(4), 3500, true)).toEqual({
      unit: 'characters',
      count: 3,
      startTimeMs: 0,
      durationMs: 3500,
    });
  });

  it('counts only the departed part of overlapping scroll intervals', () => {
    const position = section('一二三四五六七八九十');
    const tracker = new ReadingSpeedTracker();
    expect(tracker.onPosition(position(0, 6), 0, true)).toBeNull();
    expect(tracker.onPosition(position(2, 8), 1000, true)).toBeNull();
    expect(tracker.onPosition(position(3, 9), 2000, true)).toBeNull();
    expect(tracker.onPosition(position(4, 10), 3500, true)).toEqual({
      unit: 'characters',
      count: 4,
      startTimeMs: 0,
      durationMs: 3500,
    });
  });

  it('does not count backward moves, distant jumps, or time after idling', () => {
    const position = section('one two three four five six');
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0, 3), 0, false);
    expect(tracker.onPosition(position(14, 18), 10_000, false)).toBeNull();
    expect(tracker.onPosition(position(4, 7), 20_000, false)).toBeNull();
    expect(tracker.onPosition(position(8, 13), 150_000, false)).toBeNull();
  });

  it('omits quick page flips and starts timing again after a reset', () => {
    const position = section('one two three four five');
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0, 3), 0, false);
    expect(tracker.onPosition(position(4, 7), 500, false)).toBeNull();
    tracker.reset();
    expect(tracker.onPosition(position(4, 7), 15_000, false)).toBeNull();
    expect(tracker.onPosition(position(8, 13), 19_000, false)).toMatchObject({
      count: 1,
      startTimeMs: 15_000,
      durationMs: 4000,
    });
  });

  it('keeps a page past the idle timeout only when read at a plausible pace', () => {
    const turn = (text: string, end: number, ms: number, language = 'en') => {
      const position = section(text);
      const tracker = new ReadingSpeedTracker();
      tracker.onPosition(position(0, end), 0, false, language);
      return tracker.onPosition(position(end), ms, false, language);
    };
    // a two-page desktop spread at 250 words/min
    expect(turn(`${'word '.repeat(750)}next`, 3750, 180_000)).toMatchObject({ count: 750 });
    // 100 words or 300 characters in 3 minutes: time away, not reading
    expect(turn(`${'word '.repeat(100)}next`, 500, 180_000)).toBeNull();
    expect(turn(`${'字'.repeat(300)}。下`, 300, 180_000, 'zh')).toBeNull();
    expect(turn(`${'字'.repeat(450)}。下`, 450, 180_000, 'zh')).toMatchObject({ count: 450 });
    // no page is timed past the hard limit
    expect(turn(`${'word '.repeat(5000)}next`, 25_000, 16 * 60_000)).toBeNull();
  });

  it('keeps the idle limit while scrolling, where one step says nothing about pace', () => {
    const position = section(`${'word '.repeat(750)}next`);
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0, 3750), 0, true, 'en');
    expect(tracker.onPosition(position(3750), 130_000, true, 'en')).toBeNull();
  });

  it('does not count a new range caused by switching the reading layout', () => {
    const position = section('one two three four five');
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0, 3), 0, false);
    expect(tracker.onPosition(position(4, 18), 5000, true, 'en')).toBeNull();
  });

  it('counts an ordinary turn past text hidden between two pages', () => {
    const doc = new Window().document as unknown as Document;
    doc.body.innerHTML =
      '<p>First page.</p><aside style="display: none">Hidden note</aside><p>Next page.</p>';
    const paragraphs = doc.querySelectorAll('p');
    const position = (index: number) => {
      const range = doc.createRange();
      range.selectNodeContents(paragraphs[index]!);
      return { index: 0, range };
    };
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(position(0), 0, false, 'en');
    expect(tracker.onPosition(position(1), 5000, false, 'en')).toMatchObject({ count: 2 });
  });

  it('counts an adjacent chapter turn only after finishing the previous chapter', () => {
    const first = section('first chapter', 0);
    const next = section('second chapter', 1);
    const tracker = new ReadingSpeedTracker();
    tracker.onPosition(first(0, 5), 0, false);
    expect(tracker.onPosition(next(0), 10_000, false)).toBeNull();
    tracker.reset();
    tracker.onPosition(first(0), 11_000, false);
    expect(tracker.onPosition(next(0), 21_000, false)).toMatchObject({ count: 2 });
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
