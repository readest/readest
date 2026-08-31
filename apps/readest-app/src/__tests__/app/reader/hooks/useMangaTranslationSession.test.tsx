import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: {
    processDocument: vi.fn(async () => null),
    processPage: vi.fn(async () => null),
    setEnabled: vi.fn(async () => undefined),
    terminate: vi.fn(async () => undefined),
  },
  sessionOptions: [] as Array<{
    createEngine: (onProgress: (progress: { status: string; progress: number }) => void) => unknown;
    onProgress?: (progress: {
      status: string;
      progress: number;
      completed: number;
      total: number;
    }) => void;
    onError?: (error: unknown, pageIndex: number) => void;
    onPageTranslated?: (page: unknown) => void;
  }>,
  engine: {
    translate: vi.fn(),
    terminate: vi.fn(async () => undefined),
  },
  engineOptions: [] as unknown[],
}));

vi.mock('@/app/reader/services/manga/mangaTranslationSession', () => ({
  MangaTranslationSession: vi.fn(function (options) {
    mocks.sessionOptions.push(options);
    return mocks.session;
  }),
}));

vi.mock('@/app/reader/services/manga/mangaTranslationEngine', () => ({
  MangaTranslationEngine: vi.fn(function (options) {
    mocks.engineOptions.push(options);
    return mocks.engine;
  }),
}));

import { useMangaTranslationSession } from '@/app/reader/hooks/useMangaTranslationSession';

describe('useMangaTranslationSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionOptions.length = 0;
    mocks.engineOptions.length = 0;
  });

  it('hands documents to one session and follows its enabled state', async () => {
    const onProgress = vi.fn();
    const onError = vi.fn();
    const onPageTranslated = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) =>
        useMangaTranslationSession({ enabled, onProgress, onError, onPageTranslated }),
      { initialProps: { enabled: false } },
    );
    const doc = document.implementation.createHTMLDocument();

    expect(mocks.session.setEnabled).toHaveBeenCalledWith(false);
    await act(async () => await result.current(doc, 2));
    expect(mocks.session.processDocument).toHaveBeenCalledWith(doc, 2);

    rerender({ enabled: true });
    expect(mocks.session.setEnabled).toHaveBeenLastCalledWith(true);

    const reportEngineProgress = vi.fn();
    expect(mocks.sessionOptions[0]!.createEngine(reportEngineProgress)).toBe(mocks.engine);
    expect(mocks.engineOptions[0]).toEqual({ onProgress: reportEngineProgress });
    const progress = {
      status: 'translating speech bubbles',
      progress: 0.5,
      completed: 1,
      total: 2,
    };
    mocks.sessionOptions[0]!.onProgress?.(progress);
    expect(onProgress).toHaveBeenCalledWith(progress);

    const error = new Error('failed');
    mocks.sessionOptions[0]!.onError?.(error, 2);
    expect(onError).toHaveBeenCalledWith(error, 2);
    const page = { pageIndex: 2 };
    mocks.sessionOptions[0]!.onPageTranslated?.(page);
    expect(onPageTranslated).toHaveBeenCalledWith(page);

    unmount();
    expect(mocks.session.terminate).toHaveBeenCalledOnce();
  });

  it('discovers pages that were rendered before translation was enabled', async () => {
    const doc = document.implementation.createHTMLDocument();
    const { rerender } = renderHook(
      ({ enabled }) =>
        useMangaTranslationSession({
          enabled,
          getDocuments: () => [{ doc, index: 6 }],
        }),
      { initialProps: { enabled: false } },
    );
    mocks.session.processDocument.mockClear();

    rerender({ enabled: true });

    await waitFor(() => {
      expect(mocks.session.processDocument).toHaveBeenCalledWith(doc, 6);
    });
  });

  it('processes available pages in ascending page order', async () => {
    const first = document.implementation.createHTMLDocument();
    const current = document.implementation.createHTMLDocument();
    let rendered: readonly { doc: Document; index: number }[] = [];
    const getDocuments = vi.fn(() => rendered);
    const { result, rerender } = renderHook(
      ({ enabled }) => useMangaTranslationSession({ enabled, getDocuments }),
      { initialProps: { enabled: false } },
    );
    await act(async () => {
      await result.current(first, 5);
      await result.current(current, 7);
    });
    rendered = [
      { doc: current, index: 7 },
      { doc: first, index: 5 },
    ];
    mocks.session.processDocument.mockClear();

    rerender({ enabled: true });

    expect(mocks.session.processDocument.mock.calls).toEqual([
      [first, 5],
      [current, 7],
    ]);
  });

  it('registers unloaded pages with the session loader', async () => {
    const loadFirst = vi.fn(async () => ({
      image: { source: 'blob:first', width: 100, height: 200 },
    }));
    const loadSecond = vi.fn(async () => ({
      image: { source: 'blob:second', width: 100, height: 200 },
    }));
    const { rerender } = renderHook(
      ({ enabled }) =>
        useMangaTranslationSession({
          enabled,
          getDocuments: () => [
            { index: 2, load: loadSecond },
            { index: 1, load: loadFirst },
          ],
        }),
      { initialProps: { enabled: false } },
    );
    mocks.session.processPage.mockClear();

    rerender({ enabled: true });

    await waitFor(() => expect(mocks.session.processPage).toHaveBeenCalledTimes(2));
    expect(mocks.session.processPage.mock.calls).toEqual([
      [1, loadFirst],
      [2, loadSecond],
    ]);
  });

  it('uses a stable loader for a page that is currently rendered', async () => {
    const doc = document.implementation.createHTMLDocument();
    const load = vi.fn(async () => ({
      image: { source: 'blob:stable-page', width: 100, height: 200 },
    }));
    const { rerender } = renderHook(
      ({ enabled }) =>
        useMangaTranslationSession({
          enabled,
          getDocuments: () => [{ doc, index: 4, load }],
        }),
      { initialProps: { enabled: false } },
    );
    mocks.session.processPage.mockClear();
    mocks.session.processDocument.mockClear();

    rerender({ enabled: true });

    await waitFor(() => expect(mocks.session.processPage).toHaveBeenCalledWith(4, load));
    expect(mocks.session.processDocument).toHaveBeenCalledWith(doc, 4);
  });
});
