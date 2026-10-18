import { afterEach, expect, test, vi } from 'vitest';
import { AudioHandover } from '@/services/tts/mediaOverlay/AudioHandover';
import type { NarrationClock } from '@/services/tts/mediaOverlay/NarrationClock';

const clock = () => {
  const events = new EventTarget();
  return {
    currentTime: 0,
    playbackRate: 1,
    paused: false as boolean,
    ended: false as boolean,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    addEventListener: (type: string, callback: () => void) =>
      events.addEventListener(type, callback),
    removeEventListener: (type: string, callback: () => void) =>
      events.removeEventListener(type, callback),
    fire: (type: string) => events.dispatchEvent(new Event(type)),
  } satisfies NarrationClock & { fire: (type: string) => void };
};
afterEach(() => vi.useRealTimers());

test('the media boundary starts the next clock once without controller navigation', () => {
  vi.useFakeTimers();
  const first = clock(),
    next = clock();
  const queued = new AudioHandover(first, next, 4, 2);
  first.currentTime = 4;
  vi.advanceTimersByTime(20);
  expect(queued.started).toBe(true);
  expect(first.pause).toHaveBeenCalledOnce();
  expect(next.currentTime).toBe(2);
  expect(next.play).toHaveBeenCalledOnce();
  first.fire('ended');
  expect(next.play).toHaveBeenCalledOnce();
});
test('pause holds a queued handover until playback resumes', () => {
  vi.useFakeTimers();
  const first = clock(),
    next = clock();
  const queued = new AudioHandover(first, next, 4, 0);
  first.currentTime = 4;
  first.paused = true;
  vi.advanceTimersByTime(30);
  expect(next.play).not.toHaveBeenCalled();
  first.paused = false;
  vi.advanceTimersByTime(10);
  expect(queued.started).toBe(true);
});
test('cancel removes both timers and listeners before a seek or stop', () => {
  vi.useFakeTimers();
  const first = clock(),
    next = clock();
  const queued = new AudioHandover(first, next, 4, 0);
  queued.cancel();
  first.currentTime = 4;
  first.fire('timeupdate');
  first.fire('ended');
  vi.advanceTimersByTime(100);
  expect(next.play).not.toHaveBeenCalled();
});

test('a natural file end hands over even when container rounding precedes the SMIL end', () => {
  vi.useFakeTimers();
  const first = clock(),
    next = clock();
  const queued = new AudioHandover(first, next, 21.084, 0);
  first.currentTime = 21.083;
  first.paused = true;
  first.fire('ended');
  expect(queued.started).toBe(true);
  expect(next.play).toHaveBeenCalledOnce();
});

test('a preparation finishing after EOF can hand over, while an explicit pause still holds it', () => {
  vi.useFakeTimers();
  const first = clock(),
    next = clock();
  first.ended = true;
  first.paused = true;
  let userPaused = true;
  const queued = new AudioHandover(first, next, 4, 2, () => !userPaused);
  vi.advanceTimersByTime(20);
  expect(next.play).not.toHaveBeenCalled();
  userPaused = false;
  vi.advanceTimersByTime(10);
  expect(queued.started).toBe(true);
  expect(next.play).toHaveBeenCalledOnce();
});
