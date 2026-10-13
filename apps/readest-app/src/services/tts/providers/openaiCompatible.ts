// The user's own OpenAI-compatible speech services (OpenAI, Kokoro-FastAPI,
// SiliconFlow, LocalAI, ...) as one SpeechProvider: POST {baseUrl}/audio/speech
// with their key, straight from the device. Every configured service lives
// behind this one provider; a voice id is `<service id>:<voice>`, so a request
// routes to the service the picked voice belongs to. These APIs return no word
// timings, so highlighting stays at sentence granularity.

import { getAIFetch } from '@/services/ai/utils/httpFetch';
import type { CustomTTSService } from '@/types/customTTS';
import type { TTSVoice, TTSVoicesGroup } from '../types';
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

// Statuses that no later request can get past (bad key, wrong URL or model).
const FATAL_STATUSES = new Set([401, 403, 404]);
// Statuses worth retrying; any other 4xx is about this sentence.
const TRANSIENT_STATUSES = new Set([408, 409, 425, 429]);

export const customVoiceId = (serviceId: string, voice: string) => `${serviceId}:${voice}`;

export const getServiceVoices = (service: CustomTTSService): string[] =>
  service.voices?.length ? service.voices : OPENAI_TTS_VOICES;

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
    // The services are multilingual: a voice carries no language.
    return this.getServices().flatMap((service) =>
      getServiceVoices(service).map((voice) => ({
        id: customVoiceId(service.id, voice),
        name: voice,
        lang: '',
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
      const res = await getAIFetch()(`${service.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(service.apiKey ? { Authorization: `Bearer ${service.apiKey}` } : {}),
        },
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
