import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sounds from '@/services/localsend/sounds';
import {
  isLocalSendSoundsEnabled,
  setLocalSendSoundsEnabled,
  shouldPlayTransferCue,
} from '@/services/localsend/sounds';

describe('transfer sound preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to on', () => {
    expect(isLocalSendSoundsEnabled()).toBe(true);
  });

  it('round-trips the toggle', () => {
    setLocalSendSoundsEnabled(false);
    expect(isLocalSendSoundsEnabled()).toBe(false);
    setLocalSendSoundsEnabled(true);
    expect(isLocalSendSoundsEnabled()).toBe(true);
  });
});

describe('shouldPlayTransferCue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('plays by default off e-ink', () => {
    expect(shouldPlayTransferCue({ eink: false })).toBe(true);
  });

  it('never plays on e-ink regardless of the toggle', () => {
    setLocalSendSoundsEnabled(true);
    expect(shouldPlayTransferCue({ eink: true })).toBe(false);
  });

  it('respects the toggle', () => {
    setLocalSendSoundsEnabled(false);
    expect(shouldPlayTransferCue({ eink: false })).toBe(false);
  });
});

describe('playTransferDoneCue', () => {
  const play = vi.fn(() => Promise.resolve());
  const created: string[] = [];
  // The cue element is a module-level singleton, so a test that asserts on the
  // construction would otherwise pass only while it is the first one to play.
  let playTransferDoneCue: typeof sounds.playTransferDoneCue;

  beforeEach(async () => {
    localStorage.clear();
    created.length = 0;
    play.mockClear();
    vi.stubGlobal(
      'Audio',
      class {
        currentTime = 0;
        preload = '';
        play = play;
        constructor(src: string) {
          created.push(src);
        }
      },
    );
    vi.resetModules();
    ({ playTransferDoneCue } = await import('@/services/localsend/sounds'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plays the success cue only', () => {
    playTransferDoneCue({ eink: false });
    expect(created).toEqual(['/assets/localsend-done.wav']);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('stays silent when cues are off', () => {
    setLocalSendSoundsEnabled(false);
    playTransferDoneCue({ eink: false });
    expect(play).not.toHaveBeenCalled();
  });

  // The regression in #6271: priming played every cue on the first pointerdown,
  // so opening the reader rang the device with no transfer in sight. The only
  // sound Nearby BookDrop makes is a completed transfer.
  it('exposes no other cue or priming entry point', () => {
    expect(
      Object.keys(sounds)
        .filter((key) => /cue/i.test(key))
        .sort(),
    ).toEqual(['playTransferDoneCue', 'shouldPlayTransferCue']);
  });
});
