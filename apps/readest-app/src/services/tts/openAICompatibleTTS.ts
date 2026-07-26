import { getAIFetch } from '@/services/ai/utils/httpFetch';
import type { TTSVoice } from './types';

export type OpenAICompatibleTTSConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const STORAGE_KEY = 'readest-openai-compatible-tts';
const emptyConfig: OpenAICompatibleTTSConfig = { baseUrl: '', apiKey: '', model: '' };

export function getOpenAICompatibleTTSConfig(): OpenAICompatibleTTSConfig {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { ...emptyConfig, ...parsed };
  } catch {
    return emptyConfig;
  }
}

export function setOpenAICompatibleTTSConfig(config: OpenAICompatibleTTSConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function normalizeOpenAIBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

async function request(config: OpenAICompatibleTTSConfig, path: string): Promise<Response> {
  return getAIFetch()(`${normalizeOpenAIBaseUrl(config.baseUrl)}${path}`, {
    headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
  });
}

export async function fetchOpenAICompatibleModels(
  config = getOpenAICompatibleTTSConfig(),
): Promise<string[]> {
  if (!normalizeOpenAIBaseUrl(config.baseUrl) || !config.apiKey) return [];
  const response = await request(config, '/models');
  if (!response.ok) throw new Error(`Could not load models (${response.status})`);
  const body = (await response.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).flatMap((model) => (typeof model.id === 'string' ? [model.id] : []));
}

// OpenAI-compatible servers commonly expose either /audio/voices or /voices.
// There is no voice-list endpoint in OpenAI's public spec, so deliberately do
// not invent a list: a server must advertise voices for them to be selectable.
export async function fetchOpenAICompatibleVoices(
  config = getOpenAICompatibleTTSConfig(),
): Promise<TTSVoice[]> {
  if (!normalizeOpenAIBaseUrl(config.baseUrl) || !config.apiKey) return [];
  for (const path of ['/audio/voices', '/voices']) {
    const response = await request(config, path);
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`Could not load voices (${response.status})`);
    const body = (await response.json()) as {
      data?: Array<{ id?: string; name?: string; language?: string; lang?: string }>;
      voices?: Array<{ id?: string; name?: string; language?: string; lang?: string }>;
    };
    return (body.data ?? body.voices ?? []).flatMap((voice) => {
      if (!voice.id) return [];
      return [
        { id: voice.id, name: voice.name ?? voice.id, lang: voice.language ?? voice.lang ?? 'und' },
      ];
    });
  }
  return [];
}
