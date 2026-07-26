import { BufferedTTSClient } from './BufferedTTSClient';
import { OpenAICompatibleSpeechProvider } from './providers/openaiCompatible';
import { BookTTSCacheStore, getTTSCacheConfig } from './providers/bookCacheStore';
import { CachingProvider } from './providers/cache';
import type { SpeechProvider } from './providers/types';
import type { TTSController } from './TTSController';
import type { AppService } from '@/types/system';
import type { TTSVoicesGroup } from './types';

export class OpenAICompatibleTTSClient extends BufferedTTSClient {
  constructor(controller?: TTSController, appService?: AppService | null) {
    const inner = new OpenAICompatibleSpeechProvider();
    let provider: SpeechProvider = inner;
    const cacheConfig = getTTSCacheConfig();
    if (appService && cacheConfig.enabled) {
      // Same per-book persistent cache the Edge client uses. Without this the
      // preload path is pure waste for this engine: #preload() discards the
      // audio bytes and keeps only durations, which is only useful because the
      // fetch populates the cache (and the in-flight dedup) that playback then
      // hits. Unwrapped, every preloaded sentence was synthesized twice — once
      // thrown away, once for real — which is what put a round trip of dead air
      // in front of each sentence. The book hash is the part of the key before
      // the first dash (see TTSSessionManager.getBookHashFromKey; inlined to
      // avoid a module cycle), resolved lazily because the controller gets its
      // bookKey after this constructor runs.
      const store = new BookTTSCacheStore(
        appService,
        () => controller?.bookKey?.split('-')[0] || null,
        cacheConfig.budgetMB * 1024 * 1024,
      );
      provider = new CachingProvider(inner, store);
    }
    super(provider, controller, appService);
  }

  // Compatible voice APIs often omit language metadata. Keep their advertised
  // voices visible in the normal picker rather than filtering them away.
  override async getVoices(_lang: string): Promise<TTSVoicesGroup[]> {
    const voices = await this.getAllVoices();
    return [
      {
        id: this.name,
        name: this.provider.label,
        voices,
        disabled: !this.initialized || voices.length === 0,
      },
    ];
  }
}
