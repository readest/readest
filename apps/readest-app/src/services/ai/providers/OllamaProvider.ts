import { Ollama } from 'ollama/browser';
import type {
  AIProvider,
  ChatMessage,
  AISettings,
  AIProviderName,
  StructuredAIResponse,
} from '../types';
import { OLLAMA_RESPONSE_SCHEMA } from '../types';
import { aiLogger } from '../logger';

export class OllamaProvider implements AIProvider {
  id: AIProviderName = 'ollama';
  name = 'Ollama (Local)';
  requiresAuth = false;

  private client: Ollama;
  private settings: AISettings;

  constructor(settings: AISettings) {
    this.settings = settings;
    this.client = new Ollama({ host: settings.ollamaBaseUrl || 'http://127.0.0.1:11434' });
    aiLogger.provider.init('ollama', settings.ollamaModel || 'llama3.2');
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
      const available = models.models.some((m) => m.name.includes(modelName));
      aiLogger.provider.init('ollama', `healthCheck: ${available ? 'OK' : 'FAIL'}`);
      return available;
    } catch (e) {
      aiLogger.provider.error('ollama', (e as Error).message);
      return false;
    }
  }

  async embed(text: string): Promise<number[]> {
    aiLogger.provider.embed('ollama', text.length);
    try {
      const response = await this.client.embed({
        model: this.settings.ollamaEmbeddingModel || 'nomic-embed-text',
        input: text,
      });
      const embedding = response.embeddings[0];
      if (!embedding) throw new Error('No embedding returned from Ollama');
      return embedding;
    } catch (e) {
      aiLogger.provider.error('ollama', `embed failed: ${(e as Error).message}`);
      throw e;
    }
  }

  async chatStructured(messages: ChatMessage[]): Promise<StructuredAIResponse> {
    aiLogger.provider.chat('ollama', messages.length);
    try {
      const response = await this.client.chat({
        model: this.settings.ollamaModel || 'llama3.2',
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        format: OLLAMA_RESPONSE_SCHEMA,
        options: { temperature: 0.7 },
      });
      const content = response.message?.content || '{}';
      aiLogger.chat.complete(content.length);
      try {
        const parsed = JSON.parse(content) as StructuredAIResponse;
        if (!parsed.answer) parsed.answer = content;
        if (!parsed.sources) parsed.sources = [];
        return parsed;
      } catch {
        return { answer: content, sources: [] };
      }
    } catch (e) {
      aiLogger.provider.error('ollama', (e as Error).message);
      throw e;
    }
  }

  async chatStream(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    onComplete: () => void,
    onError: (error: Error) => void,
  ): Promise<AbortController> {
    const abortController = new AbortController();
    aiLogger.provider.chat('ollama', messages.length);

    (async () => {
      try {
        const response = await this.client.chat({
          model: this.settings.ollamaModel || 'llama3.2',
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        });

        let tokenCount = 0;
        for await (const chunk of response) {
          if (abortController.signal.aborted) break;
          if (chunk.message?.content) {
            onToken(chunk.message.content);
            tokenCount++;
          }
        }

        if (!abortController.signal.aborted) {
          aiLogger.chat.stream(tokenCount);
          onComplete();
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          aiLogger.provider.error('ollama', (error as Error).message);
          onError(error as Error);
        }
      }
    })();

    return abortController;
  }
}
