// Single-slot, hash-keyed registry for the live TTS session.
//
// A fresh TTSController (and bookKey) is created every time a book opens —
// bookKey is `${hash}-${uniqueId()}` — so sessions key by book HASH and treat
// bookKey as ephemeral. The manager owns everything that must outlive the
// reader's React hooks: the media bridge binding, the silent keep-alive, the
// sleep timer, headless progress persistence, and the app-level playback
// state relay. It is a per-webview singleton by design (multi-window desktop
// keeps its current per-window behavior).

import env from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { invokeUseBackgroundAudio } from '@/utils/bridge';
import { eventDispatcher } from '@/utils/event';
import { releaseUnblockAudio, ttsMediaBridge, TTSMediaBridgeMeta } from './ttsMediaBridge';
import type { TTSController } from './TTSController';

export type TTSSessionMeta = TTSMediaBridgeMeta;

export interface TTSSession {
  bookHash: string;
  bookKey: string;
  controller: TTSController;
}

export type TTSSessionStopReason =
  | 'user'
  | 'replaced'
  | 'timeout'
  | 'ended'
  | 'error'
  | 'deleted'
  | 'quit';

export const getBookHashFromKey = (bookKey: string): string => bookKey.split('-')[0]!;

// Headless position writes hit the disk at most this often; stopActive
// flushes the final position regardless.
const PERSIST_THROTTLE_MS = 10_000;

export class TTSSessionManager extends EventTarget {
  #session: TTSSession | null = null;
  #meta: TTSSessionMeta | null = null;
  #onStateChange: ((e: Event) => void) | null = null;
  #onSessionEnded: ((e: Event) => void) | null = null;
  #onHighlightMark: ((e: Event) => void) | null = null;
  #lastRelayedState: 'playing' | 'paused' | null = null;
  #sleepTimer: ReturnType<typeof setTimeout> | null = null;
  #sleepTimeoutSec = 0;
  #sleepFiresAt = 0;
  #lastPersistAt = 0;
  #pendingLocation: string | null = null;
  #stopping = false;

  claim(bookKey: string, controller: TTSController, meta: TTSSessionMeta): void {
    const bookHash = getBookHashFromKey(bookKey);
    const existing = this.#session;
    if (existing && existing.bookHash !== bookHash) {
      // Starting TTS in another book replaces the single slot.
      void this.stopActive('replaced');
    } else if (existing && existing.controller !== controller) {
      // Same book restarted with a fresh controller: swap silently. The
      // manager owns the replaced controller's teardown — and must
      // unsubscribe first so the old controller's async tail can't relay.
      this.#unsubscribe(existing.controller);
      existing.controller.shutdown().catch(() => {});
    }
    this.#session = { bookHash, bookKey, controller };
    this.#meta = meta;
    this.#lastRelayedState = null;
    this.#subscribe(controller);
    void ttsMediaBridge.bind(controller, meta);
    this.#emitSessionChanged('claimed');
  }

  getSessionByHash(bookHash: string): TTSSession | null {
    return this.#session?.bookHash === bookHash ? this.#session : null;
  }

  getActiveSession(): TTSSession | null {
    return this.#session;
  }

  // The session survives; only the view goes away. The bridge stays bound so
  // the lock screen keeps working headless.
  detach(bookHash: string): void {
    const session = this.getSessionByHash(bookHash);
    if (!session) return;
    const wasPlaying = session.controller.state === 'playing' || !session.controller.terminated;
    session.controller.detachView();
    this.#emitSessionChanged('detached');
    // Closing a book while it keeps talking inverts years of learned
    // behavior; announce it exactly once, ever.
    if (wasPlaying) {
      try {
        if (!localStorage.getItem('readest-tts-background-announced')) {
          localStorage.setItem('readest-tts-background-announced', '1');
          eventDispatcher.dispatch('toast', {
            message: _('Reading aloud continues in the background'),
            type: 'info',
            timeout: 3000,
          });
        }
      } catch {
        // localStorage unavailable: skip the announcement.
      }
    }
  }

  // Rebind bookkeeping after the reader adopts the session under a fresh
  // bookKey (attachView itself is the caller's responsibility).
  adopt(bookKey: string, meta: TTSSessionMeta): TTSSession | null {
    const session = this.getSessionByHash(getBookHashFromKey(bookKey));
    if (!session) return null;
    session.bookKey = bookKey;
    this.#meta = meta;
    void ttsMediaBridge.bind(session.controller, meta);
    return session;
  }

  async stopActive(reason: TTSSessionStopReason = 'user'): Promise<void> {
    const session = this.#session;
    if (!session || this.#stopping) return;
    this.#stopping = true;
    const meta = this.#meta;
    const wasDetached = !session.controller.isViewAttached;
    this.#session = null;
    this.#meta = null;
    this.#clearSleepTimer();
    this.#unsubscribe(session.controller);
    this.#flushLocation(session);

    // UI reconciliation first; teardown is best-effort and must not gate it
    // (native shutdown can stall — see #4676).
    eventDispatcher.dispatch('tts-playback-state', { bookKey: session.bookKey, state: 'stopped' });
    this.#emitSessionChanged('stopped');
    if (reason === 'replaced' || reason === 'deleted') {
      eventDispatcher.dispatch('toast', {
        message: `${_('Stopped reading aloud')}: ${meta?.title ?? ''}`,
        type: 'info',
        timeout: 3000,
      });
    } else if (reason === 'error' && wasDetached) {
      eventDispatcher.dispatch('toast', {
        message: `${_('Read aloud stopped')}: ${meta?.title ?? ''}`,
        type: 'error',
        timeout: 5000,
      });
    }

    ttsMediaBridge.unbind();
    releaseUnblockAudio();
    await Promise.all([
      session.controller.shutdown().catch((err) => console.warn('TTS shutdown failed:', err)),
      invokeUseBackgroundAudio({ enabled: false }).catch(() => {}),
    ]);
    this.#stopping = false;
  }

  // Clear the slot without tearing the controller down (the caller already
  // ran the full stop path).
  release(bookHash: string): void {
    const session = this.getSessionByHash(bookHash);
    if (!session) return;
    this.#unsubscribe(session.controller);
    this.#clearSleepTimer();
    this.#session = null;
    this.#meta = null;
    this.#emitSessionChanged('released');
  }

  // Sleep timer lives here so a timer armed in the reader survives unmount
  // and can actually stop a background session (a hook-local timer would
  // fire into a dead closure and orphan the audio).
  setSleepTimer(seconds: number): void {
    this.#clearSleepTimer();
    if (seconds > 0) {
      this.#sleepTimeoutSec = seconds;
      this.#sleepFiresAt = Date.now() + seconds * 1000;
      this.#sleepTimer = setTimeout(() => {
        this.#sleepTimer = null;
        void this.stopActive('timeout');
      }, seconds * 1000);
    }
  }

  getSleepTimer(): { timeoutSec: number; firesAt: number } | null {
    return this.#sleepTimer
      ? { timeoutSec: this.#sleepTimeoutSec, firesAt: this.#sleepFiresAt }
      : null;
  }

  #clearSleepTimer(): void {
    if (this.#sleepTimer) {
      clearTimeout(this.#sleepTimer);
      this.#sleepTimer = null;
    }
    this.#sleepTimeoutSec = 0;
    this.#sleepFiresAt = 0;
  }

  #subscribe(controller: TTSController): void {
    this.#onStateChange = (e: Event) => {
      const { state } = (e as CustomEvent<{ state: string }>).detail;
      const session = this.#session;
      if (!session || session.controller !== controller) return;
      // 'stopped' is a TRANSIT value (every paragraph advance, chapter
      // transitions) — relaying it would flicker every follower and the
      // now-playing bar. Terminal stops arrive via tts-session-ended.
      let mapped: 'playing' | 'paused' | null = null;
      if (state === 'playing') mapped = 'playing';
      else if (state.includes('paused')) mapped = 'paused';
      if (!mapped || mapped === this.#lastRelayedState) return;
      this.#lastRelayedState = mapped;
      eventDispatcher.dispatch('tts-playback-state', { bookKey: session.bookKey, state: mapped });
    };
    this.#onSessionEnded = (e: Event) => {
      const { reason } = (e as CustomEvent<{ reason: 'ended' | 'error' }>).detail;
      void this.stopActive(reason);
    };
    this.#onHighlightMark = (e: Event) => {
      const { cfi } = (e as CustomEvent<{ cfi: string }>).detail;
      this.#persistLocation(cfi);
    };
    controller.addEventListener('tts-state-change', this.#onStateChange);
    controller.addEventListener('tts-session-ended', this.#onSessionEnded);
    controller.addEventListener('tts-highlight-mark', this.#onHighlightMark);
  }

  #unsubscribe(controller: TTSController): void {
    if (this.#onStateChange) {
      controller.removeEventListener('tts-state-change', this.#onStateChange);
    }
    if (this.#onSessionEnded) {
      controller.removeEventListener('tts-session-ended', this.#onSessionEnded);
    }
    if (this.#onHighlightMark) {
      controller.removeEventListener('tts-highlight-mark', this.#onHighlightMark);
    }
    this.#onStateChange = null;
    this.#onSessionEnded = null;
    this.#onHighlightMark = null;
  }

  // Headless position persistence goes through the book CONFIG on disk:
  // clearViewState deletes the view/progress store entries (their setters
  // no-op for a closed book) and a reopen reloads config from disk, so
  // store-only writes would be lost. While a view is attached the reader
  // hook persists via its own path.
  #persistLocation(cfi: string): void {
    const session = this.#session;
    if (!session || session.controller.isViewAttached) return;
    this.#pendingLocation = cfi;
    const { getConfig, setConfig } = useBookDataStore.getState();
    const config = getConfig(session.bookKey);
    setConfig(session.bookKey, {
      viewSettings: { ...(config?.viewSettings ?? {}), ttsLocation: cfi },
    });
    const now = Date.now();
    if (now - this.#lastPersistAt >= PERSIST_THROTTLE_MS) {
      this.#lastPersistAt = now;
      this.#saveToDisk(session);
    }
  }

  #flushLocation(session: TTSSession): void {
    if (this.#pendingLocation === null) return;
    this.#pendingLocation = null;
    this.#saveToDisk(session);
  }

  #saveToDisk(session: TTSSession): void {
    try {
      const { getConfig, saveConfig } = useBookDataStore.getState();
      const config = getConfig(session.bookKey);
      if (!config) return;
      const settings = useSettingsStore.getState().settings;
      void saveConfig(env, session.bookKey, config, settings);
    } catch (err) {
      console.warn('TTS headless persistence failed:', err);
    }
  }

  #emitSessionChanged(reason: 'claimed' | 'detached' | 'stopped' | 'released'): void {
    this.dispatchEvent(
      new CustomEvent('session-changed', { detail: { session: this.#session, reason } }),
    );
  }
}

export const ttsSessionManager = new TTSSessionManager();
