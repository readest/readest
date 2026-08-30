import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: {
    processDocument: vi.fn(async () => null),
    setEnabled: vi.fn(async () => undefined),
    terminate: vi.fn(async () => undefined),
  },
  sessionOptions: [] as Array<{
    createEngine: () => unknown;
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
    expect(mocks.session.processDocument).toHaveBeenCalledWith(doc, 2, { priority: true });

    rerender({ enabled: true });
    expect(mocks.session.setEnabled).toHaveBeenLastCalledWith(true);

    expect(mocks.sessionOptions[0]!.createEngine()).toBe(mocks.engine);
    const progress = { status: 'translating speech bubbles', progress: 0.5 };
    (mocks.engineOptions[0] as { onProgress: (value: typeof progress) => void }).onProgress(
      progress,
    );
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
      expect(mocks.session.processDocument).toHaveBeenCalledWith(doc, 6, { priority: true });
    });
  });

  it('processes the current renderer order before older remembered pages', async () => {
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
      [current, 7, { priority: true }],
      [first, 5],
    ]);
  });
});
