import { AppService } from '@/types/system';
import { BufferedTTSClient } from './BufferedTTSClient';
import { BookTTSCacheStore, getTTSCacheConfig } from './providers/bookCacheStore';
import { CachingProvider } from './providers/cache';
import { PiperSpeechProvider } from './providers/piper';
import { PiperVoiceManager } from './providers/piperVoiceManager';
import { SpeechProvider } from './providers/types';
import { TTSController } from './TTSController';

// Everything engine-independent (scheduler, playout, word tracking, preload,
// gap control) lives in BufferedTTSClient, exactly like EdgeTTSClient; the
// only Piper-specific pieces are the SpeechProvider (raw WAV synthesis via
// the piper-tts plugin) and the voice download manager, since — unlike
// Edge's always-available cloud voices — a Piper voice has to be fetched
// onto the device before it can be selected at all.
export class PiperTTSClient extends BufferedTTSClient {
  #piperProvider: PiperSpeechProvider;
  #voiceManager: PiperVoiceManager;

  constructor(controller?: TTSController, appService?: AppService | null) {
    const piperProvider = new PiperSpeechProvider();
    let provider: SpeechProvider = piperProvider;
    const cacheConfig = getTTSCacheConfig();
    if (appService && cacheConfig.enabled) {
      const store = new BookTTSCacheStore(
        appService,
        () => controller?.bookKey?.split('-')[0] || null,
        cacheConfig.budgetMB * 1024 * 1024,
      );
      provider = new CachingProvider(piperProvider, store);
    }
    super(provider, controller, appService);
    this.#piperProvider = piperProvider;
    this.#voiceManager = new PiperVoiceManager(piperProvider);
  }

  override async init(): Promise<boolean> {
    const ok = await this.#piperProvider.init();
    this.voices = await this.#piperProvider.getAllVoices();
    this.initialized = ok;
    return ok;
  }

  // Exposed for a settings panel (voice download/delete UI): not part of
  // TTSClient, callers must narrow to PiperTTSClient to use it.
  get voiceManager(): PiperVoiceManager {
    return this.#voiceManager;
  }

  // Refresh the voice list after a download/delete completes, without a
  // full session restart.
  async refreshVoices(): Promise<void> {
    this.voices = await this.#piperProvider.getAllVoices();
  }
}
