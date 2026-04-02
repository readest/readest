import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useParagraphMode } from '@/app/reader/hooks/useParagraphMode';
import type { FoliateView } from '@/types/view';

const currentViewSettings = {
  paragraphMode: { enabled: true },
};

const mockGetViewSettings = vi.fn(() => currentViewSettings);
const mockSetViewSettings = vi.fn();
const mockGetProgress = vi.fn(() => null);

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
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

const createDoc = (body: string): Document =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');

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

describe('useParagraphMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookApi = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('initializes from the renderer primary section when multiple sections are loaded', async () => {
    const previousChapterDoc = createDoc('<p>Old chapter ending</p>');
    const nextChapterDoc = createDoc('<h1>Chapter 2</h1><p>First paragraph</p>');
    const { view, renderer } = createMockView([previousChapterDoc, nextChapterDoc], 1);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Chapter 2');
    });

    expect(renderer.goTo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        index: 1,
      }),
    );
  });

  it('moves to the next chapter instead of falling back to the previous paragraph', async () => {
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
      expect(renderer.goTo).toHaveBeenLastCalledWith(
        expect.objectContaining({
          index: 1,
        }),
      );
    });
  });
});
