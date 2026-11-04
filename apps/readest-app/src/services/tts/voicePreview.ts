import { EdgeSpeechTTS } from '@/libs/edgeTTS';
import { isTauriAppPlatform } from '@/services/environment';
import type { CustomTTSService } from '@/types/customTTS';
import { getAccessToken } from '@/utils/access';
import { NativeTTSClient } from './NativeTTSClient';
import {
  CUSTOM_TTS_PROVIDER_ID,
  OpenAICompatibleSpeechProvider,
} from './providers/openaiCompatible';
import { fetchReadestVoicePreview } from './providers/readest';
import { asTTSController, ttsSessionManager } from './TTSSessionManager';

// Voice previews: a short passage spoken by one voice, straight from its
// engine, outside any reading session. Synthetic engines play through one
// audio element of their own, so a paused session's player is never touched;
// system voices speak through their engine, which is why a reading session is
// stopped first (suspendReadingForPreview).

export interface VoicePreview {
  // The client name the voice belongs to (TTSVoicesGroup.engine).
  engine: string;
  voiceId: string;
  // The language the text is in.
  lang: string;
  text: string;
}

export const READEST_TTS_ENGINE = 'readest-tts';
const EDGE_TTS_ENGINE = 'edge-tts';
const WEB_SPEECH_ENGINE = 'web-speech';
const NATIVE_TTS_ENGINE = 'native-tts';

const PREVIEW_ENGINES = new Set([
  EDGE_TTS_ENGINE,
  READEST_TTS_ENGINE,
  CUSTOM_TTS_PROVIDER_ID,
  WEB_SPEECH_ENGINE,
  NATIVE_TTS_ENGINE,
]);

// Recorded narration has no voice to preview: it is the book's own audio.
export const canPreviewEngine = (engine: string | undefined): boolean =>
  !!engine && PREVIEW_ENGINES.has(engine);

let audio: HTMLAudioElement | null = null;
let silenceUrl: string | null = null;

// 0.1 s of silence: playing it inside the tap unlocks the element, so the
// preview may start once synthesis returns, after the tap's activation has
// expired (Safari, Android WebView). WebKit fails to decode a shorter WAV.
const getSilenceUrl = () => {
  if (silenceUrl) return silenceUrl;
  const samples = 800; // 8 kHz, 8-bit mono
  const view = new DataView(new ArrayBuffer(44 + samples));
  const ascii = (at: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  new Uint8Array(view.buffer, 44).fill(0x80);
  silenceUrl = URL.createObjectURL(new Blob([view.buffer], { type: 'audio/wav' }));
  return silenceUrl;
};

// Call synchronously from the tap that starts a preview.
export const primeVoicePreview = () => {
  if (typeof Audio === 'undefined') return;
  audio ??= new Audio();
  audio.src = getSilenceUrl();
  audio.play().catch(() => {});
};

// Stops the reading session if it is playing; true when it was.
export const suspendReadingForPreview = async (): Promise<boolean> => {
  const controller = asTTSController(ttsSessionManager.getActiveSession()?.controller);
  if (controller?.state !== 'playing') return false;
  await controller.suspend();
  return true;
};

const audioType = (data: ArrayBuffer) => {
  const magic = String.fromCharCode(...new Uint8Array(data.slice(0, 4)));
  return magic === 'RIFF' ? 'audio/wav' : magic === 'OggS' ? 'audio/ogg' : 'audio/mpeg';
};

const playAudio = (data: ArrayBuffer, signal: AbortSignal, onStart: () => void) =>
  new Promise<void>((resolve, reject) => {
    const element = (audio ??= new Audio());
    const url = URL.createObjectURL(new Blob([data], { type: audioType(data) }));
    const done = (error?: unknown) => {
      element.onplaying = element.onended = element.onerror = null;
      signal.removeEventListener('abort', onAbort);
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      element.pause();
      done();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    element.onplaying = onStart;
    element.onended = () => done();
    element.onerror = () => done(new Error('PLAYBACK_FAILED'));
    element.src = url;
    element.play().catch((error) => {
      if (!signal.aborted) done(error);
    });
  });

// The free wss transport is blocked on some networks; signed-in web readers
// fall back to the proxy route, as reading does (EdgeTTSClient.init).
const synthesizeEdge = async ({ voiceId, lang, text }: VoicePreview) => {
  const payload = { lang, text, voice: voiceId, rate: 1, pitch: 1 };
  try {
    return (await new EdgeSpeechTTS('wss').createAudioData(payload)).data;
  } catch (error) {
    if (isTauriAppPlatform()) throw error;
    if (!(await getAccessToken())) throw new Error('NOT_AUTHENTICATED');
    return (await new EdgeSpeechTTS('https').createAudioData(payload)).data;
  }
};

// Held while speaking: Chrome may collect an utterance mid-speech and never
// fire its end.
let utterance: SpeechSynthesisUtterance | null = null;

const speakWebSpeech = ({ voiceId, lang, text }: VoicePreview, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const synth = window.speechSynthesis;
    const voice = synth.getVoices().find((v) => (v.voiceURI || v.name) === voiceId);
    const current = new SpeechSynthesisUtterance(text);
    if (voice) current.voice = voice;
    current.lang = voice?.lang ?? lang;
    const onAbort = () => synth.cancel();
    const done = (error?: Error) => {
      signal.removeEventListener('abort', onAbort);
      if (utterance === current) utterance = null;
      if (error) reject(error);
      else resolve();
    };
    current.onend = () => done();
    current.onerror = (event) =>
      done(['interrupted', 'canceled'].includes(event.error) ? undefined : new Error(event.error));
    signal.addEventListener('abort', onAbort, { once: true });
    utterance = current;
    synth.cancel();
    synth.speak(current);
  });

let nativeClient: NativeTTSClient | null = null;

// The reading session's client when there is one: initializing a second
// client would restart the system engine under it.
export const getNativeClient = (): NativeTTSClient => {
  const controller = asTTSController(ttsSessionManager.getActiveSession()?.controller);
  const sessionClient = controller?.ttsNativeClient;
  if (sessionClient instanceof NativeTTSClient && sessionClient.initialized) return sessionClient;
  return (nativeClient ??= new NativeTTSClient());
};

// Plays the preview until it ends or `signal` aborts, calling `onStart` as it
// becomes audible; throws the engine's error (for Readest Voice, the route's
// code, e.g. DAILY_QUOTA_EXCEEDED).
export const playVoicePreview = async (
  preview: VoicePreview,
  signal: AbortSignal,
  {
    onStart = () => {},
    customServices = () => [],
  }: { onStart?: () => void; customServices?: () => CustomTTSService[] } = {},
): Promise<void> => {
  const { engine, voiceId, lang, text } = preview;
  if (engine === WEB_SPEECH_ENGINE) {
    onStart();
    return speakWebSpeech(preview, signal);
  }
  if (engine === NATIVE_TTS_ENGINE) {
    onStart();
    return getNativeClient().preview(voiceId, text, lang, signal);
  }
  let data: ArrayBuffer;
  if (engine === EDGE_TTS_ENGINE) {
    data = await synthesizeEdge(preview);
  } else if (engine === READEST_TTS_ENGINE) {
    data = await fetchReadestVoicePreview({ text, voice: voiceId, lang }, signal);
  } else if (engine === CUSTOM_TTS_PROVIDER_ID) {
    const provider = new OpenAICompatibleSpeechProvider(customServices, async () => true);
    data = (await provider.synthesize({ lang, text, voice: voiceId, pitch: 1 }, signal)).audio;
  } else {
    throw new Error(`No preview for ${engine}`);
  }
  if (signal.aborted) return;
  await playAudio(data, signal, onStart);
};
