// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { BookDoc, TOCItem } from '@/libs/document';

// With Stable Page Numbers off, the TOC numbers each chapter with the screen
// page it starts on, the page the footer shows on arrival (#7453).

const viewSettings = vi.hoisted(() => ({
  progressStyle: 'fraction',
  stablePageNumbers: false as boolean,
  scrolled: false,
  isEink: false,
}));
vi.mock('@/store/readerStore', async () => {
  const { getBookProgress } = await import('@/store/readerProgressStore');
  const view = { renderer: { page: 1 }, getSectionFractions: () => [0, 0.25, 0.5, 1] };
  const state = {
    getView: () => view,
    getViewSettings: () => viewSettings,
    getProgress: (key: string) => getBookProgress(key),
  };
  return {
    useReaderStore: <R,>(selector?: (s: typeof state) => R) => (selector ? selector(state) : state),
  };
});
vi.mock('@/store/bookDataStore', () => {
  const state = { getBookData: () => ({ isFixedLayout: false }) };
  return {
    useBookDataStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ sideBarBookKey: 'book1', isSideBarVisible: true }),
}));
vi.mock('@/services/nav', () => ({ findParentPath: () => [] }));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getContentMd5: (s: string) => s,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/app/reader/hooks/useTextTranslation', () => ({ useTextTranslation: () => {} }));
// Render every row, so the numbers can be read.
vi.mock('react-virtuoso', async () => {
  const ReactMod = await import('react');
  return {
    Virtuoso: ReactMod.forwardRef(
      (
        props: { totalCount: number; itemContent: (index: number) => ReactNode },
        ref: React.Ref<unknown>,
      ) => {
        ReactMod.useImperativeHandle(ref, () => ({ scrollToIndex: () => {} }));
        return (
          <div>
            {Array.from({ length: props.totalCount }, (_, i) => (
              <div key={i}>{props.itemContent(i)}</div>
            ))}
          </div>
        );
      },
    ),
  };
});
vi.mock('overlayscrollbars-react', () => ({
  useOverlayScrollbars: () => [vi.fn(), () => undefined],
}));

// eslint-disable-next-line import/first
import TOCView from '@/app/reader/components/sidebar/TOCView';
// eslint-disable-next-line import/first
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';
// eslint-disable-next-line import/first
import { clearChapterScreens, recordChapterScreens } from '@/utils/chapterScreens';
// eslint-disable-next-line import/first
import type { BookProgress } from '@/types/book';

// Three chapters of 3000, 3000 and 6000 bytes, at byte-grid locations 0, 2
// and 4 of 8; chapter 2 has a TOC anchor halfway through it.
const loc = (current: number, next: number) => ({ current, next, total: 8 });
const fragment = { location: loc(3, 4) };
const sections = [
  { size: 3000, location: loc(0, 2) },
  { size: 3000, location: loc(2, 4), fragments: [fragment] },
  { size: 6000, location: loc(4, 8) },
];
const bookDoc = { sections, rendition: {} } as unknown as BookDoc;
const toc = [
  { id: 1, label: 'Chapter 1', href: 'ch1.html', location: sections[0]!.location },
  { id: 2, label: 'Chapter 2', href: 'ch2.html', location: sections[1]!.location },
  { id: 3, label: 'Section 2.1', href: 'ch2.html#s1', location: fragment.location },
  { id: 4, label: 'Chapter 3', href: 'ch3.html', location: sections[2]!.location },
] as TOCItem[];

const numbers = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="treeitem"]')).map((e) =>
    e.getAttribute('aria-label'),
  );

beforeEach(() => {
  viewSettings.stablePageNumbers = false;
  // Measured: 3 + 2 + 3 screens.
  recordChapterScreens('book1', 0, 3);
  recordChapterScreens('book1', 1, 2);
  recordChapterScreens('book1', 2, 3);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  // Second screen of chapter 3; the byte grid calls it page 6.
  act(() =>
    setBookProgress('book1', {
      sectionHref: 'ch3.html',
      location: 'epubcfi(/6/6)',
      section: { current: 2, total: 3 },
      pageinfo: { current: 5, total: 8 },
      fraction: 0.6,
      page: 6,
    } as unknown as BookProgress),
  );
});

afterEach(() => {
  cleanup();
  clearBookProgress('book1');
  clearChapterScreens('book1');
  vi.unstubAllGlobals();
});

describe('TOC page numbers with Stable Page Numbers off', () => {
  it('numbers chapters, anchors and the current position in screen pages', () => {
    const { container } = render(<TOCView bookKey='book1' bookDoc={bookDoc} toc={toc} />);
    expect(numbers(container)).toEqual([
      'Chapter 1, 1',
      'Chapter 2, 4',
      'Section 2.1, 5',
      'Chapter 3, 6',
      'Current position, 7',
    ]);
  });

  it('keeps byte-grid numbers with Stable Page Numbers on', () => {
    viewSettings.stablePageNumbers = true;
    const { container } = render(<TOCView bookKey='book1' bookDoc={bookDoc} toc={toc} />);
    expect(numbers(container)).toEqual([
      'Chapter 1, 1',
      'Chapter 2, 3',
      'Section 2.1, 4',
      'Chapter 3, 5',
      'Current position, 6',
    ]);
  });
});
