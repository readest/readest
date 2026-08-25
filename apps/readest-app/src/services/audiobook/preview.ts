import { convertFileSrc } from '@tauri-apps/api/core';

import type { AppService, BaseDir } from '@/types/system';
import { NativeNarrationPlayer } from '@/services/tts/mediaOverlay/NativeNarrationPlayer';

const PREVIEW_SECONDS = 15;

export interface AudiobookPreviewClip {
  id: string;
  file?: File;
  path?: string;
  base?: BaseDir;
  /** A streamable URL (an Audiobookshelf track); `start` is then in-file seconds. */
  url?: string;
  start: number;
  end: number;
}

type ClosablePreviewFile = File & { close?: () => Promise<void> };

export class AudiobookPreviewPlayer {
  #appService: AppService;
  #onStopped: (id: string) => void;
  #activeId: string | null = null;
  #audio: HTMLAudioElement | null = null;
  #nativePlayer: NativeNarrationPlayer | null = null;
  #objectUrl: string | null = null;
  #ownedFile: ClosablePreviewFile | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #endedListener: (() => void) | null = null;
  #transition = Promise.resolve();

  constructor(appService: AppService, onStopped: (id: string) => void) {
    this.#appService = appService;
    this.#onStopped = onStopped;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.#transition.then(operation);
    this.#transition = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  toggle(clip: AudiobookPreviewClip): Promise<boolean> {
    return this.#enqueue(() => this.#toggle(clip));
  }

  async #toggle(clip: AudiobookPreviewClip): Promise<boolean> {
    if (this.#activeId === clip.id) {
      await this.#stop();
      return false;
    }
    await this.#stop();

    this.#activeId = clip.id;
    try {
      const mobileNative = this.#appService.appPlatform === 'tauri' && this.#appService.isMobileApp;
      if (mobileNative && (clip.url || clip.path)) {
        this.#nativePlayer ??= new NativeNarrationPlayer();
        const path =
          clip.url ?? (await this.#appService.resolveFilePath(clip.path!, clip.base ?? 'None'));
        await this.#nativePlayer.loadPath(clip.id, path, clip.start);
        await this.#nativePlayer.play();
      } else {
        const audio = new Audio();
        let url: string;
        if (clip.url) {
          url = clip.url;
        } else if (this.#appService.appPlatform === 'tauri' && clip.path) {
          const path = await this.#appService.resolveFilePath(clip.path, clip.base ?? 'None');
          url = convertFileSrc(path);
        } else {
          let file = clip.file;
          if (!file && clip.path) {
            file = await this.#appService.openFile(clip.path, clip.base ?? 'None');
            this.#ownedFile = file as ClosablePreviewFile;
          }
          if (!file) throw new Error('Audiobook preview source is unavailable');
          url = URL.createObjectURL(file);
          this.#objectUrl = url;
        }
        audio.src = url;
        audio.currentTime = clip.start;
        this.#endedListener = () => void this.stop();
        audio.addEventListener('ended', this.#endedListener);
        this.#audio = audio;
        await audio.play();
      }

      const duration = Math.min(PREVIEW_SECONDS, Math.max(0, clip.end - clip.start));
      if (duration > 0) {
        this.#timer = setTimeout(() => void this.stop(), duration * 1000);
      }
      return true;
    } catch (error) {
      await this.#stop();
      throw error;
    }
  }

  stop(): Promise<void> {
    return this.#enqueue(() => this.#stop());
  }

  async #stop(): Promise<void> {
    const stoppedId = this.#activeId;
    this.#activeId = null;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const nativePlayer = this.#nativePlayer;
    this.#nativePlayer = null;
    await nativePlayer?.shutdown();
    if (this.#audio) {
      this.#audio.pause();
      if (this.#endedListener) this.#audio.removeEventListener('ended', this.#endedListener);
    }
    this.#audio = null;
    this.#endedListener = null;
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#objectUrl = null;
    if (this.#ownedFile?.close) await this.#ownedFile.close().catch(() => undefined);
    this.#ownedFile = null;
    if (stoppedId) this.#onStopped(stoppedId);
  }

  async dispose(): Promise<void> {
    await this.stop();
  }
}
