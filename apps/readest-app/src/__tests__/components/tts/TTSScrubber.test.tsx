import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts?: Record<string, unknown>) =>
    opts ? Object.entries(opts).reduce((s, [k, v]) => s.replace(`{{${k}}}`, String(v)), key) : key,
}));

import { eventDispatcher } from '@/utils/event';
import TTSScrubber from '@/app/reader/components/tts/TTSScrubber';

const makeGet = (position: number, duration = 100, measuredFraction = 0.4) =>
  vi.fn().mockReturnValue({ position, duration, measuredFraction });

describe('TTSScrubber', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test('scrubs continuously in 1-second steps regardless of duration', () => {
    render(
      <TTSScrubber
        bookKey='b1'
        isEink={false}
        onSeek={vi.fn()}
        onGetPlaybackInfo={makeGet(10, 900)}
      />,
    );
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.getAttribute('step')).toBe('1');
  });

  test('previews the drag location at most every 100ms and stops after release', () => {
    vi.useFakeTimers();
    const onSeek = vi.fn().mockResolvedValue(undefined);
    const onSeekPreview = vi.fn();
    render(
      <TTSScrubber
        bookKey='b1'
        isEink={false}
        onSeek={onSeek}
        onSeekPreview={onSeekPreview}
        onGetPlaybackInfo={makeGet(10)}
      />,
    );
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '30' } });
    expect(onSeekPreview).toHaveBeenCalledTimes(1); // leading call
    expect(onSeekPreview).toHaveBeenCalledWith(30);
    fireEvent.change(slider, { target: { value: '40' } });
    expect(onSeekPreview).toHaveBeenCalledTimes(1); // throttled inside the window
    vi.advanceTimersByTime(100);
    expect(onSeekPreview).toHaveBeenCalledTimes(2); // trailing emit
    expect(onSeekPreview).toHaveBeenLastCalledWith(40);
    fireEvent.change(slider, { target: { value: '50' } });
    expect(onSeekPreview).toHaveBeenCalledTimes(3); // window elapsed, leading again
    fireEvent.change(slider, { target: { value: '60' } });
    expect(onSeekPreview).toHaveBeenCalledTimes(3); // trailing pending
    fireEvent.touchEnd(slider);
    expect(onSeek).toHaveBeenCalledWith(60);
    vi.advanceTimersByTime(200);
    // The commit path owns navigation after release; the pending trailing
    // preview must not redraw an overlay nothing would clear.
    expect(onSeekPreview).toHaveBeenCalledTimes(3);
  });

  test('renders elapsed and remaining labels', () => {
    render(
      <TTSScrubber bookKey='b1' isEink={false} onSeek={vi.fn()} onGetPlaybackInfo={makeGet(10)} />,
    );
    expect(screen.getByText('0:10')).toBeTruthy();
    expect(screen.getByText('-1:30')).toBeTruthy();
  });

  test('paints played and buffered regions into the track gradient', () => {
    render(
      <TTSScrubber
        bookKey='b1'
        isEink={false}
        onSeek={vi.fn()}
        onGetPlaybackInfo={makeGet(10, 100, 0.4)}
      />,
    );
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.style.background).toContain('10%');
    expect(slider.style.background).toContain('40%');
  });

  test('commits a seek on release and holds the thumb optimistically', () => {
    const onSeek = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    render(
      <TTSScrubber bookKey='b1' isEink={false} onSeek={onSeek} onGetPlaybackInfo={makeGet(10)} />,
    );
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '50' } });
    expect(onSeek).not.toHaveBeenCalled(); // drag in progress, no seek yet
    fireEvent.touchEnd(slider);
    expect(onSeek).toHaveBeenCalledWith(50);
    expect(slider.value).toBe('50');
  });

  test('failed seek restores the previous position and toasts', async () => {
    const onSeek = vi.fn().mockRejectedValue(new Error('offline'));
    const onToast = vi.fn();
    eventDispatcher.on('toast', onToast);
    render(
      <TTSScrubber bookKey='b1' isEink={false} onSeek={onSeek} onGetPlaybackInfo={makeGet(10)} />,
    );
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '50' } });
    await act(async () => {
      fireEvent.touchEnd(slider);
    });
    // The rejection handler dispatches the toast asynchronously.
    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith(
        expect.objectContaining({ detail: expect.objectContaining({ message: 'Failed to seek' }) }),
      );
    });
    expect(slider.value).toBe('10');
    eventDispatcher.off('toast', onToast);
  });
});
