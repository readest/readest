// Download/delete lifecycle for Piper voice model files. Separate from the
// existing ttsDownloadManager (that one pre-synthesizes book audio into the
// cache; this one fetches the ~60MB model+tokens pair a voice needs before
// it can synthesize anything at all). A thin wrapper over the Tauri plugin's
// download_voice/delete_voice commands plus its progress event channel.

import { addPluginListener, invoke, PluginListener } from '@tauri-apps/api/core';
import { PIPER_VOICE_CATALOG, PiperVoiceDescriptor, findPiperVoice } from './piperVoices';
import type { PiperSpeechProvider } from './piper';

export interface PiperDownloadProgress {
  id: string;
  bytesDownloaded: number;
  totalBytes: number;
  done: boolean;
  error?: string;
}

type ProgressListener = (progress: PiperDownloadProgress) => void;

export class PiperVoiceManager {
  #provider: PiperSpeechProvider;
  #listener: PluginListener | null = null;
  #subscribers = new Set<ProgressListener>();

  constructor(provider: PiperSpeechProvider) {
    this.#provider = provider;
  }

  // Idempotent: safe to call again (e.g. re-opening the settings panel) —
  // PiperSpeechProvider.init() just re-lists the plugin's on-disk voices.
  async init(): Promise<boolean> {
    await this.#ensureListener();
    return this.#provider.init();
  }

  get isAvailable(): boolean {
    return this.#provider.isAvailable;
  }

  isDownloaded(id: string): boolean {
    return this.#provider.isDownloaded(id);
  }

  async #ensureListener(): Promise<void> {
    if (this.#listener) return;
    this.#listener = await addPluginListener<PiperDownloadProgress>(
      'piper-tts',
      'download_progress',
      (event) => {
        if (event.done && !event.error) {
          this.#provider.markVoiceStatus(event.id, true);
        }
        this.#subscribers.forEach((cb) => cb(event));
      },
    );
  }

  onProgress(cb: ProgressListener): () => void {
    this.#subscribers.add(cb);
    return () => this.#subscribers.delete(cb);
  }

  listCatalog(): PiperVoiceDescriptor[] {
    return PIPER_VOICE_CATALOG;
  }

  async downloadVoice(id: string): Promise<void> {
    const voice = findPiperVoice(id);
    if (!voice) throw new Error(`Unknown Piper voice: ${id}`);
    await this.#ensureListener();
    await invoke('plugin:piper-tts|download_voice', {
      voice: {
        id: voice.id,
        name: voice.name,
        lang: voice.lang,
        quality: voice.quality,
        archiveUrl: voice.archiveUrl,
        sizeBytes: voice.sizeBytes,
      },
    });
    this.#provider.markVoiceStatus(id, true);
  }

  async cancelDownload(id: string): Promise<void> {
    await invoke('plugin:piper-tts|cancel_download', { id });
  }

  async deleteVoice(id: string): Promise<void> {
    await invoke('plugin:piper-tts|delete_voice', { id });
    this.#provider.markVoiceStatus(id, false);
  }
}
