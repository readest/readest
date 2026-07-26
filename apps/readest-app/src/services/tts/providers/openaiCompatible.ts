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
  // Synthesized audio is the user's own output from their own configured
  // endpoint, so it may be persisted. This is what makes preload actually
  // preload (CachingProvider bypasses the store AND the in-flight dedup when
  // this is false, so every preloaded sentence was re-synthesized on play).
  readonly cacheable = true;

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
      const message = `OpenAI-compatible TTS failed (${response.status}): ${detail.slice(0, 200)}`;
      // 429 and 5xx are transient: a loaded local server or a rate-limited
      // hosted one must be retried, not silently skipped for that sentence.
      if (response.status === 429 || response.status >= 500) throw new Error(message);
      throw new SpeechSynthesisPermanentError(message);
    }
    return { audio: await response.arrayBuffer(), boundaries: [] as TTSWordBoundary[] };
  }
}
