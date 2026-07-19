import { AppService } from '@/types/system';
import { EdgeSpeechTTS, EdgeTTSPayload } from '@/libs/edgeTTS';
import { isTauriAppPlatform } from '@/services/environment';
import { isSameLang } from '@/utils/lang';
import { genSSMLRaw } from '@/utils/ssml';
import { TTSClient } from './TTSClient';
import { TTSUtils } from './TTSUtils';
import { NativeTTSClient } from './NativeTTSClient';
import { WebSpeechClient } from './WebSpeechClient';
import { WebAudioPlayer } from './WebAudioPlayer';
import type { TTSAudioContext } from './WebAudioPlayer';

// Speaks a single dictionary word as fast as possible. Unlike the reader's
// TTSController, this never runs EdgeTTSClient.init() (which wastes a round
// trip synthesizing "test") and never spins up a full speaking session — it
// calls EdgeSpeechTTS directly (whose static MP3 cache makes repeat words
// instant) and schedules one chunk on a dedicated Web Audio context. Edge is
// tried first while online (wss, then the authenticated https proxy); offline
// requests and Edge failures use the platform speech client. See issue #4876.

const EDGE_TTS_NAME = 'edge-tts';
const DEFAULT_EDGE_VOICE = 'en-US-AriaNeural';

export type PronounceStatus = 'playing' | 'ended' | 'error';

export interface PronounceWordOptions {
  appService?: AppService | null;
}

// Choose an Edge voice for a language: the user's preferred Edge voice for that
// language (as picked in TTS settings) when it exists, else the first voice
// whose locale matches, else a safe English default.
export const pickEdgeVoiceId = (lang: string): string => {
  const preferred = TTSUtils.getPreferredVoice(EDGE_TTS_NAME, lang);
  const voices = EdgeSpeechTTS.voices;
  if (preferred && voices.some((v) => v.id === preferred)) return preferred;
  const match = voices.find((v) => isSameLang(v.lang, lang));
  return match?.id ?? DEFAULT_EDGE_VOICE;
};

// A dedicated context, isolated from the reader's shared-context TTS so
// pronouncing a word can never resume/suspend or overlap an active read-aloud
// session. Created lazily on first use inside a user gesture (see warmWordAudio).
let dedicatedPlayer: WebAudioPlayer | null = null;
const getPlayer = (): WebAudioPlayer | null => {
  if (typeof AudioContext === 'undefined') return null;
  if (!dedicatedPlayer) {
    dedicatedPlayer = new WebAudioPlayer(() => new AudioContext() as unknown as TTSAudioContext);
  }
  return dedicatedPlayer;
};

// Reused across calls; EdgeSpeechTTS keeps its MP3/boundary caches on static
// members, so this just avoids per-call allocation.
const edgeWss = new EdgeSpeechTTS('wss');
const edgeHttps = new EdgeSpeechTTS('https');

// Bumped on every new request so a slower in-flight synth/fetch can detect it
// has been superseded and bail before touching the player or status.
let requestToken = 0;
let fallbackAbort: AbortController | null = null;
let fallbackClient: TTSClient | null = null;

const stopFallback = (): void => {
  fallbackAbort?.abort();
  fallbackAbort = null;
  const client = fallbackClient;
  fallbackClient = null;
  if (client) void client.shutdown().catch(() => {});
};

// Warm (create + resume) the dedicated audio context. MUST be called
// synchronously from the click handler: pronounceWord resumes the context only
// after a network await, outside WebKit's user-gesture window, where resume()
// is rejected by autoplay policy.
export const warmWordAudio = (): void => {
  const player = getPlayer();
  if (player) void player.ensureContext().catch(() => {});
};

export const cancelWordPronounce = (): void => {
  requestToken++;
  getPlayer()?.abortSession();
  stopFallback();
};

// Edge audio bytes: direct wss first; on failure the authenticated https proxy
// (the reader's own fallback for browsers that block Bing). The proxy throws
// "Not authenticated" when logged out, which propagates to the speech fallback.
// On Tauri the native wss transport is the only Edge path — never retry via
// the proxy (a cross-origin /api/tts/edge request, e.g. fired when offline).
const fetchEdgeAudio = async (payload: EdgeTTSPayload): Promise<ArrayBuffer> => {
  try {
    return (await edgeWss.createAudioData(payload)).data;
  } catch (err) {
    if (isTauriAppPlatform()) throw err;
    return (await edgeHttps.createAudioData(payload)).data;
  }
};

const speakViaFallback = async (
  word: string,
  lang: string,
  options: PronounceWordOptions,
  token: number,
  emit: (status: PronounceStatus) => void,
): Promise<void> => {
  // Web Speech is the reader's built-in engine on desktop/web; on the mobile
  // app the native TTS plugin is what actually produces audio.
  const client: TTSClient = options.appService?.isMobile
    ? new NativeTTSClient()
    : new WebSpeechClient();
  fallbackClient = client;
  const controller = new AbortController();
  fallbackAbort = controller;
  try {
    const ready = await client.init();
    if (!ready || token !== requestToken) {
      emit('error');
      return;
    }
    client.setPrimaryLang(lang);
    emit('playing');
    for await (const ev of client.speak(genSSMLRaw(word), controller.signal)) {
      if (ev.code === 'error') {
        emit('error');
        return;
      }
    }
    emit('ended');
  } catch {
    emit('error');
  } finally {
    if (fallbackClient === client) fallbackClient = null;
    if (fallbackAbort === controller) fallbackAbort = null;
    void client.shutdown().catch(() => {});
  }
};

export const pronounceWord = async (
  word: string,
  lang: string | undefined,
  options: PronounceWordOptions,
  onStatus?: (status: PronounceStatus) => void,
): Promise<void> => {
  const token = ++requestToken;
  const emit = (status: PronounceStatus) => {
    if (token === requestToken) onStatus?.(status);
  };

  const trimmed = word.trim();
  if (!trimmed) {
    emit('ended');
    return;
  }
  const voiceLang = lang && lang.length ? lang : 'en';

  // Stop whatever is currently playing (Edge session or fallback client).
  getPlayer()?.abortSession();
  stopFallback();

  const player = getPlayer();
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (player && !isOffline) {
    try {
      const voice = pickEdgeVoiceId(voiceLang);
      const data = await fetchEdgeAudio({
        lang: voiceLang,
        text: trimmed,
        voice,
        rate: 1.0,
        pitch: 1.0,
      });
      if (token !== requestToken) return;
      const buffer = await player.decode(data);
      if (token !== requestToken) return;
      const generation = player.startSession((event) => {
        if (event.type === 'session-end') emit('ended');
        else if (event.type === 'context-error') emit('error');
      });
      player.scheduleChunk(generation, buffer, { trimStartSec: 0, mediaScale: 1, gapSec: 0 });
      player.endSession(generation);
      emit('playing');
      return;
    } catch (err) {
      if (token !== requestToken) return;
      console.warn('[dict-tts] Edge pronunciation failed, falling back', err);
    }
  }

  if (token !== requestToken) return;
  await speakViaFallback(trimmed, voiceLang, options, token, emit);
};
