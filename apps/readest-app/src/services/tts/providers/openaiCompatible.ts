// The user's own speech services (OpenAI, Kokoro-FastAPI, SiliconFlow,
// LocalAI, Xiaomi MiMo, ...) as one SpeechProvider. OpenAI-compatible
// services use POST {baseUrl}/audio/speech; Xiaomi MiMo uses chat completions
// with their key, straight from the device. Every configured service lives
// behind this one provider; a voice id is `<service id>:<voice>`, so a request
// routes to the service the picked voice belongs to. These APIs return no word
// timings, so highlighting stays at sentence granularity.

import { getAIFetch } from '@/services/ai/utils/httpFetch';
import type { CustomTTSService } from '@/types/customTTS';
import { MULTILINGUAL_LANG, type TTSVoice, type TTSVoicesGroup } from '../types';
import {
  type SpeechProvider,
  SpeechSynthesisFatalError,
  SpeechSynthesisPermanentError,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult,
} from './types';

export const CUSTOM_TTS_PROVIDER_ID = 'custom-tts';

export const OPENAI_TTS_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
];

// How long a service gets to list its voices before the standard names stand in.
const VOICE_LIST_TIMEOUT_MS = 5000;

// Xiaomi MiMo has no /audio/voices endpoint; its preset voices are fixed.
// https://github.com/XiaomiMiMo/MiMo-Skills/tree/main/skills/mimo-v2-5-tts
const MIMO_VOICES: ListedVoice[] = [
  ...['冰糖', '茉莉', '苏打', '白桦'].map((name) => ({ name, lang: 'zh-CN' })),
  ...['Mia', 'Chloe', 'Milo', 'Dean'].map((name) => ({ name, lang: 'en-US' })),
];

// MiMo serves speech only from chat completions, so any service on its host
// (whatever the model) uses them; a proxy elsewhere keeps the OpenAI route.
const isMiMoService = (service: CustomTTSService): boolean => {
  try {
    return /(^|\.)xiaomimimo\.com$/.test(new URL(service.baseUrl).hostname);
  } catch {
    return false;
  }
};

// Statuses that no later request can get past (bad key, wrong URL or model).
const FATAL_STATUSES = new Set([401, 403, 404]);
// Statuses worth retrying; any other 4xx is about this sentence.
const TRANSIENT_STATUSES = new Set([408, 409, 425, 429]);

export const customVoiceId = (serviceId: string, voice: string) => `${serviceId}:${voice}`;

// A base URL pasted with the endpoint on it (`…/v1/audio/speech`) works too.
const endpoint = (service: CustomTTSService, path: string) =>
  `${service.baseUrl.replace(/(\/audio\/(speech|voices))?\/*$/, '')}${path}`;

// MiMo's endpoint is known, so the path typed into its base URL is ignored.
export const speechEndpoint = (service: CustomTTSService) =>
  isMiMoService(service)
    ? new URL('/v1/chat/completions', service.baseUrl).href
    : endpoint(service, '/audio/speech');

const authHeaders = (service: CustomTTSService): Record<string, string> =>
  service.apiKey ? { Authorization: `Bearer ${service.apiKey}` } : {};

interface ListedVoice {
  name: string;
  lang?: string;
}

// Kokoro names a voice by language and gender (`zf_xiaobei`: Mandarin, female).
const KOKORO_LANGS: Record<string, string> = {
  a: 'en-US',
  b: 'en-GB',
  e: 'es-ES',
  f: 'fr-FR',
  h: 'hi-IN',
  i: 'it-IT',
  j: 'ja-JP',
  p: 'pt-BR',
  z: 'zh-CN',
};

// A voice's language: the one the service states, else the one a Kokoro name
// carries, else any (OpenAI's voices speak every language).
const voiceLang = ({ name, lang }: ListedVoice): string =>
  lang ?? (/^[a-z][fm]_/.test(name) ? KOKORO_LANGS[name[0]!] : undefined) ?? MULTILINGUAL_LANG;

// `{ voices: [...] }` of names (Kokoro-FastAPI) or of `{ id, name, lang }`
// objects (`language` also read).
const parseVoiceList = (body: unknown): ListedVoice[] => {
  const list = (body as { voices?: unknown } | null)?.voices;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown) => {
    if (typeof item === 'string') return [{ name: item }];
    const { id, name, lang, language } = (item ?? {}) as Record<string, unknown>;
    const voice = typeof id === 'string' ? id : typeof name === 'string' ? name : null;
    if (!voice) return [];
    const stated = typeof lang === 'string' ? lang : typeof language === 'string' ? language : '';
    return [stated ? { name: voice, lang: stated } : { name: voice }];
  });
};

// The voices a service offers, from GET {baseUrl}/audio/voices. OpenAI itself
// has no such endpoint, so a service that lists nothing gets its standard voices.
const fetchServiceVoices = async (service: CustomTTSService): Promise<ListedVoice[]> => {
  if (isMiMoService(service)) return MIMO_VOICES;
  // A timer rather than AbortSignal.timeout: tauriFetch rejects unhandled when
  // a finished request is aborted.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_LIST_TIMEOUT_MS);
  try {
    const res = await getAIFetch()(endpoint(service, '/audio/voices'), {
      headers: authHeaders(service),
      signal: controller.signal,
    });
    const voices = res.ok ? parseVoiceList(await res.json()) : [];
    if (voices.length) return voices;
  } catch {
    // Unreachable or not JSON: fall through to the standard voices.
  } finally {
    clearTimeout(timer);
  }
  return OPENAI_TTS_VOICES.map((name) => ({ name }));
};

// MiMo chat completions wraps the generated MP3 in a Base64 audio.data field.
const decodeMiMoAudio = async (res: Response): Promise<ArrayBuffer> => {
  const body = (await res.json()) as {
    choices?: { message?: { audio?: { data?: unknown } } }[];
  };
  const data = body.choices?.[0]?.message?.audio?.data;
  const binary = atob(typeof data === 'string' ? data : '');
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (!bytes.length) throw new Error('MiMo returned no audio data');
  return bytes.buffer;
};

const abortError = () => new DOMException('Aborted', 'AbortError');

export class OpenAICompatibleSpeechProvider implements SpeechProvider {
  readonly id = CUSTOM_TTS_PROVIDER_ID;
  readonly label = 'Custom TTS';
  readonly cacheable = true;

  // `getServices`: the enabled services, read on every call so edits apply
  // without restarting Read Aloud. `isAllowed`: the premium gate.
  constructor(
    readonly getServices: () => CustomTTSService[],
    private readonly isAllowed: () => Promise<boolean>,
  ) {}

  async init(): Promise<boolean> {
    return this.getServices().length > 0 && (await this.isAllowed());
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    if (!(await this.init())) return [];
    const services = this.getServices();
    const lists = await Promise.all(services.map(fetchServiceVoices));
    return services.flatMap((service, i) =>
      lists[i]!.map((voice) => ({
        id: customVoiceId(service.id, voice.name),
        name: voice.name,
        lang: voiceLang(voice),
      })),
    );
  }

  groupVoices(voices: TTSVoice[]): Omit<TTSVoicesGroup, 'disabled'>[] {
    return this.getServices().map((service) => ({
      id: `${this.id}:${service.id}`,
      name: service.name,
      voices: voices.filter((voice) => voice.id.startsWith(`${service.id}:`)),
    }));
  }

  cacheScope(req: SpeechSynthesisRequest): string {
    const service = this.#resolve(req.voice)?.service;
    return JSON.stringify([service?.baseUrl, service?.model, service?.instructions]);
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    const resolved = this.#resolve(req.voice);
    if (!resolved) throw new SpeechSynthesisPermanentError(`Unknown voice: ${req.voice}`);
    if (signal.aborted) throw abortError();
    const { service, voice } = resolved;
    const isMiMo = isMiMoService(service);
    // Follow the caller's signal only while the request is in flight: tauriFetch
    // rejects unhandled when a finished request is aborted.
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const body = isMiMo
        ? {
            model: service.model,
            messages: [
              ...(service.instructions ? [{ role: 'user', content: service.instructions }] : []),
              { role: 'assistant', content: req.text },
            ],
            audio: { format: 'mp3', voice },
          }
        : {
            model: service.model,
            input: req.text,
            voice,
            response_format: 'mp3',
            ...(service.instructions ? { instructions: service.instructions } : {}),
          };
      const res = await getAIFetch()(speechEndpoint(service), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(service) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        const message = `${service.name}: HTTP ${res.status}${detail ? ` ${detail}` : ''}`;
        if (FATAL_STATUSES.has(res.status)) throw new SpeechSynthesisFatalError(message);
        if (res.status < 500 && !TRANSIENT_STATUSES.has(res.status)) {
          throw new SpeechSynthesisPermanentError(message);
        }
        throw new Error(message);
      }
      const audio = isMiMo ? await decodeMiMoAudio(res) : await res.arrayBuffer();
      return { audio, boundaries: [] };
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  #resolve(voiceId: string): { service: CustomTTSService; voice: string } | null {
    const sep = voiceId.indexOf(':');
    if (sep < 0) return null;
    const service = this.getServices().find((s) => s.id === voiceId.slice(0, sep));
    return service ? { service, voice: voiceId.slice(sep + 1) } : null;
  }
}
