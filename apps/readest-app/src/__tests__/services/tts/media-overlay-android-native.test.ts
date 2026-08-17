import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  addPluginListener: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  tempDir: vi.fn(async () => '/tmp'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { Temp: 1 },
  writeFile: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}));

vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getOSPlatform: () => 'android',
}));

import { addPluginListener, invoke, type PluginListener } from '@tauri-apps/api/core';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { BookDoc } from '@/libs/document';
import type { TTSController } from '@/services/tts/TTSController';
import {
  loadMediaOverlaySection,
  type MediaOverlaySection,
} from '@/services/tts/mediaOverlay/MediaOverlaySection';
import { MediaOverlayClient } from '@/services/tts/mediaOverlay/MediaOverlayClient';

class ForbiddenAudio {
  constructor() {
    throw new Error('MediaOverlayClient buffered an Android audiobook in an HTML audio element');
  }
}

let client: MediaOverlayClient;
let section: MediaOverlaySection;
let controlCalls: Array<Record<string, unknown>>;

const setup = async () => {
  const doc = new DOMParser().parseFromString(
    '<!DOCTYPE html><html><body><p id="chapter">Chapter</p></body></html>',
    'text/html',
  );
  const book = {
    sections: [{ mediaOverlay: { href: 'ch1.smil', id: 'smil1' } }],
    loadText: async () =>
      '<smil xmlns="http://www.w3.org/ns/SMIL"><body><par><text src="ch1.xhtml#chapter"/><audio src="book.m4b" clipBegin="0s" clipEnd="10s"/></par></body></smil>',
    loadBlob: vi.fn(async () => new Blob([new Uint8Array(8)])),
  } as unknown as BookDoc;
  section = (await loadMediaOverlaySection(book, 0, doc, 'en'))!;
  client = new MediaOverlayClient({ dispatchSpeakMark: vi.fn() } as unknown as TTSController);
  await client.init();
  client.attachSource({
    loadBlob: vi.fn(async () => new Blob([new Uint8Array(8)])),
    resolvePath: vi.fn(async () => '/books/hash/audiobook/book.m4b'),
  });
  client.setSection(section);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
  vi.stubGlobal('Audio', ForbiddenAudio);
  controlCalls = [];
  vi.mocked(addPluginListener).mockResolvedValue({
    unregister: vi.fn(),
  } as unknown as PluginListener);
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    const payload = (args as { payload?: Record<string, unknown> })?.payload ?? {};
    if (command === 'plugin:native-tts|playout_control') {
      controlCalls.push(payload);
      return payload['action'] === 'start-session'
        ? ({ session: 11 } as unknown)
        : ({ session: null } as unknown);
    }
    if (command === 'plugin:native-tts|playout_position') {
      return { session: 11, index: 0, positionMs: 0, playing: true } as unknown;
    }
    return undefined as unknown;
  });
});

afterEach(async () => {
  await client?.shutdown();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('MediaOverlayClient on Android Tauri', () => {
  test('streams a paired audiobook from its native path without buffering it', async () => {
    await setup();
    const utterance = client.speak(section.ssmlForBlock(0)!, new AbortController().signal);
    await utterance.next();

    expect(writeFile).not.toHaveBeenCalled();
    expect(controlCalls.find((call) => call['action'] === 'load')?.['path']).toBe(
      '/books/hash/audiobook/book.m4b',
    );
  });
});
