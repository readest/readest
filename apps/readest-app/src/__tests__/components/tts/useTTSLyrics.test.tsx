import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { LYRIC_MAX_LINES, useTTSLyrics } from '@/app/reader/components/tts/useTTSLyrics';
import { eventDispatcher } from '@/utils/event';

const lines = ['One.', 'Two.', 'Three.'];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useTTSLyrics', () => {
  test('fetches the section transcript once and reports it usable', async () => {
    const onGetLyrics = vi.fn().mockResolvedValue({ sectionIndex: 3, lines });
    const { result } = renderHook(() =>
      useTTSLyrics({
        bookKey: 'b',
        enabled: true,
        onGetLyrics,
        onGetActiveIndex: () => 1,
      }),
    );
    await waitFor(() => expect(result.current.lines).toEqual(lines));
    expect(result.current.unavailable).toBe(false);
    expect(result.current.activeIndex).toBe(1);
    expect(onGetLyrics).toHaveBeenCalledTimes(1);
  });

  test('fetches nothing while the engine has no sentence alignment', async () => {
    const onGetLyrics = vi.fn().mockResolvedValue({ sectionIndex: 0, lines });
    const onGetActiveIndex = vi.fn().mockReturnValue(0);
    renderHook(() => useTTSLyrics({ bookKey: 'b', enabled: false, onGetLyrics, onGetActiveIndex }));
    await act(async () => {});
    expect(onGetLyrics).not.toHaveBeenCalled();
    expect(onGetActiveIndex).not.toHaveBeenCalled();
  });

  test('falls back when the section has no lines to show', async () => {
    const { result } = renderHook(() =>
      useTTSLyrics({
        bookKey: 'b',
        enabled: true,
        onGetLyrics: vi.fn().mockResolvedValue(null),
        onGetActiveIndex: () => -1,
      }),
    );
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.lines).toEqual([]);
  });

  test('falls back when a whole book arrives as one section', async () => {
    const huge = Array.from({ length: LYRIC_MAX_LINES + 1 }, (_, i) => `s${i}`);
    const { result } = renderHook(() =>
      useTTSLyrics({
        bookKey: 'b',
        enabled: true,
        onGetLyrics: vi.fn().mockResolvedValue({ sectionIndex: 0, lines: huge }),
        onGetActiveIndex: () => 0,
      }),
    );
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.lines).toEqual([]);
  });

  test('treats a transcript that cannot be read as no transcript', async () => {
    const { result } = renderHook(() =>
      useTTSLyrics({
        bookKey: 'b',
        enabled: true,
        onGetLyrics: vi.fn().mockRejectedValue(new Error('chunk load failed')),
        onGetActiveIndex: () => 0,
      }),
    );
    // Falls back to the cover rather than leaving the lyric layout over nothing.
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.lines).toEqual([]);
  });

  test('reloads the sheet when playback crosses into another chapter', async () => {
    const onGetLyrics = vi
      .fn()
      .mockResolvedValueOnce({ sectionIndex: 3, lines })
      .mockResolvedValueOnce({ sectionIndex: 4, lines: ['Next chapter.'] });
    const { result } = renderHook(() =>
      useTTSLyrics({
        bookKey: 'b',
        enabled: true,
        onGetLyrics,
        onGetActiveIndex: () => 0,
      }),
    );
    await waitFor(() => expect(result.current.lines).toEqual(lines));

    // Same section: the transcript stands.
    await act(async () => {
      await eventDispatcher.dispatch('tts-position', { bookKey: 'b', sectionIndex: 3 });
    });
    expect(onGetLyrics).toHaveBeenCalledTimes(1);

    await act(async () => {
      await eventDispatcher.dispatch('tts-position', { bookKey: 'b', sectionIndex: 4 });
    });
    await waitFor(() => expect(result.current.lines).toEqual(['Next chapter.']));
  });

  test('ignores position events from another book', async () => {
    const onGetLyrics = vi.fn().mockResolvedValue({ sectionIndex: 0, lines });
    const { result } = renderHook(() =>
      useTTSLyrics({
        bookKey: 'b',
        enabled: true,
        onGetLyrics,
        onGetActiveIndex: () => 0,
      }),
    );
    await waitFor(() => expect(result.current.lines).toEqual(lines));
    // A second book's session reports a different section on the same bus;
    // reloading this sheet from it would swap in the wrong chapter.
    await act(async () => {
      await eventDispatcher.dispatch('tts-position', { bookKey: 'other', sectionIndex: 9 });
    });
    expect(onGetLyrics).toHaveBeenCalledTimes(1);
  });

  test('polls the spoken line as a backstop for a missed position event', async () => {
    vi.useFakeTimers();
    const state = { activeIndex: 0 };
    const { result } = renderHook(() =>
      useTTSLyrics({
        bookKey: 'b',
        enabled: true,
        onGetLyrics: vi.fn().mockResolvedValue({ sectionIndex: 0, lines }),
        onGetActiveIndex: () => state.activeIndex,
      }),
    );
    expect(result.current.activeIndex).toBe(0);
    state.activeIndex = 2;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.activeIndex).toBe(2);
  });
});
