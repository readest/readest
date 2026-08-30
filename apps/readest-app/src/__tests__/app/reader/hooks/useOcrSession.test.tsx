import { act, renderHook } from '@testing-library/react';
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
    onPageRecognized?: (page: unknown) => void;
  }>,
  engine: {
    recognize: vi.fn(),
    terminate: vi.fn(async () => undefined),
  },
  engineOptions: [] as unknown[],
}));

vi.mock('@/app/reader/services/ocr/ocrSession', () => ({
  OcrSession: vi.fn(function (options) {
    mocks.sessionOptions.push(options);
    return mocks.session;
  }),
}));

vi.mock('@/app/reader/services/ocr/tesseractEngine', () => ({
  TesseractOcrEngine: vi.fn(function (options) {
    mocks.engineOptions.push(options);
    return mocks.engine;
  }),
}));

import { useOcrSession } from '@/app/reader/hooks/useOcrSession';

describe('useOcrSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionOptions.length = 0;
    mocks.engineOptions.length = 0;
  });

  it('hands documents to one session and follows the enabled state', async () => {
    const onError = vi.fn();
    const onPageRecognized = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) =>
        useOcrSession({
          enabled,
          language: undefined,
          mangaFallback: true,
          onError,
          onPageRecognized,
        }),
      { initialProps: { enabled: false } },
    );
    const doc = document.implementation.createHTMLDocument();

    expect(mocks.session.setEnabled).toHaveBeenCalledWith(false);
    await act(async () => {
      await result.current(doc, 2);
    });
    expect(mocks.session.processDocument).toHaveBeenCalledWith(doc, 2);

    rerender({ enabled: true });
    expect(mocks.session.setEnabled).toHaveBeenLastCalledWith(true);

    const engine = mocks.sessionOptions[0]!.createEngine();
    expect(engine).toBe(mocks.engine);
    expect(mocks.engineOptions).toEqual([
      expect.objectContaining({ languages: ['jpn', 'jpn_vert', 'eng'] }),
    ]);

    const error = new Error('recognition failed');
    mocks.sessionOptions[0]!.onError?.(error, 2);
    expect(onError).toHaveBeenCalledWith(error, 2);

    const page = { pageIndex: 2 };
    mocks.sessionOptions[0]!.onPageRecognized?.(page);
    expect(onPageRecognized).toHaveBeenCalledWith(page);

    unmount();
    expect(mocks.session.terminate).toHaveBeenCalledTimes(1);
  });
});
