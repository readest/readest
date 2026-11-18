/**
 * Keyboard navigation in the table of contents (#7571).
 *
 * Every row and every expand button used to be its own Tab stop, so walking a
 * detailed TOC took two key presses per heading, and arrow keys on a focused
 * row turned the book's pages instead of moving in the list. The TOC now
 * follows the tree pattern: one Tab stop, arrows to move, Right/Left to open
 * and close a heading, Enter to go there.
 *
 * The rows are virtualized, so this runs the real Virtuoso list in Chromium
 * and presses real keys.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { userEvent } from 'vitest/browser';

import type { BookDoc, TOCItem } from '@/libs/document';
import type { BookProgress } from '@/types/book';

const goTo = vi.hoisted(() => vi.fn());

vi.mock('@/store/readerStore', async () => {
  const { getBookProgress } = await import('@/store/readerProgressStore');
  const state = {
    getView: () => ({ goTo }),
    getViewSettings: () => ({ isEink: false }),
    getProgress: (key: string) => getBookProgress(key),
  };
  return {
    useReaderStore: <R,>(selector?: (s: typeof state) => R) => (selector ? selector(state) : state),
  };
});
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ sideBarBookKey: 'book1', isSideBarVisible: true }),
}));
vi.mock('@/services/nav', async () => ({
  findParentPath: (await import('@/services/nav/lookup')).findParentPath,
}));
vi.mock('@/utils/event', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/event')>()),
  eventDispatcher: { dispatch: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/app/reader/hooks/useTextTranslation', () => ({ useTextTranslation: () => {} }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, o?: Record<string, unknown>) =>
    s.replace(/{{(\w+)}}/g, (_, k: string) => String(o?.[k] ?? '')),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));

const { default: TOCView } = await import('@/app/reader/components/sidebar/TOCView');
const { clearBookProgress, setBookProgress } = await import('@/store/readerProgressStore');
await import('@/styles/globals.css');

const bookDoc = { sections: [], rendition: {} } as unknown as BookDoc;

// 3 parts x 40 chapters x 2 sections: long enough for Virtuoso to unmount rows.
let nextId = 1;
const toc: TOCItem[] = [1, 2, 3].map((p) => ({
  id: nextId++,
  label: `Part ${p}`,
  href: `p${p}.html`,
  index: 0,
  subitems: Array.from({ length: 40 }, (_, i) => i + 1).map((c) => ({
    id: nextId++,
    label: `Chapter ${p}.${c}`,
    href: `p${p}c${c}.html`,
    index: 0,
    subitems: [1, 2].map((s) => ({
      id: nextId++,
      label: `Section ${p}.${c}.${s}`,
      href: `p${p}c${c}.html#s${s}`,
      index: 0,
    })),
  })),
}));

// Reading Chapter 2.3: Part 2 and Chapter 2.3 open, a "Current position" row under it.
const readAt = (sectionHref: string) =>
  setBookProgress('book1', {
    sectionHref,
    page: 3,
    location: 'epubcfi(/6/2!/4/1:0)',
  } as unknown as BookProgress);
const readChapter2_3 = () => readAt('p2c3.html');

const renderTOC = (dir: 'ltr' | 'rtl' = 'ltr', items = toc) =>
  render(
    <div dir={dir} className='scroll-container' style={{ height: 400, width: 300 }}>
      <TOCView bookKey='book1' bookDoc={bookDoc} toc={items} />
    </div>,
  );

const tree = () => document.querySelector<HTMLElement>('[role="tree"]')!;
const focusedRow = () => {
  const id = tree().getAttribute('aria-activedescendant');
  return id ? document.getElementById(id) : null;
};
// "Chapter 2.3, 1" -> "Chapter 2.3"
const focusedLabel = () => focusedRow()?.getAttribute('aria-label')?.split(',')[0];
const rowByLabel = (label: string) =>
  document.querySelector<HTMLElement>(`[role="treeitem"][aria-label^="${label},"]`);

const press = async (key: string, expected: string) => {
  await userEvent.keyboard(`{${key}}`);
  await expect.poll(focusedLabel).toBe(expected);
};

// Keys that reach the window would also drive the reader's shortcuts.
let leakedKeys: string[] = [];
const recordLeak = (e: KeyboardEvent) => leakedKeys.push(e.key);

beforeEach(() => {
  clearBookProgress('book1');
  leakedKeys = [];
  goTo.mockClear();
  window.addEventListener('keydown', recordLeak);
});

afterEach(() => {
  window.removeEventListener('keydown', recordLeak);
  cleanup();
});

describe('TOC keyboard navigation (#7571)', () => {
  it('is a single Tab stop, entered on the current chapter', async () => {
    readChapter2_3();
    const { container } = renderTOC();
    await expect.poll(() => rowByLabel('Chapter 2.3')).toBeTruthy();

    const tabbable = [
      ...container.querySelectorAll<HTMLElement>('a, button, input, [tabindex]'),
    ].filter((el) => el.tabIndex >= 0);
    expect(tabbable).toEqual([tree()]);

    await userEvent.tab();
    expect(document.activeElement).toBe(tree());
    expect(focusedLabel()).toBe('Chapter 2.3');
  });

  it('moves through the visible rows with Up, Down, Home and End, away from the reader', async () => {
    readChapter2_3();
    renderTOC();
    await expect.poll(() => rowByLabel('Chapter 2.3')).toBeTruthy();
    tree().focus();

    await press('ArrowDown', 'Current position');
    await press('ArrowDown', 'Section 2.3.1');
    await press('ArrowUp', 'Current position');
    await press('ArrowUp', 'Chapter 2.3');
    await press('Home', 'Part 1');
    await press('ArrowUp', 'Part 1');
    await press('End', 'Part 3');
    await press('ArrowDown', 'Part 3');

    expect(leakedKeys).toEqual([]);
  });

  it('steps out of the section being read with a single Left', async () => {
    readAt('p2c3.html#s1');
    renderTOC();
    await expect.poll(() => rowByLabel('Section 2.3.1')).toBeTruthy();
    tree().focus();
    expect(focusedLabel()).toBe('Section 2.3.1');

    await press('ArrowLeft', 'Chapter 2.3');
  });

  it('opens and closes headings with Right and Left, and walks to child and parent', async () => {
    renderTOC();
    await expect.poll(() => rowByLabel('Part 1')).toBeTruthy();
    tree().focus();
    expect(focusedLabel()).toBe('Part 1');

    await userEvent.keyboard('{ArrowRight}');
    await expect.poll(() => rowByLabel('Part 1')?.getAttribute('aria-expanded')).toBe('true');
    expect(focusedLabel()).toBe('Part 1');

    await press('ArrowRight', 'Chapter 1.1');
    await press('ArrowRight', 'Chapter 1.1'); // opens Chapter 1.1
    await press('ArrowRight', 'Section 1.1.1');
    await press('ArrowRight', 'Section 1.1.1'); // a leaf has nowhere to go
    await press('ArrowLeft', 'Chapter 1.1');
    await press('ArrowLeft', 'Chapter 1.1'); // closes Chapter 1.1
    expect(rowByLabel('Section 1.1.1')).toBeNull();
    await press('ArrowLeft', 'Part 1');
    await userEvent.keyboard('{ArrowLeft}');
    await expect.poll(() => rowByLabel('Part 1')?.getAttribute('aria-expanded')).toBe('false');
    expect(rowByLabel('Chapter 1.1')).toBeNull();

    expect(leakedKeys).toEqual([]);
  });

  it('swaps Left and Right in a right-to-left sidebar', async () => {
    renderTOC('rtl');
    await expect.poll(() => rowByLabel('Part 1')).toBeTruthy();
    tree().focus();

    await userEvent.keyboard('{ArrowLeft}');
    await expect.poll(() => rowByLabel('Part 1')?.getAttribute('aria-expanded')).toBe('true');
    await press('ArrowLeft', 'Chapter 1.1');
    await press('ArrowRight', 'Part 1');
  });

  it('goes to the focused heading with Enter', async () => {
    renderTOC();
    await expect.poll(() => rowByLabel('Part 2')).toBeTruthy();
    tree().focus();

    await press('ArrowDown', 'Part 2');
    await userEvent.keyboard('{Enter}');
    expect(goTo).toHaveBeenCalledWith('p2.html');
    expect(leakedKeys).toEqual([]);
  });

  it('goes back to the reading position with Enter on "Current position"', async () => {
    readChapter2_3();
    renderTOC();
    await expect.poll(() => rowByLabel('Chapter 2.3')).toBeTruthy();
    tree().focus();

    await press('ArrowDown', 'Current position');
    await userEvent.keyboard('{Enter}');
    expect(goTo).toHaveBeenCalledWith('epubcfi(/6/2!/4/1:0)');
  });

  it('brings the current chapter into view when Tab enters a list scrolled away from it', async () => {
    readChapter2_3();
    renderTOC();
    await expect.poll(() => rowByLabel('Chapter 2.3')).toBeTruthy();
    tree().scrollTop = tree().scrollHeight;
    await expect.poll(() => rowByLabel('Chapter 2.3')).toBeNull();

    await userEvent.tab();
    expect(document.activeElement).toBe(tree());
    await expect.poll(() => rowByLabel('Chapter 2.3')).toBeTruthy();
    const row = rowByLabel('Chapter 2.3')!.getBoundingClientRect();
    const list = tree().getBoundingClientRect();
    expect(row.top).toBeGreaterThanOrEqual(list.top);
    expect(row.bottom).toBeLessThanOrEqual(list.bottom);
    expect(focusedLabel()).toBe('Chapter 2.3');
  });

  it('leaves the arrow keys to the reader after a mouse click', async () => {
    readChapter2_3();
    renderTOC();
    await expect.poll(() => rowByLabel('Chapter 2.5')).toBeTruthy();

    await userEvent.click(rowByLabel('Chapter 2.5')!);
    expect(goTo).toHaveBeenCalledWith('p2c5.html');
    await userEvent.click(document.querySelector('button[aria-label="Expand Chapter 2.4"]')!);
    await expect.poll(() => rowByLabel('Chapter 2.4')?.getAttribute('aria-expanded')).toBe('true');
    expect(tree().contains(document.activeElement)).toBe(false);

    await userEvent.keyboard('{ArrowRight}');
    expect(leakedKeys).toEqual(['ArrowRight']);
  });

  it('is no Tab stop when there is no heading to step through', async () => {
    const { container } = renderTOC('ltr', []);
    await expect.poll(() => container.querySelector('[data-virtuoso-scroller]')).toBeTruthy();
    const tabbable = [
      ...container.querySelectorAll<HTMLElement>('a, button, input, [tabindex]'),
    ].filter((el) => el.tabIndex >= 0);
    expect(tabbable).toEqual([]);
    expect(container.querySelector('[role="tree"]')).toBeNull();
  });

  it('leaves Tab to the page thumbnails of a PDF without an outline', async () => {
    const pdf = {
      sections: Array.from({ length: 6 }, () => ({})),
      rendition: {},
      getPageThumbnail: async () => null,
    } as unknown as BookDoc;
    const { container } = render(
      <div className='scroll-container' style={{ height: 400, width: 300 }}>
        <TOCView bookKey='book1' bookDoc={pdf} toc={[]} />
      </div>,
    );
    await expect.poll(() => container.querySelector('button[aria-label="Page 1"]')).toBeTruthy();
    expect(container.querySelector('[role="tree"]')).toBeNull();

    await userEvent.tab();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Page 1');
  });
});
