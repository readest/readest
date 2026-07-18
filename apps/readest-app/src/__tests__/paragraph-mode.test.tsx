import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor as waitForWithOptions,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ParagraphOverlay from '@/app/reader/components/paragraph/ParagraphOverlay';
import { useParagraphMode } from '@/app/reader/hooks/useParagraphMode';
import type { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';
import {
  getParagraphActionForKey,
  getParagraphActionForZone,
  getParagraphPresentation,
} from '@/utils/paragraphPresentation';

const currentViewSettings = {
  paragraphMode: { enabled: true },
  writingMode: 'horizontal-tb',
  vertical: false,
  rtl: false,
};

const mockGetViewSettings = vi.fn(() => currentViewSettings);
const mockSetViewSettings = vi.fn();
const mockGetProgress = vi.fn(() => null);
const realSetTimeout = globalThis.setTimeout;
const waitFor = <T,>(callback: () => T | Promise<T>) =>
  waitForWithOptions(callback, { interval: 1 });

beforeEach(() => {
  // Preserve Testing Library's 1s failure timeout while collapsing app animation/debounce waits.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, timeout) =>
    realSetTimeout(handler, typeof timeout === 'number' && timeout < 500 ? 0 : timeout),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

let mockIsFixedLayout = false;

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ isFixedLayout: mockIsFixedLayout }),
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasSafeAreaInset: false } }),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn(),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getViewSettings: mockGetViewSettings,
    setViewSettings: mockSetViewSettings,
    getProgress: mockGetProgress,
  }),
}));

global.ResizeObserver = class ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this);
  }

  disconnect() {}

  unobserve() {}
} as typeof ResizeObserver;

const createDoc = (body: string): Document =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');

const attachDefaultView = (
  doc: Document,
  getComputedStyle: (element: Element) => CSSStyleDeclaration,
) => {
  Object.defineProperty(doc, 'defaultView', {
    value: { getComputedStyle },
    configurable: true,
  });
};

function createMockView(docs: Document[], initialPrimaryIndex: number) {
  const contents = docs.map((doc, index) => ({ doc, index }));

  const renderer = {
    primaryIndex: initialPrimaryIndex,
    getContents: vi.fn(() => contents),
    nextSection: vi.fn(async () => {
      renderer.primaryIndex = Math.min(renderer.primaryIndex + 1, contents.length - 1);
    }),
    prevSection: vi.fn(async () => {
      renderer.primaryIndex = Math.max(renderer.primaryIndex - 1, 0);
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    goTo: vi.fn(),
    scrollToAnchor: vi.fn(),
  };

  const view = {
    renderer,
    resolveCFI: vi.fn(),
    getCFI: vi.fn(() => 'epubcfi(/6/4!/4/2/1:0)'),
  } as unknown as FoliateView;

  return { view, renderer };
}

let hookApi: ReturnType<typeof useParagraphMode> | null = null;

const HookHarness = ({ view }: { view: React.RefObject<FoliateView | null> }) => {
  hookApi = useParagraphMode({ bookKey: 'book-1', viewRef: view });
  return null;
};

describe('paragraph mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookApi = null;
    mockIsFixedLayout = false;
    currentViewSettings.writingMode = 'horizontal-tb';
    currentViewSettings.vertical = false;
    currentViewSettings.rtl = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('preserves source presentation and navigation rules', () => {
    const verticalDoc = createDoc('<p lang="ja">縦書きの段落です。</p>');
    const verticalParagraph = verticalDoc.querySelector('p')!;
    const verticalRange = verticalDoc.createRange();
    verticalRange.selectNodeContents(verticalParagraph);

    attachDefaultView(verticalDoc, (element: Element) => {
      if (element === verticalParagraph || element === verticalDoc.body) {
        return {
          writingMode: 'vertical-rl',
          direction: 'ltr',
          textOrientation: 'upright',
          unicodeBidi: 'plaintext',
          textAlign: 'start',
        } as CSSStyleDeclaration;
      }

      return {
        writingMode: 'horizontal-tb',
        direction: 'ltr',
      } as CSSStyleDeclaration;
    });

    const arabicDoc = createDoc('<p dir="rtl">هذا نص عربي</p>');
    const arabicParagraph = arabicDoc.querySelector('p')!;
    const arabicRange = arabicDoc.createRange();
    arabicRange.selectNodeContents(arabicParagraph);
    attachDefaultView(
      arabicDoc,
      () =>
        ({
          writingMode: 'horizontal-tb',
          direction: 'rtl',
          textAlign: 'start',
        }) as CSSStyleDeclaration,
    );

    expect(getParagraphPresentation(verticalDoc, verticalRange)).toEqual(
      expect.objectContaining({
        lang: 'ja',
        dir: 'ltr',
        writingMode: 'vertical-rl',
        vertical: true,
      }),
    );
    expect(getParagraphPresentation(arabicDoc, arabicRange)).toEqual(
      expect.objectContaining({
        dir: 'rtl',
        rtl: true,
      }),
    );

    expect(getParagraphActionForZone('left', { rtl: true, vertical: false })).toBe('next');
    expect(getParagraphActionForZone('top', { vertical: true, writingMode: 'vertical-rl' })).toBe(
      'prev',
    );
    expect(getParagraphActionForKey('ArrowLeft', { rtl: true, vertical: false })).toBe('next');
    expect(
      getParagraphActionForKey('ArrowLeft', { vertical: true, writingMode: 'vertical-rl' }),
    ).toBe('next');
  });

  it('uses the active primary section when moving across chapter boundaries', async () => {
    const previousChapterDoc = createDoc('<p>Old chapter ending</p>');
    const nextChapterDoc = createDoc('<h1>Chapter 2</h1><p>First paragraph</p>');
    const { view, renderer } = createMockView([previousChapterDoc, nextChapterDoc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Old chapter ending');
    });

    await act(async () => {
      await hookApi?.goToNextParagraph();
    });

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Chapter 2');
    });

    expect(renderer.nextSection).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(renderer.goTo).toHaveBeenLastCalledWith(expect.objectContaining({ index: 1 }));
    });
  });

  it('resumes without scrolling the underlying view so repeated enter/exit cannot rewind (#4717)', async () => {
    const doc = createDoc('<p>Para A</p><p>Para B</p><p>Para C</p>');
    const { view, renderer } = createMockView([doc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange).toBeTruthy();
    });

    // Resuming/entering focuses the paragraph already at the reading position.
    // Scrolling the underlying view to that paragraph's start rewinds whenever it
    // began on an earlier page, so the view must NOT be moved on resume (#4717).
    expect(renderer.goTo).not.toHaveBeenCalled();
    expect(renderer.scrollToAnchor).not.toHaveBeenCalled();
  });

  it('resumes at the view live CFI even when the store progress is stale (#4717)', async () => {
    const doc = createDoc('<p>Block zero</p><p>Block one</p><p>Block two</p>');
    const { view } = createMockView([doc], 0);
    // The rAF-debounced store (mockGetProgress) returns null/stale; the view's
    // live lastLocation CFI points at the third paragraph. Resume must follow the
    // live CFI (resolved against the current doc), not fall back to chapter start.
    const thirdParagraph = doc.querySelectorAll('p')[2]!;
    (view as unknown as { lastLocation: { cfi: string } }).lastLocation = { cfi: 'cfi-live' };
    (view.resolveCFI as ReturnType<typeof vi.fn>).mockImplementation((cfi: string) =>
      cfi === 'cfi-live'
        ? {
            index: 0,
            anchor: () => {
              const r = doc.createRange();
              r.selectNodeContents(thirdParagraph);
              return r;
            },
          }
        : null,
    );
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Block two');
    });
  });

  it('does not scroll the underlying view when exiting paragraph mode (#4717)', async () => {
    const doc = createDoc('<p>Para A</p><p>Para B</p>');
    const { view, renderer } = createMockView([doc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange).toBeTruthy();
    });

    await act(async () => {
      await hookApi?.toggleParagraphMode();
    });

    expect(renderer.scrollToAnchor).not.toHaveBeenCalled();
  });

  it('still scrolls the underlying view when navigating paragraphs', async () => {
    const doc = createDoc('<p>Para A</p><p>Para B</p><p>Para C</p>');
    const { view, renderer } = createMockView([doc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange).toBeTruthy();
    });

    await act(async () => {
      await hookApi?.goToNextParagraph();
    });

    // Navigation to another paragraph must move the underlying view (the goTo
    // runs after a rAF inside focusCurrentParagraph, so wait for it).
    await waitFor(() => {
      expect(renderer.goTo).toHaveBeenCalled();
    });
  });

  it('renders preserved presentation and layout-aware click zones in the overlay', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const overlayBookKey = 'overlay-book';
    const doc = createDoc('<p>مرحبا بالعالم</p>');
    const paragraph = doc.querySelector('p')!;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);

    const { container } = render(
      <ParagraphOverlay
        bookKey={overlayBookKey}
        dimOpacity={0.3}
        viewSettings={{ writingMode: 'horizontal-tb', vertical: false, rtl: true } as never}
      />,
    );

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: overlayBookKey,
        range,
        presentation: {
          lang: 'ja',
          dir: 'ltr',
          writingMode: 'vertical-rl',
          textOrientation: 'upright',
          vertical: true,
          rtl: true,
        },
      });
    });

    const paragraphContent = await waitFor(() => {
      const node = container.querySelector('.paragraph-content') as HTMLDivElement | null;
      expect(node).not.toBeNull();
      return node!;
    });
    expect(paragraphContent.getAttribute('lang')).toBe('ja');
    expect(paragraphContent.style.writingMode).toBe('vertical-rl');
    dispatchSpy.mockClear();

    const contentArea = container.querySelector('.relative.flex') as HTMLDivElement;
    vi.spyOn(contentArea, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    let clickTime = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clickTime);

    fireEvent.click(contentArea, { clientX: 150, clientY: 20 });
    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith('paragraph-prev', { bookKey: overlayBookKey });
    });

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: overlayBookKey,
        range,
        presentation: {
          dir: 'rtl',
          writingMode: 'horizontal-tb',
          vertical: false,
          rtl: true,
        },
      });
    });
    dispatchSpy.mockClear();

    clickTime += 320;

    fireEvent.click(contentArea, { clientX: 40, clientY: 150 });
    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith('paragraph-next', { bookKey: overlayBookKey });
    });
  });

  const renderVisibleOverlay = async (onClose: () => void) => {
    const overlayBookKey = 'overlay-book';
    const doc = createDoc('<p>Hello world</p>');
    const paragraph = doc.querySelector('p')!;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);

    const { container } = render(
      <ParagraphOverlay
        bookKey={overlayBookKey}
        dimOpacity={0.3}
        viewSettings={{ writingMode: 'horizontal-tb', vertical: false, rtl: false } as never}
        onClose={onClose}
      />,
    );

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: overlayBookKey,
        range,
        presentation: { dir: 'ltr', writingMode: 'horizontal-tb', vertical: false, rtl: false },
      });
    });

    return { container, overlayBookKey };
  };

  const mockContentRect = (contentArea: HTMLElement) =>
    vi.spyOn(contentArea, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

  it('reveals the controls instead of exiting when the backdrop is tapped', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const onClose = vi.fn();
    const { container, overlayBookKey } = await renderVisibleOverlay(onClose);

    const dialog = await waitFor(() => {
      const node = container.querySelector('[role="dialog"]') as HTMLDivElement | null;
      expect(node).not.toBeNull();
      return node!;
    });
    dispatchSpy.mockClear();

    fireEvent.click(dialog);

    expect(onClose).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('paragraph-show-controls', {
      bookKey: overlayBookKey,
    });
  });

  it('reveals the controls instead of exiting when the center zone is tapped', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const onClose = vi.fn();
    const { container, overlayBookKey } = await renderVisibleOverlay(onClose);

    const contentArea = container.querySelector('.relative.flex') as HTMLDivElement;
    mockContentRect(contentArea);
    dispatchSpy.mockClear();

    fireEvent.click(contentArea, { clientX: 150, clientY: 150 });

    expect(onClose).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('paragraph-show-controls', {
      bookKey: overlayBookKey,
    });
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-next', { bookKey: overlayBookKey });
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-prev', { bookKey: overlayBookKey });
  });

  it('still exits on a double-tap of the paragraph', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);

    const contentArea = container.querySelector('.relative.flex') as HTMLDivElement;
    mockContentRect(contentArea);

    fireEvent.click(contentArea, { clientX: 150, clientY: 150 });
    fireEvent.click(contentArea, { clientX: 150, clientY: 150 });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  const getDialog = (container: HTMLElement) =>
    container.querySelector('[role="dialog"]') as HTMLDivElement;

  it('focuses the dialog when it opens so it receives keys directly (#4717)', async () => {
    const { container } = await renderVisibleOverlay(vi.fn());
    const dialog = getDialog(container);
    expect(document.activeElement).toBe(dialog);
  });

  it('exits when the toggle paragraph mode shortcut (Shift+P) is pressed (#4717)', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);

    fireEvent.keyDown(getDialog(container), { key: 'P', shiftKey: true });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exits when Escape is pressed on the dialog (#4717)', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);

    fireEvent.keyDown(getDialog(container), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops the toggle key from propagating so it cannot fire twice (#4717)', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);

    fireEvent.keyDown(getDialog(container), { key: 'P', shiftKey: true });

    // The dialog handler must stop propagation so the global useShortcuts
    // handler never receives the same keypress (which would re-toggle).
    expect(windowSpy).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowSpy);
  });

  it('does not exit on an unrelated key while visible', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);

    fireEvent.keyDown(getDialog(container), { key: 'x' });

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('paragraph mode TTS sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookApi = null;
    mockIsFixedLayout = false;
    currentViewSettings.writingMode = 'horizontal-tb';
    currentViewSettings.vertical = false;
    currentViewSettings.rtl = false;
  });

  afterEach(() => {
    cleanup();
  });

  // Multi-paragraph doc: ParagraphIterator turns each <p> into one block, so
  // block N corresponds to the Nth <p>.
  const createMultiParagraphDoc = () =>
    createDoc('<p>Block zero</p><p>Block one</p><p>Block two</p>');

  // Mock view.resolveCFI so a given cfi resolves into the Nth <p> of the doc at
  // `sectionIndex`. The hook anchors the current section's doc, so `anchor(doc)`
  // returns a Range selecting the target paragraph's contents.
  const stubResolveCFI = (
    view: FoliateView,
    mapping: Record<string, { sectionIndex: number; paragraphIndex: number }>,
  ) => {
    (view.resolveCFI as ReturnType<typeof vi.fn>).mockImplementation((cfi: string) => {
      const target = mapping[cfi];
      if (!target) return null;
      return {
        index: target.sectionIndex,
        anchor: (doc: Document) => {
          const paragraph = doc.querySelectorAll('p')[target.paragraphIndex];
          if (!paragraph) return null;
          const range = doc.createRange();
          range.selectNodeContents(paragraph);
          return range;
        },
      };
    });
  };

  const dispatchPlaying = async (bookKey: string) => {
    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', { bookKey, state: 'playing' });
    });
  };

  const dispatchPosition = async (detail: {
    bookKey: string;
    cfi: string;
    kind: 'word' | 'sentence';
    sectionIndex: number;
    sequence: number;
  }) => {
    await act(async () => {
      await eventDispatcher.dispatch('tts-position', detail);
    });
  };

  it('follows TTS to the spoken paragraph in the same section', async () => {
    const doc = createMultiParagraphDoc();
    const { view } = createMockView([doc], 0);
    stubResolveCFI(view, { 'cfi-block-2': { sectionIndex: 0, paragraphIndex: 2 } });
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Block zero');
    });
    expect(hookApi?.paragraphState.currentIndex).toBe(0);

    await dispatchPlaying('book-1');
    await dispatchPosition({
      bookKey: 'book-1',
      cfi: 'cfi-block-2',
      kind: 'sentence',
      sectionIndex: 0,
      sequence: 1,
    });

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentIndex).toBe(2);
    });
    expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Block two');
  });

  it('ignores tts-position events with a stale (<=) sequence', async () => {
    const doc = createMultiParagraphDoc();
    const { view } = createMockView([doc], 0);
    stubResolveCFI(view, {
      'cfi-block-2': { sectionIndex: 0, paragraphIndex: 2 },
      'cfi-block-1': { sectionIndex: 0, paragraphIndex: 1 },
    });
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentIndex).toBe(0);
    });

    await dispatchPlaying('book-1');
    await dispatchPosition({
      bookKey: 'book-1',
      cfi: 'cfi-block-2',
      kind: 'sentence',
      sectionIndex: 0,
      sequence: 5,
    });
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentIndex).toBe(2);
    });

    // A later-arriving but older-sequence event must be dropped.
    await dispatchPosition({
      bookKey: 'book-1',
      cfi: 'cfi-block-1',
      kind: 'sentence',
      sectionIndex: 0,
      sequence: 3,
    });

    expect(hookApi?.paragraphState.currentIndex).toBe(2);

    // An equal sequence is also stale.
    await dispatchPosition({
      bookKey: 'book-1',
      cfi: 'cfi-block-1',
      kind: 'sentence',
      sectionIndex: 0,
      sequence: 5,
    });
    expect(hookApi?.paragraphState.currentIndex).toBe(2);
  });

  it('decouples on manual nav and re-engages on the next playing state', async () => {
    const doc = createMultiParagraphDoc();
    const { view } = createMockView([doc], 0);
    stubResolveCFI(view, {
      'cfi-block-2': { sectionIndex: 0, paragraphIndex: 2 },
      'cfi-block-0': { sectionIndex: 0, paragraphIndex: 0 },
    });
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentIndex).toBe(0);
    });

    await dispatchPlaying('book-1');

    // Manual nav decouples: paragraph stops following TTS.
    await act(async () => {
      await hookApi?.goToNextParagraph();
    });
    expect(hookApi?.paragraphState.currentIndex).toBe(1);

    // While decoupled, tts-position is ignored (no focus change).
    await dispatchPosition({
      bookKey: 'book-1',
      cfi: 'cfi-block-2',
      kind: 'sentence',
      sectionIndex: 0,
      sequence: 10,
    });
    expect(hookApi?.paragraphState.currentIndex).toBe(1);

    // Re-engage via a fresh 'playing' state, then follow again.
    await dispatchPlaying('book-1');
    await dispatchPosition({
      bookKey: 'book-1',
      cfi: 'cfi-block-2',
      kind: 'sentence',
      sectionIndex: 0,
      sequence: 11,
    });
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentIndex).toBe(2);
    });
  });

  it('stashes a cross-section tts-position and applies it after the iterator re-inits', async () => {
    const sectionZeroDoc = createDoc('<p>S0 first</p><p>S0 second</p>');
    const sectionOneDoc = createDoc('<p>S1 first</p><p>S1 second</p><p>S1 third</p>');
    const { view, renderer } = createMockView([sectionZeroDoc, sectionOneDoc], 0);
    stubResolveCFI(view, { 'cfi-s1-block-2': { sectionIndex: 1, paragraphIndex: 2 } });
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('S0 first');
    });

    // Capture the relocate handler the hook registered with the renderer.
    const relocateCall = (renderer.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
      ([eventName]) => eventName === 'relocate',
    );
    const handleRelocate = relocateCall?.[1] as () => void;
    expect(handleRelocate).toBeTypeOf('function');

    await dispatchPlaying('book-1');

    // A tts-position for section 1 while we are on section 0: must NOT map yet.
    await dispatchPosition({
      bookKey: 'book-1',
      cfi: 'cfi-s1-block-2',
      kind: 'sentence',
      sectionIndex: 1,
      sequence: 20,
    });
    // Still on section 0, focus unchanged (no cross-section mapping).
    expect(hookApi?.paragraphState.currentRange?.toString()).toContain('S0 first');

    // Let the initial mount-focus isFocusingRef window (200ms) expire so the
    // relocate below isn't eaten by an unrelated guard.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    // TTS drives the view into section 1; the existing relocate handler re-inits
    // the iterator for the new section, after which the stashed CFI applies.
    renderer.primaryIndex = 1;
    await act(async () => {
      handleRelocate();
      await new Promise((r) => setTimeout(r, 250));
    });

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentIndex).toBe(2);
    });
    expect(hookApi?.paragraphState.currentRange?.toString()).toContain('S1 third');
  });

  it('does not arm the isFocusingRef guard on a TTS-driven sync focus', async () => {
    const sectionZeroDoc = createDoc('<p>S0 first</p><p>S0 second</p><p>S0 third</p>');
    const sectionOneDoc = createDoc('<p>S1 first</p><p>S1 second</p>');
    const { view, renderer } = createMockView([sectionZeroDoc, sectionOneDoc], 0);
    stubResolveCFI(view, {
      'cfi-s0-block-2': { sectionIndex: 0, paragraphIndex: 2 },
      'cfi-s1-block-1': { sectionIndex: 1, paragraphIndex: 1 },
    });
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentIndex).toBe(0);
    });

    const relocateCall = (renderer.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
      ([eventName]) => eventName === 'relocate',
    );
    const handleRelocate = relocateCall?.[1] as () => void;

    // Drain the initial mount-focus isFocusingRef window (200ms) so only the
    // sync focus under test can possibly arm the guard.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    await dispatchPlaying('book-1');

    // A TTS-driven sync focus within the same section must NOT arm the focusing
    // guard; otherwise the next relocate (a TTS-driven section change) would be
    // swallowed and the iterator would never re-init for the new section.
    await dispatchPosition({
      bookKey: 'book-1',
      cfi: 'cfi-s0-block-2',
      kind: 'sentence',
      sectionIndex: 0,
      sequence: 30,
    });
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentIndex).toBe(2);
    });
    // Let the sync focus fully settle (its scroll runs after a rAF) so that IF
    // it (wrongly) armed isFocusingRef, the guard would be set and persist by
    // the time the relocate below fires.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // A cross-section tts-position stashes; the following relocate for section 1
    // must still re-init. If the sync focus above had armed isFocusingRef, this
    // relocate would be eaten and the iterator would never re-init -> still
    // section 0.
    await dispatchPosition({
      bookKey: 'book-1',
      cfi: 'cfi-s1-block-1',
      kind: 'sentence',
      sectionIndex: 1,
      sequence: 31,
    });
    renderer.primaryIndex = 1;
    await act(async () => {
      handleRelocate();
      await new Promise((r) => setTimeout(r, 250));
    });

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('S1 second');
    });
    expect(hookApi?.paragraphState.currentIndex).toBe(1);
  });

  it('does not follow TTS and reports unsupported for a fixed-layout book', async () => {
    mockIsFixedLayout = true;
    const doc = createMultiParagraphDoc();
    const { view } = createMockView([doc], 0);
    stubResolveCFI(view, { 'cfi-block-2': { sectionIndex: 0, paragraphIndex: 2 } });
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentIndex).toBe(0);
    });
    expect(hookApi?.ttsSyncStatus).toBe('unsupported');

    await dispatchPlaying('book-1');
    await dispatchPosition({
      bookKey: 'book-1',
      cfi: 'cfi-block-2',
      kind: 'sentence',
      sectionIndex: 0,
      sequence: 1,
    });

    // Fixed-layout never follows: focus stays on the first paragraph.
    expect(hookApi?.paragraphState.currentIndex).toBe(0);
    expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Block zero');
    expect(hookApi?.ttsSyncStatus).toBe('unsupported');
  });

  it('derives ttsSyncStatus through the follow lifecycle (reflowable)', async () => {
    const doc = createMultiParagraphDoc();
    const { view } = createMockView([doc, createMultiParagraphDoc()], 0);
    stubResolveCFI(view, {
      'cfi-block-2': { sectionIndex: 0, paragraphIndex: 2 },
      'cfi-s1-block-1': { sectionIndex: 1, paragraphIndex: 1 },
    });
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentIndex).toBe(0);
    });

    // Initial: idle (TTS not engaged).
    expect(hookApi?.ttsSyncStatus).toBe('idle');

    // Playing -> following.
    await dispatchPlaying('book-1');
    await waitFor(() => {
      expect(hookApi?.ttsSyncStatus).toBe('following');
    });

    // Manual nav -> decoupled (TTS still playing).
    await act(async () => {
      await hookApi?.goToNextParagraph();
    });
    await waitFor(() => {
      expect(hookApi?.ttsSyncStatus).toBe('decoupled');
    });

    // Re-engage, then a cross-section position (before re-init) -> syncing.
    await dispatchPlaying('book-1');
    await waitFor(() => {
      expect(hookApi?.ttsSyncStatus).toBe('following');
    });
    await dispatchPosition({
      bookKey: 'book-1',
      cfi: 'cfi-s1-block-1',
      kind: 'sentence',
      sectionIndex: 1,
      sequence: 40,
    });
    await waitFor(() => {
      expect(hookApi?.ttsSyncStatus).toBe('syncing');
    });

    // Stopped -> idle.
    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', {
        bookKey: 'book-1',
        state: 'stopped',
      });
    });
    await waitFor(() => {
      expect(hookApi?.ttsSyncStatus).toBe('idle');
    });
  });

  it('toggleTtsAudio starts TTS aligned to the focused paragraph when idle', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const doc = createMultiParagraphDoc();
    const { view } = createMockView([doc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Block zero');
    });
    expect(hookApi?.ttsActive).toBe(false);

    dispatchSpy.mockClear();
    act(() => {
      hookApi?.toggleTtsAudio();
    });

    const speakCall = dispatchSpy.mock.calls.find(([name]) => name === 'tts-speak');
    expect(speakCall).toBeDefined();
    const detail = speakCall![1] as { bookKey: string; index?: number; range?: Range };
    expect(detail.bookKey).toBe('book-1');
    // Start-aligned to the focused paragraph: section index + live range.
    expect(detail.index).toBe(0);
    expect(detail.range?.toString()).toContain('Block zero');
  });

  it('toggleTtsAudio stops TTS when a session is active', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const doc = createMultiParagraphDoc();
    const { view } = createMockView([doc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentIndex).toBe(0);
    });

    // A playing session makes the toggle a stop.
    await dispatchPlaying('book-1');
    await waitFor(() => {
      expect(hookApi?.ttsActive).toBe(true);
    });

    dispatchSpy.mockClear();
    act(() => {
      hookApi?.toggleTtsAudio();
    });

    expect(dispatchSpy).toHaveBeenCalledWith('tts-stop', { bookKey: 'book-1' });
    expect(dispatchSpy).not.toHaveBeenCalledWith('tts-speak', expect.anything());
  });

  it('keeps ttsActive and reports paused on a TTS pause; clears on stop', async () => {
    const doc = createMultiParagraphDoc();
    const { view } = createMockView([doc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentIndex).toBe(0);
    });

    await dispatchPlaying('book-1');
    await waitFor(() => {
      expect(hookApi?.ttsActive).toBe(true);
      expect(hookApi?.ttsSyncStatus).toBe('following');
    });

    // Pause keeps the session active and persists the indicator as 'paused'.
    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', { bookKey: 'book-1', state: 'paused' });
    });
    await waitFor(() => {
      expect(hookApi?.ttsActive).toBe(true);
      expect(hookApi?.ttsSyncStatus).toBe('paused');
    });

    // A full stop clears the session and returns to idle.
    await act(async () => {
      await eventDispatcher.dispatch('tts-playback-state', { bookKey: 'book-1', state: 'stopped' });
    });
    await waitFor(() => {
      expect(hookApi?.ttsActive).toBe(false);
      expect(hookApi?.ttsSyncStatus).toBe('idle');
    });
  });

  it('ignores tts events for a different bookKey and keeps status unchanged', async () => {
    const doc = createMultiParagraphDoc();
    const { view } = createMockView([doc], 0);
    stubResolveCFI(view, { 'cfi-block-2': { sectionIndex: 0, paragraphIndex: 2 } });
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentIndex).toBe(0);
    });
    expect(hookApi?.ttsSyncStatus).toBe('idle');

    // Playback + position for a DIFFERENT book: must be ignored.
    await dispatchPlaying('other-book');
    await dispatchPosition({
      bookKey: 'other-book',
      cfi: 'cfi-block-2',
      kind: 'sentence',
      sectionIndex: 0,
      sequence: 1,
    });

    expect(hookApi?.paragraphState.currentIndex).toBe(0);
    expect(hookApi?.ttsSyncStatus).toBe('idle');
  });
});
