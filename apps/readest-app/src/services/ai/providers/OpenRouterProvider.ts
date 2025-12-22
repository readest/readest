import OpenAI from 'openai';
import type { AIProvider, ChatMessage, AISettings, AIProviderName } from '../types';

export class OpenRouterProvider implements AIProvider {
  id: AIProviderName = 'openrouter';
  name = 'OpenRouter (Cloud)';
  requiresAuth = true;

  private client: OpenAI;
  private settings: AISettings;

  constructor(settings: AISettings) {
    this.settings = settings;

    if (!settings.openrouterApiKey) {
      throw new Error('OpenRouter API key required');
    }

    this.client = new OpenAI({
      apiKey: settings.openrouterApiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://web.readest.com/',
        'X-Title': 'Readest AI Reading Companion',
      },
      dangerouslyAllowBrowser: true,
    });
  }

  async isAvailable(): Promise<boolean> {
    return !!this.settings.openrouterApiKey;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${this.settings.openrouterApiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.settings.openrouterEmbeddingModel || 'openai/text-embedding-3-small',
      input: text,
    });
    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new Error('No embedding returned from OpenRouter');
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
        const stream = await this.client.chat.completions.create(
          {
            model: this.settings.openrouterModel || 'anthropic/claude-sonnet-4.5',
            messages,
            stream: true,
          },
          {
            signal: abortController.signal,
          },
        );

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            onToken(content);
          }
        }

        if (!abortController.signal.aborted) {
          onComplete();
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError' && !abortController.signal.aborted) {
          onError(error as Error);
        }
      }
    })();

    return abortController;
  }
}
