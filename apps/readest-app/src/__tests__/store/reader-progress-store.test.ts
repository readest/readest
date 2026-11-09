import { describe, expect, test, vi } from 'vitest';
import type { BookProgress } from '@/types/book';
import { setBookProgress, useReaderProgressStore } from '@/store/readerProgressStore';

// foliate repeats each page turn's relocate once its scroll settles: the same location, page and
// range, in new objects.
const relocate = (range: Range, current = 4): BookProgress => ({
  location: 'epubcfi(/6/4!/4/2,/1:0,/1:20)',
  sectionHref: 'ch1.xhtml',
  sectionLabel: 'Chapter 1',
  section: { current: 0, total: 3 },
  pageinfo: { current, next: current + 1, total: 100 },
  pageItem: null,
  timeinfo: { section: 3, total: 120 },
  fraction: 0.05,
  index: 0,
  range,
  page: current + 1,
});

describe('setBookProgress', () => {
  test('a repeated relocate leaves the store unchanged', () => {
    const p = document.createElement('p');
    p.textContent = 'Some text on the page';
    document.body.append(p);
    const range = () => {
      const r = document.createRange();
      r.setStart(p.firstChild!, 0);
      r.setEnd(p.firstChild!, 20);
      return r;
    };
    const listener = vi.fn();
    const unsubscribe = useReaderProgressStore.subscribe(listener);
    setBookProgress('book-1', relocate(range()));
    setBookProgress('book-1', relocate(range()));
    expect(listener).toHaveBeenCalledTimes(1);

    // the same location in a re-rendered document is a new position for its readers
    const q = p.cloneNode(true) as HTMLElement;
    document.body.append(q);
    const moved = document.createRange();
    moved.setStart(q.firstChild!, 0);
    moved.setEnd(q.firstChild!, 20);
    setBookProgress('book-1', relocate(moved));
    expect(listener).toHaveBeenCalledTimes(2);

    setBookProgress('book-1', relocate(moved, 5));
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});
