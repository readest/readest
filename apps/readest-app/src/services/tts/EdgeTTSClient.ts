import { EDGE_TTS_PROTOCOL } from '@/libs/edgeTTS';
import { isTauriAppPlatform } from '@/services/environment';
import { AppService } from '@/types/system';
import { BufferedTTSClient } from './BufferedTTSClient';
import { BookTTSCacheStore, getTTSCacheConfig } from './providers/bookCacheStore';
import { CachingProvider } from './providers/cache';
import { EdgeSpeechProvider } from './providers/edge';
import { SpeechProvider } from './providers/types';
import { TTSController } from './TTSController';

// Everything engine-independent (scheduler, playout, word tracking, preload)
// lives in BufferedTTSClient; the Edge specifics live in EdgeSpeechProvider.
// This subclass keeps the persisted 'edge-tts' client name and owns the one
// policy that needs app context: the wss -> https transport fallback, which
// depends on the user's auth state.
export { DEFAULT_SENTENCE_GAP_SEC } from './BufferedTTSClient';

export class EdgeTTSClient extends BufferedTTSClient {
  #edgeProvider: EdgeSpeechProvider;

  constructor(controller?: TTSController, appService?: AppService | null) {
    const edgeProvider = new EdgeSpeechProvider();
    let provider: SpeechProvider = edgeProvider;
    const cacheConfig = getTTSCacheConfig();
    if (appService && cacheConfig.enabled) {
      // Per-book persistent cache on every platform: appService.openDatabase
      // rides tauri-plugin-turso natively and turso WASM over OPFS on the
      // web. The book key lands on the controller in init(), after this
      // constructor, hence the lazy resolver — the hash is the part of the
      // key before the first dash (see TTSSessionManager.getBookHashFromKey;
      // inlined to avoid a module cycle through the session manager).
      const store = new BookTTSCacheStore(
        appService,
        () => controller?.bookKey?.split('-')[0] || null,
        cacheConfig.budgetMB * 1024 * 1024,
      );
      provider = new CachingProvider(edgeProvider, store);
    }
    super(provider, controller, appService);
    this.#edgeProvider = edgeProvider;
  }

  override async init(_protocol: EDGE_TTS_PROTOCOL = 'wss'): Promise<boolean> {
    this.voices = await this.#edgeProvider.getAllVoices();
    // The free wss transport is intermittently blocked in browsers;
    // authenticated users fall back to the https proxy route. On Tauri the
    // native WebSocket (with full headers) is the only Edge transport — a
    // failure there means offline or Edge itself is down, so never fall back
    // to the proxy, which would fire cross-origin /api/tts/edge requests.
    if (await this.#edgeProvider.init('wss')) {
      this.initialized = true;
      return true;
    }
    if (
      !isTauriAppPlatform() &&
      this.controller?.isAuthenticated &&
      (await this.#edgeProvider.init('https'))
    ) {
      this.initialized = true;
      return true;
    }
    // Every probe failed: blocked, or offline. With a persistent cache a
    // pre-downloaded book still plays (hits play, misses skip via the
    // provider's permanent error), so init as cache-only rather than fail —
    // and do NOT nag a signed-out user with a warm cache to sign in.
    if (this.provider instanceof CachingProvider) {
      this.initialized = true;
      return true;
    }
    if (!this.controller?.isAuthenticated) {
      this.controller?.dispatchEvent(new CustomEvent('tts-need-auth'));
    }
    this.initialized = false;
    return false;
  }
}
