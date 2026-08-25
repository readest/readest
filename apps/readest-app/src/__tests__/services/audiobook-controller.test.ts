import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudiobookController } from '@/services/audiobook/AudiobookController';
import { SKIP_FORWARD_SEC } from '@/services/playback/playbackSource';
import type { AudiobookClock } from '@/services/audiobook/AudiobookClock';
import type { ABSChapter, ABSTrack } from '@/types/audiobookshelf';

class FakeClock implements AudiobookClock {
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  url: string | null = null;
  #listeners = new Map<string, Set<() => void>>();
  async load(url: string, startAt: number) {
    this.url = url;
    this.currentTime = startAt;
  }
  async play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  addEventListener(t: string, fn: () => void) {
    if (!this.#listeners.has(t)) this.#listeners.set(t, new Set());
    this.#listeners.get(t)!.add(fn);
  }
  removeEventListener(t: string, fn: () => void) {
    this.#listeners.get(t)?.delete(fn);
  }
  destroy() {
    this.#listeners.clear();
  }
  emit(t: 'ended' | 'error' | 'timeupdate') {
    this.#listeners.get(t)?.forEach((fn) => fn());
  }
}

const track = (index: number, startOffset: number, duration: number): ABSTrack => ({
  index,
  startOffset,
  duration,
  contentUrl: `/f/${index}`,
  mimeType: 'audio/mpeg',
});
const source = () => ({
  itemId: 'i1',
  title: 'Book',
  author: 'A',
  tracks: [track(1, 0, 100), track(2, 100, 100)],
  chapters: [
    { id: 0, start: 0, end: 90, title: 'One' },
    { id: 1, start: 90, end: 200, title: 'Two' },
  ] as ABSChapter[],
  resolveUrl: (p: string) => `http://x${p}?token=t`,
  startAt: 0,
});

describe('AudiobookController', () => {
  let clock: FakeClock;
  let controller: AudiobookController;
  const states: string[] = [];

  beforeEach(() => {
    states.length = 0;
    clock = new FakeClock();
    controller = new AudiobookController(source(), clock);
    controller.addEventListener('tts-state-change', ((e: CustomEvent<{ state: string }>) =>
      states.push(e.detail.state)) as unknown as EventListener);
  });

  it('start loads the first track at the resume point and plays', async () => {
    await controller.start();
    expect(clock.url).toBe('http://x/f/1?token=t');
    expect(clock.paused).toBe(false);
    expect(controller.state).toBe('playing');
  });

  it('resumes mid-book across the track boundary', async () => {
    controller = new AudiobookController({ ...source(), startAt: 150 }, clock);
    await controller.start();
    expect(clock.url).toBe('http://x/f/2?token=t');
    expect(clock.currentTime).toBe(50);
  });

  it('getPlaybackInfo reports global position with measuredFraction 1', async () => {
    await controller.start();
    clock.currentTime = 40;
    expect(controller.getPlaybackInfo()).toEqual({
      position: 40,
      duration: 200,
      measuredFraction: 1,
    });
  });

  it('advances to the next track on ended and finishes the book on the last', async () => {
    await controller.start();
    clock.currentTime = 100; // end of track 1
    clock.emit('ended');
    await vi.waitFor(() => expect(clock.url).toBe('http://x/f/2?token=t'));
    // Transit invariant the bridge depends on: 'stopped' must never appear as
    // a mid-session value, only as the initial or terminal one.
    expect(states).not.toContain('stopped');
    const ended = vi.fn();
    controller.addEventListener('tts-session-ended', ended);
    clock.currentTime = 100;
    clock.emit('ended');
    await vi.waitFor(() => expect(ended).toHaveBeenCalled());
    expect(controller.terminated).toBe(true);
  });

  it('forward(true) skips 30s inside the track; forward() jumps to the next chapter', async () => {
    await controller.start();
    clock.currentTime = 10;
    await controller.forward(true);
    expect(controller.getPlaybackInfo()!.position).toBe(10 + SKIP_FORWARD_SEC);
    await controller.backward(); // 40 -> restart chapter One (40 > 3s into it)
    expect(controller.getPlaybackInfo()!.position).toBe(0);
    await controller.forward(); // next chapter
    expect(controller.getPlaybackInfo()!.position).toBe(90);
  });

  it('seekToTime crossing tracks reloads the right track and preserves rate', async () => {
    await controller.start();
    await controller.setRate(1.5);
    await controller.seekToTime(150);
    expect(clock.url).toBe('http://x/f/2?token=t');
    expect(clock.currentTime).toBe(50);
    expect(clock.playbackRate).toBe(1.5);
  });

  it('pause and start round-trip states for the bridge', async () => {
    await controller.start();
    await controller.pause();
    expect(controller.state).toBe('paused');
    await controller.start();
    expect(controller.state).toBe('playing');
  });

  it('stopAtChapterEnd pauses at the chapter boundary', async () => {
    await controller.start();
    controller.stopAtChapterEnd = true;
    clock.currentTime = 91; // past chapter One's end
    clock.emit('timeupdate');
    await vi.waitFor(() => expect(controller.state).toBe('paused'));
  });

  it('emits a chapter mark on chapter change', async () => {
    const marks: string[] = [];
    controller.addEventListener('tts-speak-mark', ((e: CustomEvent<{ text: string }>) =>
      marks.push(e.detail.text)) as unknown as EventListener);
    await controller.start();
    clock.currentTime = 95;
    clock.emit('timeupdate');
    await vi.waitFor(() => expect(marks).toContain('Two'));
  });

  it('clock error pauses at position instead of terminating; start() reloads a fresh URL', async () => {
    await controller.start();
    clock.currentTime = 42;
    clock.emit('error');
    await vi.waitFor(() => expect(controller.state).toBe('paused'));
    expect(controller.terminated).toBe(false);
    expect(controller.getPlaybackInfo()!.position).toBe(42);
    // Resume reloads the track (fresh resolveUrl call covers token rotation)
    // at the captured position.
    clock.url = null;
    await controller.start();
    expect(clock.url).toBe('http://x/f/1?token=t');
    expect(clock.currentTime).toBe(42);
  });

  it('progress hooks fire on pause and seek', async () => {
    const onPause = vi.fn();
    const onSeek = vi.fn();
    controller = new AudiobookController(source(), clock, { onPause, onSeek });
    await controller.start();
    clock.currentTime = 42;
    await controller.pause();
    expect(onPause).toHaveBeenCalledWith(42);
    await controller.seekToTime(120);
    expect(onSeek).toHaveBeenCalledWith(120);
  });

  it('shutdown after a natural end does not re-fire onEnd, and stops listening on the clock', async () => {
    const onEnd = vi.fn();
    controller = new AudiobookController(source(), clock, { onEnd });
    await controller.start();
    clock.currentTime = 100; // end of track 1
    clock.emit('ended');
    await vi.waitFor(() => expect(clock.url).toBe('http://x/f/2?token=t'));
    clock.currentTime = 100; // end of track 2 (last track)
    clock.emit('ended');
    await vi.waitFor(() => expect(controller.terminated).toBe(true));
    expect(onEnd).toHaveBeenCalledTimes(1);

    await controller.shutdown();
    expect(onEnd).toHaveBeenCalledTimes(1); // not re-fired by shutdown

    const marks: string[] = [];
    controller.addEventListener('tts-speak-mark', ((e: CustomEvent<{ text: string }>) =>
      marks.push(e.detail.text)) as unknown as EventListener);
    states.length = 0;
    // The clock still has these registered per its own bookkeeping only if
    // the controller failed to unregister them; shutdown() must have removed
    // them, so emitting must produce no observable effect at all.
    clock.emit('ended');
    clock.emit('timeupdate');
    expect(marks).toHaveLength(0);
    expect(states).toHaveLength(0);
  });

  // Chrome's autoplay policy rejects play() outright and fires no element
  // 'error' event, so #onError never runs: the rejection escaped unhandled
  // and the UI sat on 'playing' over silence with no way back.
  it('a rejected clock.play() lands in paused instead of escaping unhandled', async () => {
    const onPlay = vi.fn();
    controller = new AudiobookController(source(), clock, { onPlay });
    clock.play = async () => {
      throw new DOMException('play() failed', 'NotAllowedError');
    };

    await expect(controller.start()).resolves.toBeUndefined();

    expect(controller.state).toBe('paused');
    expect(controller.terminated).toBe(false);
    expect(onPlay).not.toHaveBeenCalled();

    // Recovery is one tap: the user's click is a gesture the policy accepts.
    clock.play = async () => {
      clock.paused = false;
    };
    await controller.start();
    expect(controller.state).toBe('playing');
  });

  it('getTitle returns the source title (the episode title when playing a podcast episode)', () => {
    controller = new AudiobookController(
      { ...source(), episodeId: 'ep1', title: 'Episode One' },
      clock,
    );
    expect(controller.getTitle()).toBe('Episode One');
  });

  it('a seek before start survives the initial load', async () => {
    await controller.seekToTime(150); // lands in track 2, before start() ever ran
    expect(clock.url).toBe('http://x/f/2?token=t');
    expect(clock.currentTime).toBe(50);

    await controller.start();
    // start() must not reload source.startAt (track 1) over the earlier seek.
    expect(clock.url).toBe('http://x/f/2?token=t');
    expect(clock.currentTime).toBe(50);
    expect(controller.state).toBe('playing');
  });
});
