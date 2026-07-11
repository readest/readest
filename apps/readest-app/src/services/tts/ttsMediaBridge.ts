// Session-scoped media-session ownership for TTS.
//
// The lock screen is the primary surface for background TTS: metadata,
// position state, and transport handlers must keep working after the reader
// (and its hooks) unmount. This bridge binds to a TTSController directly —
// its listeners ride controller events, not React lifecycles — and is the
// SOLE owner of media-session handlers from the moment a session starts.
//
// The silent keep-alive element lives here too: it unlocks WebAudio against
// the iOS mute switch, hosts navigator.mediaSession on platforms where a
// playing HTMLMediaElement is required (iOS lock screen, desktop Chromium
// media keys), and must survive hook unmount for a detached session.

import { buildTTSMediaMetadata } from '@/utils/ttsMetadata';
import { fetchImageAsBase64 } from '@/utils/image';
import { getMediaSession, TauriMediaSession } from '@/libs/mediaSession';
import { SILENCE_DATA } from './TTSData';
import type { TTSController } from './TTSController';
import type { TTSMark, TTSMediaMetadataMode } from './types';

export interface TTSMediaBridgeMeta {
  bookKey: string;
  title: string;
  author: string;
  coverImageUrl: string | null;
  metadataMode: TTSMediaMetadataMode;
  // Live section label while the reader is mounted; returns undefined when
  // the supplying hook is dead (headless) — the bridge then keeps the last
  // known label rather than freezing on a stale store read.
  getSectionLabel?: () => string | undefined;
}

// ---------------------------------------------------------------------------
// Keep-alive element (module-scoped: outlives hooks by design).

let unblockerAudio: HTMLAudioElement | null = null;

// This enables WebAudio to play even when the mute toggle switch is ON.
export const unblockAudio = (): void => {
  if (unblockerAudio) return;
  unblockerAudio = document.createElement('audio');
  unblockerAudio.setAttribute('x-webkit-airplay', 'deny');
  unblockerAudio.addEventListener('play', () => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
    }
  });
  unblockerAudio.preload = 'auto';
  unblockerAudio.loop = true;
  unblockerAudio.src = SILENCE_DATA;
  // jsdom's play() returns undefined; browsers return a promise that rejects
  // under autoplay policy outside a user gesture. The keep-alive is
  // best-effort: the production path calls this inside the tts-speak gesture
  // handler, and a rejection must not surface as an unhandled rejection.
  const playing = unblockerAudio.play() as Promise<void> | undefined;
  playing?.catch((err) => {
    console.warn('Keep-alive audio blocked:', err);
  });
};

export const releaseUnblockAudio = (): void => {
  if (!unblockerAudio) return;
  try {
    unblockerAudio.pause();
    unblockerAudio.currentTime = 0;
    unblockerAudio.removeAttribute('src');
    unblockerAudio.src = '';
    unblockerAudio.load();
    unblockerAudio = null;
    console.log('Unblock audio released');
  } catch (err) {
    console.warn('Error releasing unblock audio:', err);
  }
};

// ---------------------------------------------------------------------------

type BridgeMediaSession = TauriMediaSession | MediaSession;

export class TTSMediaBridge {
  #resolveMediaSession: () => BridgeMediaSession | null;
  #mediaSession: BridgeMediaSession | null = null;
  #controller: TTSController | null = null;
  #meta: TTSMediaBridgeMeta | null = null;
  #lastSectionLabel: string | undefined;
  #previousSectionLabel: string | undefined;
  #onSpeakMark: ((e: Event) => void) | null = null;
  #onStateChange: ((e: Event) => void) | null = null;
  // A nexttrack/previoustrack from the car (or lock screen) makes the
  // controller stop() then advance a paragraph — a ~1s round trip. While it
  // is in flight the controller churns (stop -> transient paused, timeline
  // reset), which otherwise reaches the car as a pause flicker / progress
  // reset with no track change: "the forward button does not work". #skipping
  // holds an optimistic playing state and swallows that churn until the next
  // segment's mark lands (or a safety timeout fires).
  #skipping = false;
  #skipTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(resolveMediaSession: () => BridgeMediaSession | null = getMediaSession) {
    this.#resolveMediaSession = resolveMediaSession;
  }

  get isBound(): boolean {
    return this.#controller !== null;
  }

  async bind(controller: TTSController, meta: TTSMediaBridgeMeta): Promise<void> {
    if (this.#controller === controller) {
      // Re-bind on adopt: refresh the meta (new bookKey / live label source)
      // without re-registering listeners or re-activating the session.
      this.#meta = meta;
      return;
    }
    this.unbind();
    this.#controller = controller;
    this.#meta = meta;
    this.#mediaSession = this.#resolveMediaSession();
    if (!this.#mediaSession) return;
    // bind() awaits below (cover fetch, setActive), during which a concurrent
    // unbind() (e.g. a stop during startup) nulls #mediaSession. Use the
    // captured session for the awaited calls so they can't deref null, then
    // bail before wiring handlers onto a torn-down session (READEST-1A).
    const mediaSession = this.#mediaSession;

    if (mediaSession instanceof TauriMediaSession) {
      let artwork = '/icon.png';
      try {
        artwork = await fetchImageAsBase64(meta.coverImageUrl || '/icon.png');
      } catch {
        try {
          artwork = await fetchImageAsBase64('/icon.png');
        } catch {
          artwork = '';
        }
      }
      await mediaSession.setActive({
        active: true,
        // bookKey is `${hash}-${uniqueId()}`; the hash alone addresses the book
        // for a readest://book/{hash} resume deep link from the car.
        bookHash: meta.bookKey.split('-')[0],
        bookTitle: meta.title,
        bookAuthor: meta.author,
      });
      await mediaSession.updateMetadata({
        title: meta.title,
        artist: meta.author,
        album: meta.title,
        artwork,
      });
    }

    if (this.#mediaSession !== mediaSession) return;

    this.#registerActionHandlers();

    this.#onSpeakMark = (e: Event) => {
      const mark = (e as CustomEvent<TTSMark>).detail;
      // Only end the hold once the skipped-to segment is actually playing. A
      // stray mark from the aborted segment (stop() during forward/backward)
      // would otherwise clear the hold early and let the position push below
      // surface a paused/stale state — the residual backward flicker.
      if (this.#controller?.state === 'playing') this.#endSkip();
      void this.#updateMetadata(mark);
      void this.#updatePositionState();
    };
    this.#onStateChange = () => {
      void this.#updatePlaybackState();
    };
    controller.addEventListener('tts-speak-mark', this.#onSpeakMark);
    controller.addEventListener('tts-state-change', this.#onStateChange);
  }

  unbind(): void {
    if (this.#controller) {
      if (this.#onSpeakMark) {
        this.#controller.removeEventListener('tts-speak-mark', this.#onSpeakMark);
      }
      if (this.#onStateChange) {
        this.#controller.removeEventListener('tts-state-change', this.#onStateChange);
      }
    }
    const mediaSession = this.#mediaSession;
    if (mediaSession) {
      for (const action of [
        'play',
        'pause',
        'stop',
        'seekforward',
        'seekbackward',
        'nexttrack',
        'previoustrack',
        'seekto',
      ]) {
        try {
          mediaSession.setActionHandler(action as MediaSessionAction, null);
        } catch {
          // Unsupported actions on this engine.
        }
      }
      if (mediaSession instanceof TauriMediaSession) {
        void mediaSession.setActive({ active: false });
      }
    }
    this.#endSkip();
    this.#controller = null;
    this.#meta = null;
    this.#mediaSession = null;
    this.#onSpeakMark = null;
    this.#onStateChange = null;
    this.#lastSectionLabel = undefined;
    this.#previousSectionLabel = undefined;
  }

  #registerActionHandlers(): void {
    const mediaSession = this.#mediaSession;
    if (!mediaSession) return;
    const controller = () => this.#controller;

    const togglePlay = () => {
      const ctrl = controller();
      if (!ctrl) return;
      if (ctrl.state === 'playing') {
        void ctrl.pause();
      } else if (ctrl.state.includes('paused')) {
        void ctrl.start();
      }
    };
    mediaSession.setActionHandler('play', togglePlay);
    mediaSession.setActionHandler('pause', togglePlay);
    // 'stop' keeps its long-standing pause mapping; the hard stop lives in
    // the in-app surfaces (panel, now-playing bar).
    mediaSession.setActionHandler('stop', () => {
      const ctrl = controller();
      if (ctrl?.state === 'playing') void ctrl.pause();
    });
    mediaSession.setActionHandler('seekforward', () => void controller()?.forward(true));
    mediaSession.setActionHandler('seekbackward', () => void controller()?.backward(true));
    mediaSession.setActionHandler('nexttrack', () => {
      this.#beginSkip();
      void controller()?.forward();
    });
    mediaSession.setActionHandler('previoustrack', () => {
      this.#beginSkip();
      void controller()?.backward();
    });
    if (mediaSession instanceof TauriMediaSession) {
      mediaSession.setActionHandler('seekto', ((positionMs: number) => {
        void controller()?.seekToTime(positionMs / 1000);
      }) as (position: number) => void);
    } else {
      try {
        mediaSession.setActionHandler('seekto', (details: MediaSessionActionDetails) => {
          if (typeof details.seekTime === 'number') {
            void controller()?.seekToTime(details.seekTime);
          }
        });
      } catch {
        // 'seekto' unsupported on this engine.
      }
    }
  }

  async #updateMetadata(mark: TTSMark | undefined): Promise<void> {
    const mediaSession = this.#mediaSession;
    const meta = this.#meta;
    if (!mediaSession || !meta) return;
    const liveLabel = meta.getSectionLabel?.();
    if (liveLabel) this.#lastSectionLabel = liveLabel;

    const metadata = buildTTSMediaMetadata({
      markText: mark?.text || '',
      markName: mark?.name || '',
      sectionLabel: this.#lastSectionLabel || '',
      title: meta.title,
      author: meta.author,
      ttsMediaMetadata: meta.metadataMode,
      previousSectionLabel: this.#previousSectionLabel,
    });
    if (meta.metadataMode === 'chapter') {
      this.#previousSectionLabel = this.#lastSectionLabel;
    }
    if (!metadata.shouldUpdate) return;

    if (mediaSession instanceof TauriMediaSession) {
      await mediaSession.updateMetadata({
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        artwork: '',
      });
    } else {
      mediaSession.metadata = new MediaMetadata({
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        artwork: [{ src: meta.coverImageUrl || '/icon.png', sizes: '512x512', type: 'image/png' }],
      });
    }
  }

  // Clamped, never skipped: skipping when the position overshoots an
  // estimated duration would freeze the lock-screen scrubber.
  async #updatePositionState(): Promise<void> {
    const mediaSession = this.#mediaSession;
    const ctrl = this.#controller;
    if (!mediaSession || !ctrl) return;
    // Hold position/playing steady through a skip: a stray mark mid-transition
    // must not push the timeline reset or a paused state to the car.
    if (this.#skipping) return;
    await ctrl.ensureTimeline();
    const info = ctrl.getPlaybackInfo();
    if (!info || !Number.isFinite(info.duration) || info.duration <= 0) return;
    const position = Math.min(Math.max(info.position, 0), info.duration);
    if (mediaSession instanceof TauriMediaSession) {
      await mediaSession.updatePlaybackState({
        playing: ctrl.state === 'playing',
        position: Math.round(position * 1000),
        duration: Math.round(info.duration * 1000),
      });
    } else if ('setPositionState' in mediaSession) {
      try {
        mediaSession.setPositionState({ duration: info.duration, position, playbackRate: 1 });
      } catch {
        // Transiently inconsistent states reject on some engines; the next
        // mark updates again.
      }
    }
  }

  // Enter the skip hold: assert playing at the last-known position right away
  // so the car gets instant, coherent feedback before the round trip lands.
  #beginSkip(): void {
    const mediaSession = this.#mediaSession;
    this.#skipping = true;
    if (mediaSession instanceof TauriMediaSession) {
      void mediaSession.updatePlaybackState({ playing: true });
    } else if (mediaSession) {
      mediaSession.playbackState = 'playing';
    }
    if (this.#skipTimer) clearTimeout(this.#skipTimer);
    // Safety net: if no mark arrives (e.g. the skip failed) stop holding so a
    // later pause/stop can surface.
    this.#skipTimer = setTimeout(() => this.#endSkip(), 4000);
  }

  #endSkip(): void {
    if (this.#skipTimer) {
      clearTimeout(this.#skipTimer);
      this.#skipTimer = null;
    }
    this.#skipping = false;
  }

  async #updatePlaybackState(): Promise<void> {
    const mediaSession = this.#mediaSession;
    const ctrl = this.#controller;
    if (!mediaSession || !ctrl) return;
    // Transit 'stopped' flickers on every paragraph advance; only surface
    // playing/paused flips to the OS.
    if (ctrl.state === 'stopped' && !ctrl.terminated) return;
    // Hold the optimistic playing state through a skip's stop/paused churn; a
    // terminal stop (end of book) still surfaces and ends the hold.
    if (this.#skipping && !ctrl.terminated) return;
    if (ctrl.terminated) this.#endSkip();
    if (mediaSession instanceof TauriMediaSession) {
      await mediaSession.updatePlaybackState({ playing: ctrl.state === 'playing' });
    } else {
      mediaSession.playbackState = ctrl.state === 'playing' ? 'playing' : 'paused';
    }
  }
}

export const ttsMediaBridge = new TTSMediaBridge();
