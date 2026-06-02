import { render, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { BookNote } from '@/types/book';

// ---------- Shared mutable test state (captured by the mock factories) ----------
let scrollToIndexSpy: Mock<(arg: unknown) => void>;
// Only the FIRST (mount-time) `initialized` callback is captured, mirroring how
// OverlayScrollbars binds its event handlers when it initializes the viewport.
// A fix that relied on a fresher render closure would pass against the latest
// callback but still break in the real app — so the test forces a ref-based fix.
let capturedInitialized:
  | ((instance: { elements: () => { viewport: HTMLElement } }) => void)
  | undefined;
// Latest props Virtuoso was rendered with, so tests can assert the mount-time
// position (initialTopMostItemIndex) the panel hands it.
let capturedVirtuosoProps: Record<string, unknown> | undefined;
let mockProgress: { location: string } | null;
let mockBooknotes: BookNote[];

// ---------- Mocks ----------
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getConfig: () => ({ booknotes: mockBooknotes }) }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getProgress: () => mockProgress }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    setActiveBooknoteType: vi.fn(),
    setBooknoteResults: vi.fn(),
  }),
}));

// Derive a per-chapter TOC group from the spine step of each note's CFI so the
// flattened list is [header, note, header, note, ...] sorted by chapter.
vi.mock('@/services/nav', () => ({
  findTocItemBS: (_toc: unknown, cfi: string) => {
    const match = cfi.match(/\/6\/(\d+)!/);
    const n = match ? Number(match[1]) : 0;
    return { id: n, href: `ch${n}.html`, label: `Chapter ${n}`, index: n };
  },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@/app/reader/components/sidebar/BooknoteItem', () => ({
  default: () => null,
}));

vi.mock('@/app/reader/components/EmptyState', () => ({
  default: () => null,
}));

// Virtuoso is replaced with a stub that exposes a spy-able `scrollToIndex`
// through the imperative handle and hands BooknoteView a scroller element.
vi.mock('react-virtuoso', async () => {
  const ReactMod = await import('react');
  return {
    Virtuoso: ReactMod.forwardRef(
      (
        props: { scrollerRef?: (el: HTMLElement | Window | null) => void },
        ref: React.Ref<unknown>,
      ) => {
        capturedVirtuosoProps = props as Record<string, unknown>;
        ReactMod.useImperativeHandle(ref, () => ({
          scrollToIndex: (arg: unknown) => scrollToIndexSpy(arg),
        }));
        ReactMod.useEffect(() => {
          props.scrollerRef?.(document.createElement('div'));
        }, []);
        return null;
      },
    ),
  };
});

// Capture the OverlayScrollbars `initialized` callback so the test can fire it
// on demand (the real hook fires it after a deferred, timing-dependent init).
vi.mock('overlayscrollbars-react', () => ({
  useOverlayScrollbars: (opts: {
    events?: { initialized?: (i: { elements: () => { viewport: HTMLElement } }) => void };
  }) => {
    if (!capturedInitialized) capturedInitialized = opts.events?.initialized;
    return [vi.fn(), () => undefined];
  },
}));

// eslint-disable-next-line import/first
import BooknoteView from '@/app/reader/components/sidebar/BooknoteView';

const makeNote = (cfi: string): BookNote =>
  ({
    id: cfi,
    type: 'annotation',
    cfi,
    text: cfi,
    note: '',
    createdAt: 0,
    updatedAt: 0,
  }) as BookNote;

const fireOverlayScrollbarsInitialized = () => {
  act(() => {
    capturedInitialized?.({ elements: () => ({ viewport: document.createElement('div') }) });
  });
};

beforeEach(() => {
  scrollToIndexSpy = vi.fn<(arg: unknown) => void>();
  capturedInitialized = undefined;
  capturedVirtuosoProps = undefined;
  mockProgress = null;
  mockBooknotes = [
    makeNote('epubcfi(/6/4!/4/2:0)'),
    makeNote('epubcfi(/6/6!/4/4:0)'),
    makeNote('epubcfi(/6/8!/4/2:0)'),
    makeNote('epubcfi(/6/10!/4/6:0)'),
    makeNote('epubcfi(/6/26!/4/2:0)'),
  ];
  // Run rAF synchronously so the callback's scroll happens inside act().
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BooknoteView — OverlayScrollbars init does not rewind the list to the top', () => {
  it('re-applies the auto-scroll to the nearest note when OverlayScrollbars initializes after the reading position arrives', () => {
    // Fresh open: BooknoteView mounts before the first relocate, so `progress`
    // (and thus the nearest cfi) has no reading position yet.
    mockProgress = null;
    const { rerender } = render(<BooknoteView type='annotation' bookKey='book1' toc={[]} />);

    // The relocate arrives → the normal auto-scroll effect centers the nearest
    // note. The list is [h4, n4, h6, n6, h8, n8, h10, n10, h26, n26]; the
    // reading position is in the last chapter, so the nearest note is index 9.
    mockProgress = { location: 'epubcfi(/6/26!/4/10:0)' };
    act(() => {
      rerender(<BooknoteView type='annotation' bookKey='book1' toc={[]} />);
    });

    // Ignore that first scroll; we only care whether the OverlayScrollbars init
    // (which clobbers scrollTop) re-applies it instead of stranding the top.
    scrollToIndexSpy.mockClear();

    fireOverlayScrollbarsInitialized();

    expect(scrollToIndexSpy).toHaveBeenCalledWith(expect.objectContaining({ index: 9 }));
  });

  it('does not force a scroll on OverlayScrollbars init when there is no reading position', () => {
    mockProgress = null;
    render(<BooknoteView type='annotation' bookKey='book1' toc={[]} />);

    scrollToIndexSpy.mockClear();
    fireOverlayScrollbarsInitialized();

    expect(scrollToIndexSpy).not.toHaveBeenCalled();
  });

  it('positions Virtuoso natively on mount (without a racing scrollToIndex) when the reading position is already known', () => {
    // Switching to the panel while reading: the reading position is available at
    // mount. A scrollToIndex against the freshly mounted, unmeasured list no-ops
    // or wedges it into rendering nothing — so the panel must mount Virtuoso
    // already centered via initialTopMostItemIndex and the scroll effect must
    // skip its first jump.
    mockProgress = { location: 'epubcfi(/6/26!/4/10:0)' };
    act(() => {
      render(<BooknoteView type='annotation' bookKey='book1' toc={[]} />);
    });

    expect(capturedVirtuosoProps?.['initialTopMostItemIndex']).toEqual({
      index: 9,
      align: 'center',
    });
    expect(scrollToIndexSpy).not.toHaveBeenCalled();

    // The deferred OverlayScrollbars init resets scrollTop; the re-apply then
    // restores the centered position (now that the rows have been measured).
    fireOverlayScrollbarsInitialized();
    expect(scrollToIndexSpy).toHaveBeenCalledWith(expect.objectContaining({ index: 9 }));
  });

  it('jumps instantly (behavior auto) for a far scroll instead of animating it, like TOCView', () => {
    // 12 notes in distinct chapters → flat list [h, n, h, n, ...] of 24 rows;
    // the nearest note (last chapter) sits at index 23, far from the top.
    mockBooknotes = Array.from({ length: 12 }, (_, i) =>
      makeNote(`epubcfi(/6/${4 + i * 2}!/4/2:0)`),
    );

    // Reload-style: no reading position at mount, so initialTopMostItemIndex
    // does not handle it and the scroll effect performs the jump.
    mockProgress = null;
    const { rerender } = render(<BooknoteView type='annotation' bookKey='book1' toc={[]} />);

    mockProgress = { location: 'epubcfi(/6/26!/4/10:0)' };
    act(() => {
      rerender(<BooknoteView type='annotation' bookKey='book1' toc={[]} />);
    });

    // distance (23 - 0) > 16 → instant jump, not a smooth animation.
    expect(scrollToIndexSpy).toHaveBeenCalledWith(
      expect.objectContaining({ index: 23, behavior: 'auto' }),
    );
    expect(scrollToIndexSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });
});
