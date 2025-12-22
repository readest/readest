import { Ollama } from 'ollama/browser';
import type { AIProvider, ChatMessage, AISettings, AIProviderName } from '../types';

export class OllamaProvider implements AIProvider {
  id: AIProviderName = 'ollama';
  name = 'Ollama (Local)';
  requiresAuth = false;

  private client: Ollama;
  private settings: AISettings;

  constructor(settings: AISettings) {
    this.settings = settings;
    this.client = new Ollama({
      host: settings.ollamaBaseUrl || 'http://127.0.0.1:11434',
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.list();
      return true;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const models = await this.client.list();
      const modelName = this.settings.ollamaModel?.split(':')[0] ?? '';
      return models.models.some((m) => m.name.includes(modelName));
    } catch {
      return false;
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embed({
      model: this.settings.ollamaEmbeddingModel || 'nomic-embed-text',
      input: text,
    });
    const embedding = response.embeddings[0];
    if (!embedding) {
      throw new Error('No embedding returned from Ollama');
    }
    return embedding;
  }

  async chatStream(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    onComplete: () => void,
    onError: (error: Error) => void,
  ): Promise<AbortController> {
    const abortController = new AbortController();

    (async () => {
      try {
        const response = await this.client.chat({
          model: this.settings.ollamaModel || 'llama3.2',
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        });

        for await (const chunk of response) {
          if (abortController.signal.aborted) break;
          if (chunk.message?.content) {
            onToken(chunk.message.content);
          }
        }

        if (!abortController.signal.aborted) {
          onComplete();
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          onError(error as Error);
        }
      }
    })();

    return abortController;
  }
}
