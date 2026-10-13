import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlobAudioClock } from '@/services/audiobook/AudiobookClock';

let urls = 0;
const createObjectURL = vi.fn(() => `blob:track-${++urls}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  urls = 0;
  vi.clearAllMocks();
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const blob = () => new Blob(['mp3'], { type: 'audio/mpeg' });

describe('BlobAudioClock', () => {
  it('plays a file path from a blob URL, reusing it within the same track', async () => {
    const loadBlob = vi.fn(async () => blob());
    const clock = new BlobAudioClock(loadBlob);

    await clock.load('/books/h/1.mp3', 0);
    await clock.load('/books/h/1.mp3', 30);

    expect(loadBlob).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clock.currentTime).toBe(30);
  });

  it('releases the previous track and the last one on destroy', async () => {
    const clock = new BlobAudioClock(async () => blob());

    await clock.load('/books/h/1.mp3', 0);
    await clock.load('/books/h/2.mp3', 0);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:track-1');

    clock.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:track-2');
  });

  it('drops a load that a newer one overtook', async () => {
    let finishFirst: (b: Blob) => void = () => {};
    const loadBlob = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Blob>((resolve) => (finishFirst = resolve)))
      .mockImplementationOnce(async () => blob());
    const clock = new BlobAudioClock(loadBlob);

    const first = clock.load('/books/h/1.mp3', 0);
    await clock.load('/books/h/2.mp3', 0);
    finishFirst(blob());
    await first;

    // The stale first track never replaces the second one.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    clock.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:track-1');
  });

  it('never creates a URL for a load still pending when the clock is destroyed', async () => {
    let finish: (b: Blob) => void = () => {};
    const clock = new BlobAudioClock(() => new Promise<Blob>((resolve) => (finish = resolve)));

    const pending = clock.load('/books/h/1.mp3', 0);
    clock.destroy();
    finish(blob());
    await pending;

    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
