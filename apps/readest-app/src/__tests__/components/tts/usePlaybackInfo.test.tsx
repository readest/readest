import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { eventDispatcher } from '@/utils/event';
import { usePlaybackInfo } from '@/app/reader/components/tts/usePlaybackInfo';

const info = (position: number, duration = 100, measuredFraction = 0) => ({
  position,
  duration,
  measuredFraction,
});

describe('usePlaybackInfo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('reads immediately and polls every second', () => {
    const get = vi.fn().mockReturnValue(info(10, 100, 0.3));
    const { result } = renderHook(() =>
      usePlaybackInfo({ bookKey: 'b1', isEink: false, onGetPlaybackInfo: get }),
    );
    expect(result.current.ready).toBe(true);
    expect(result.current.position).toBe(10);
    expect(result.current.total).toBe(100);
    expect(result.current.measuredFraction).toBe(0.3);

    get.mockReturnValue(info(12));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.position).toBe(12);
  });

  test('holds position monotonic against small backward drift, follows big jumps', () => {
    const get = vi.fn().mockReturnValue(info(20));
    const { result } = renderHook(() =>
      usePlaybackInfo({ bookKey: 'b1', isEink: false, onGetPlaybackInfo: get }),
    );
    get.mockReturnValue(info(18.5)); // < 3s drift: estimate refinement
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.position).toBe(20);

    get.mockReturnValue(info(5)); // > 3s jump: deliberate (seek / chapter)
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.position).toBe(5);
  });

  test('quantizes the displayed total: follows only >2% moves', () => {
    const get = vi.fn().mockReturnValue(info(10, 100));
    const { result } = renderHook(() =>
      usePlaybackInfo({ bookKey: 'b1', isEink: false, onGetPlaybackInfo: get }),
    );
    get.mockReturnValue(info(11, 101)); // 1% drift: hold
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.total).toBe(100);

    get.mockReturnValue(info(12, 110)); // 10% move: follow
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.total).toBe(110);
  });

  test('goes stale but keeps last values when the poll returns null', () => {
    const get = vi.fn().mockReturnValue(info(10));
    const { result } = renderHook(() =>
      usePlaybackInfo({ bookKey: 'b1', isEink: false, onGetPlaybackInfo: get }),
    );
    get.mockReturnValue(null);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.stale).toBe(true);
    expect(result.current.position).toBe(10);
  });

  test('setRefreshPaused freezes polling while dragging', () => {
    const get = vi.fn().mockReturnValue(info(10));
    const { result } = renderHook(() =>
      usePlaybackInfo({ bookKey: 'b1', isEink: false, onGetPlaybackInfo: get }),
    );
    act(() => {
      result.current.setRefreshPaused(true);
    });
    get.mockReturnValue(info(30));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.position).toBe(10);
  });

  test('applySeek lands optimistically, suppresses polls, rollback restores', () => {
    const get = vi.fn().mockReturnValue(info(10));
    const { result } = renderHook(() =>
      usePlaybackInfo({ bookKey: 'b1', isEink: false, onGetPlaybackInfo: get }),
    );
    let rollback: () => void;
    act(() => {
      rollback = result.current.applySeek(50);
    });
    expect(result.current.position).toBe(50);

    get.mockReturnValue(info(11)); // stale server position inside suppression window
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.position).toBe(50);

    act(() => {
      rollback!();
    });
    expect(result.current.position).toBe(10);
  });

  test('eink mode refreshes on sentence tts-position events, not on a timer', async () => {
    const get = vi.fn().mockReturnValue(info(10));
    const { result } = renderHook(() =>
      usePlaybackInfo({ bookKey: 'b1', isEink: true, onGetPlaybackInfo: get }),
    );
    get.mockReturnValue(info(15));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.position).toBe(10);

    await act(async () => {
      await eventDispatcher.dispatch('tts-position', { bookKey: 'b1', kind: 'sentence' });
    });
    expect(result.current.position).toBe(15);
  });
});
