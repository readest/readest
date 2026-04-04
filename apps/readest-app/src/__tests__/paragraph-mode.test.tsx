import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    fireEvent.click(contentArea, { clientX: 40, clientY: 150 });
    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith('paragraph-next', { bookKey: overlayBookKey });
    });
  });
});
