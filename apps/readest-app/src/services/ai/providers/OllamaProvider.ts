import { createOllama } from 'ai-sdk-ollama';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, AISettings, AIProviderName } from '../types';
import { aiLogger } from '../logger';

export class OllamaProvider implements AIProvider {
  id: AIProviderName = 'ollama';
  name = 'Ollama (Local)';
  requiresAuth = false;

  private ollama;
  private settings: AISettings;

  constructor(settings: AISettings) {
    this.settings = settings;
    this.ollama = createOllama({
      baseURL: settings.ollamaBaseUrl || 'http://127.0.0.1:11434',
    });
    aiLogger.provider.init('ollama', settings.ollamaModel || 'llama3.2');
  }

  getModel(): LanguageModel {
    return this.ollama(this.settings.ollamaModel || 'llama3.2');
  }

  getEmbeddingModel(): EmbeddingModel<string> {
    return this.ollama.textEmbeddingModel(this.settings.ollamaEmbeddingModel || 'nomic-embed-text');
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.settings.ollamaBaseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.settings.ollamaBaseUrl}/api/tags`);
      if (!response.ok) return false;
      const data = await response.json();
      const modelName = this.settings.ollamaModel?.split(':')[0] ?? '';
      return data.models?.some((m: { name: string }) => m.name.includes(modelName));
    } catch (e) {
      aiLogger.provider.error('ollama', (e as Error).message);
      return false;
    }
  }
}
