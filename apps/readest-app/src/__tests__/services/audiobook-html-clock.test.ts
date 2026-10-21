import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HtmlAudioClock } from '@/services/audiobook/AudiobookClock';

// The element is private to the clock; read its CORS mode as the load starts.
let crossOrigin: string | null | undefined;

beforeEach(() => {
  crossOrigin = undefined;
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    crossOrigin = this.crossOrigin;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const load = async (platform: string, url: string, options?: { cors: boolean }) => {
  vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', platform);
  await new HtmlAudioClock(options).load(url, 0);
  return crossOrigin;
};

describe('HtmlAudioClock', () => {
  it('fetches a stream from another origin with CORS on the web app', async () => {
    expect(await load('web', 'https://abs.example/api/items/1/file/2?token=t')).toBe('anonymous');
  });

  it('matches the scheme of a track URL case-insensitively', async () => {
    expect(await load('web', 'HTTPS://abs.example/api/items/1/file/2?token=t')).toBe('anonymous');
  });

  it('leaves same-origin and blob URLs alone on the web app', async () => {
    expect(await load('web', `${location.origin}/audio/1.mp3`)).toBeNull();
    expect(await load('web', 'blob:track-1')).toBeNull();
  });

  it('leaves the request mode alone in the desktop and mobile apps', async () => {
    expect(await load('tauri', 'https://abs.example/api/items/1/file/2?token=t')).toBeNull();
  });

  it('leaves the request mode alone for a caller that turns CORS off', async () => {
    expect(await load('web', 'https://books.example/1.mp3', { cors: false })).toBeNull();
  });

  it('drops the CORS mode when the element moves on to a same-origin track', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'web');
    const clock = new HtmlAudioClock();
    await clock.load('https://abs.example/api/items/1/file/2', 0);
    await clock.load('blob:track-1', 0);
    expect(crossOrigin).toBeNull();
  });
});
