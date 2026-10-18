import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { BookDoc } from '@/libs/document';
import { MediaOverlayClient } from '@/services/tts/mediaOverlay/MediaOverlayClient';
import { loadMediaOverlaySection } from '@/services/tts/mediaOverlay/MediaOverlaySection';

// A short PCM tone exercises a real decoder and media clock without bundling a
// commercial recording or relying on a remote fixture.
const tone = () => {
  const samples = 16000;
  const bytes = new ArrayBuffer(44 + samples * 2);
  const data = new DataView(bytes);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) data.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  data.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVEfmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, 16000, true);
  data.setUint32(28, 32000, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  text(36, 'data');
  data.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++)
    data.setInt16(44 + i * 2, 1000 * Math.sin((i * 440 * Math.PI) / 8000), true);
  return new Blob([bytes], { type: 'audio/wav' });
};

let client: MediaOverlayClient;
afterEach(async () => {
  await client?.shutdown();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('a decoded standby file is reused at a real section handover', async () => {
  const elements: HTMLAudioElement[] = [];
  const AudioConstructor = globalThis.Audio;
  vi.stubGlobal('Audio', function () {
    const element = new AudioConstructor();
    element.muted = true;
    elements.push(element);
    return element;
  });
  const loadBlob = vi.fn(async () => tone());
  const book = {
    sections: [0, 1].map((i) => ({ mediaOverlay: { href: `ch${i}.smil` } })),
    loadText: async (href: string) =>
      `<smil xmlns="http://www.w3.org/ns/SMIL"><body><par><text src="chapter.xhtml#line"/><audio src="${href}.wav" clipBegin="0s" clipEnd="0.3s"/></par></body></smil>`,
    loadBlob,
  } as unknown as BookDoc;
  const doc = new DOMParser().parseFromString(
    '<html><body><p id="line">Chapter opening.</p></body></html>',
    'text/html',
  );
  const first = (await loadMediaOverlaySection(book, 0, doc, 'en'))!;
  const second = (await loadMediaOverlaySection(book, 1, doc, 'en'))!;
  client = new MediaOverlayClient();
  await client.init();
  client.attachBook(book);
  client.setSection(first);
  const button = document.createElement('button');
  button.textContent = 'Start narration';
  document.body.append(button);
  await page.getByRole('button', { name: 'Start narration' }).click();
  button.remove();
  const signal = new AbortController().signal;
  const playing = client.speak(first.ssmlForBlock(0)!, signal);
  const opening = (await playing.next()).value;
  expect(opening?.code, JSON.stringify(opening)).toBe('boundary');
  await client.preloadSection(second);
  await vi.waitFor(() => expect(elements[1]!.readyState).toBeGreaterThanOrEqual(3));
  expect(elements[0]!.paused).toBe(false);
  expect(elements[1]!.paused).toBe(true);
  for await (const _ of playing);
  // Simulate a slow section/page navigation: playback must already have crossed
  // into the prepared file without waiting for setSection/speak.
  await vi.waitFor(() => expect(elements[1]!.paused).toBe(false));
  await vi.waitFor(() => expect(elements[1]!.currentTime).toBeGreaterThan(0));

  await client.stop(true);
  client.setSection(second);
  const next = client.speak(second.ssmlForBlock(0)!, signal);
  expect((await next.next()).value).toMatchObject({ code: 'boundary' });
  expect(elements).toHaveLength(2);
  expect(loadBlob).toHaveBeenCalledTimes(2);
  expect(elements[0]!.paused).toBe(true);
  expect(elements[1]!.paused).toBe(false);
  await vi.waitFor(() => expect(elements[1]!.currentTime).toBeGreaterThan(0));
  await client.pause();
  expect(elements[1]!.paused).toBe(true);
});
