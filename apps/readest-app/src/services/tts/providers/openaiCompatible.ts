// The user's own OpenAI-compatible speech services (OpenAI, Kokoro-FastAPI,
// SiliconFlow, LocalAI, ...) as one SpeechProvider: POST {baseUrl}/audio/speech
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

// Statuses that no later request can get past (bad key, wrong URL or model).
const FATAL_STATUSES = new Set([401, 403, 404]);
// Statuses worth retrying; any other 4xx is about this sentence.
const TRANSIENT_STATUSES = new Set([408, 409, 425, 429]);

export const customVoiceId = (serviceId: string, voice: string) => `${serviceId}:${voice}`;

const endpoint = (service: CustomTTSService, path: string) =>
  `${service.baseUrl.replace(/\/+$/, '')}${path}`;

const authHeaders = (service: CustomTTSService): Record<string, string> =>
  service.apiKey ? { Authorization: `Bearer ${service.apiKey}` } : {};

// `{ voices: [...] }` of names (Kokoro-FastAPI) or of `{ id, name }` objects.
const parseVoiceList = (body: unknown): string[] => {
  const list = (body as { voices?: unknown } | null)?.voices;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown) => {
    if (typeof item === 'string') return [item];
    const { id, name } = (item ?? {}) as { id?: unknown; name?: unknown };
    if (typeof id === 'string') return [id];
    return typeof name === 'string' ? [name] : [];
  });
};

// The voices a service offers, from GET {baseUrl}/audio/voices. OpenAI itself
// has no such endpoint, so a service that lists nothing gets its standard voices.
export const fetchServiceVoices = async (service: CustomTTSService): Promise<string[]> => {
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
  return OPENAI_TTS_VOICES;
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
        id: customVoiceId(service.id, voice),
        name: voice,
        lang: MULTILINGUAL_LANG,
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
    // Follow the caller's signal only while the request is in flight: tauriFetch
    // rejects unhandled when a finished request is aborted.
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await getAIFetch()(endpoint(service, '/audio/speech'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(service) },
        body: JSON.stringify({
          model: service.model,
          input: req.text,
          voice,
          response_format: 'mp3',
          ...(service.instructions ? { instructions: service.instructions } : {}),
        }),
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
      return { audio: await res.arrayBuffer(), boundaries: [] };
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
