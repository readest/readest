import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useOcrProgress } from '@/app/reader/hooks/useOcrProgress';
import { eventDispatcher } from '@/utils/event';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string, values?: { progress: number }) =>
    text.replace('{{progress}}', String(values?.progress)),
}));

afterEach(() => vi.restoreAllMocks());

it('shows preparation once, monotonic page progress, then keeps background pages silent', () => {
  const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
  const { result, rerender } = renderHook(({ enabled }) => useOcrProgress(enabled, 'ja'), {
    initialProps: { enabled: true },
  });
  const progress = (status: string, value: number) =>
    result.current.onProgress({ status, progress: value });
  progress('loading model', 1);
  progress('loading language', 0);
  progress('loading language', 1);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch.mock.calls[0]?.[1]).toMatchObject({
    message: 'Preparing text recognition...',
    placement: 'top',
  });
  expect(dispatch.mock.calls[0]?.[1]).not.toHaveProperty('progress');
  progress('recognizing text', 0.6);
  progress('loading model', 0);
  progress('recognizing text', 0.2);
  progress('recognizing text', 1);
  result.current.onPageRecognized();
  progress('recognizing text', 0);
  result.current.onPageRecognized();
  expect(dispatch.mock.calls.map((call) => (call[1] as { progress?: number }).progress)).toEqual([
    undefined,
    60,
    99,
    100,
  ]);
  expect(dispatch.mock.calls.at(-1)?.[1]).toMatchObject({
    message: 'Text recognition continues in the background.',
  });
  rerender({ enabled: false });
  rerender({ enabled: true });
  progress('loading model', 0);
  expect(dispatch.mock.calls.filter(([event]) => event === 'toast')).toHaveLength(5);
});

it('dismisses only its owned toast when disabled or unmounted', () => {
  const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
  const { result, rerender, unmount } = renderHook(({ enabled }) => useOcrProgress(enabled, 'ja'), {
    initialProps: { enabled: true },
  });

  result.current.onProgress({ status: 'loading model', progress: 1 });
  const ocrToastId = (dispatch.mock.calls[0]?.[1] as { id?: string }).id;
  expect(ocrToastId).toEqual(expect.any(String));

  rerender({ enabled: false });
  expect(dispatch).toHaveBeenCalledWith('toast-dismiss', { id: ocrToastId });

  rerender({ enabled: true });
  result.current.onProgress({ status: 'loading model', progress: 1 });
  unmount();
  expect(dispatch.mock.calls.filter(([event]) => event === 'toast-dismiss')).toHaveLength(3);
});

it('keeps cached page recognition silent when no progress toast was shown', () => {
  const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
  const { result } = renderHook(() => useOcrProgress(true, 'ja'));

  result.current.onPageRecognized();

  expect(dispatch.mock.calls.filter(([event]) => event === 'toast')).toHaveLength(0);
});
