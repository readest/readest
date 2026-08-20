import { describe, expect, it } from 'vitest';
import type { PlaybackSource } from '@/services/playback/playbackSource';
import { TTSController } from '@/services/tts/TTSController';
import { asTTSController } from '@/services/tts/TTSSessionManager';
import type { FoliateView } from '@/types/view';

// The seam's real regression guard is the existing TTS suite (controller,
// media bridge, session manager, useTTSControl). This file pins the two
// things those suites cannot: that TTSController still satisfies the
// PlaybackSource contract at the type level, and that the kind narrowing
// helper the TTS-only consumers rely on actually narrows.

describe('PlaybackSource seam', () => {
  it('TTSController conforms structurally and reports kind tts', () => {
    // Compile-time conformance: this assignment is the assertion (tsgo in
    // `pnpm lint` enforces it; vitest does not type-check).
    const probe = null as unknown as TTSController;
    const source: PlaybackSource = probe;
    void source;
    // Runtime: the tag every consumer narrows on must survive construction.
    // asTTSController() and the stats gate both read it off the instance.
    const controller = new TTSController(null, null as unknown as FoliateView);
    expect(controller.kind).toBe('tts');
    expect(asTTSController(controller)).toBe(controller);
  });

  it('asTTSController narrows by kind', () => {
    const fake = { kind: 'audiobook' } as unknown as PlaybackSource;
    expect(asTTSController(fake)).toBeNull();
    const tts = { kind: 'tts' } as unknown as PlaybackSource;
    expect(asTTSController(tts)).not.toBeNull();
    expect(asTTSController(null)).toBeNull();
    expect(asTTSController(undefined)).toBeNull();
  });
});
