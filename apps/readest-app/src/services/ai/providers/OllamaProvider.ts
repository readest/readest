import { createOllama } from 'ai-sdk-ollama';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, AISettings, AIProviderName } from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';
import { getAIFetch } from '../utils/httpFetch';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

const normalizeBaseUrl = (baseUrl?: string): string =>
  (baseUrl?.trim() || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '');

/**
 * Provider for a local (or LAN) Ollama instance.
 *
 * All outbound HTTP — both the streaming chat/embedding traffic going
 * through ai-sdk-ollama and the lightweight `/api/tags` probes used by
 * the availability/health checks — goes through {@link getAIFetch}. In
 * the Tauri app that hands the request off to the Rust HTTP transport
 * (no CORS preflight, no Android cleartext restriction); on the web
 * build it falls back to `window.fetch`.
 */
export class OllamaProvider implements AIProvider {
  id: AIProviderName = 'ollama';
  name = 'Ollama (Local)';
  requiresAuth = false;

  private ollama;
  private settings: AISettings;
  private httpFetch: typeof fetch;
  private baseURL: string;

  constructor(settings: AISettings) {
    this.settings = settings;
    this.baseURL = normalizeBaseUrl(settings.ollamaBaseUrl);
    this.httpFetch = getAIFetch();
    this.ollama = createOllama({
      baseURL: this.baseURL,
      fetch: this.httpFetch,
    });
    aiLogger.provider.init('ollama', settings.ollamaModel || 'llama3.2');
  }

  getModel(): LanguageModel {
    return this.ollama(this.settings.ollamaModel || 'llama3.2');
  }

  getEmbeddingModel(): EmbeddingModel {
    return this.ollama.embeddingModel(this.settings.ollamaEmbeddingModel || 'nomic-embed-text');
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AI_TIMEOUTS.OLLAMA_CONNECT);
      const response = await this.httpFetch(`${this.baseURL}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AI_TIMEOUTS.HEALTH_CHECK);
      const response = await this.httpFetch(`${this.baseURL}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return false;
      const data = await response.json();
      const modelName = this.settings.ollamaModel?.split(':')[0] ?? '';
      const embeddingModelName = this.settings.ollamaEmbeddingModel?.split(':')[0] ?? '';
      return (
        data.models?.some((m: { name: string }) => m.name.includes(modelName)) &&
        data.models?.some((m: { name: string }) => m.name.includes(embeddingModelName))
      );
    } catch (e) {
      aiLogger.provider.error('ollama', (e as Error).message);
      return false;
    }
  }
}
