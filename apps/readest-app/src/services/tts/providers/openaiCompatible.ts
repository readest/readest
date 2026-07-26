import type { TTSWordBoundary } from '@/libs/edgeTTS';
import { getAIFetch } from '@/services/ai/utils/httpFetch';
import {
  fetchOpenAICompatibleVoices,
  getOpenAICompatibleTTSConfig,
  normalizeOpenAIBaseUrl,
} from '../openAICompatibleTTS';
import type { TTSVoice } from '../types';
import {
  SpeechSynthesisPermanentError,
  type SpeechProvider,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult,
} from './types';

export class OpenAICompatibleSpeechProvider implements SpeechProvider {
  readonly id = 'openai-compatible-tts';
  readonly label = 'OpenAI-compatible TTS';
  readonly cacheable = false;

  async init(): Promise<boolean> {
    const config = getOpenAICompatibleTTSConfig();
    if (!normalizeOpenAIBaseUrl(config.baseUrl) || !config.apiKey || !config.model) return false;
    try {
      await this.getAllVoices();
      return true;
    } catch {
      return false;
    }
  }

  getAllVoices(): Promise<TTSVoice[]> {
    return fetchOpenAICompatibleVoices();
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    const config = getOpenAICompatibleTTSConfig();
    if (!normalizeOpenAIBaseUrl(config.baseUrl) || !config.apiKey || !config.model) {
      throw new SpeechSynthesisPermanentError('OpenAI-compatible TTS is not configured');
    }
    const response = await getAIFetch()(`${normalizeOpenAIBaseUrl(config.baseUrl)}/audio/speech`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        input: req.text,
        voice: req.voice,
        response_format: 'mp3',
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new SpeechSynthesisPermanentError(
        `OpenAI-compatible TTS failed (${response.status}): ${detail.slice(0, 200)}`,
      );
    }
    return { audio: await response.arrayBuffer(), boundaries: [] as TTSWordBoundary[] };
  }
}
