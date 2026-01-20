import { createGateway } from 'ai';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, AISettings, AIProviderName } from '../types';
import { aiLogger } from '../logger';
import { GATEWAY_MODELS } from '../constants';
import { createProxiedEmbeddingModel } from './ProxiedGatewayEmbedding';

export class AIGatewayProvider implements AIProvider {
  id: AIProviderName = 'ai-gateway';
  name = 'AI Gateway (Cloud)';
  requiresAuth = true;

  private settings: AISettings;
  private gateway: ReturnType<typeof createGateway>;

  constructor(settings: AISettings) {
    this.settings = settings;
    if (!settings.aiGatewayApiKey) {
      throw new Error('AI Gateway API key required');
    }
    // create gateway instance with explicit apiKey
    this.gateway = createGateway({ apiKey: settings.aiGatewayApiKey });
    aiLogger.provider.init(
      'ai-gateway',
      settings.aiGatewayModel || GATEWAY_MODELS.GEMINI_FLASH_LITE,
    );
  }

  getModel(): LanguageModel {
    const modelId = this.settings.aiGatewayModel || GATEWAY_MODELS.GEMINI_FLASH_LITE;
    return this.gateway(modelId);
  }

  getEmbeddingModel(): EmbeddingModel<string> {
    const embedModel = this.settings.aiGatewayEmbeddingModel || 'openai/text-embedding-3-small';

    // in browser, route through API proxy to avoid CORS
    if (typeof window !== 'undefined') {
      return createProxiedEmbeddingModel({
        apiKey: this.settings.aiGatewayApiKey!,
        model: embedModel,
      });
    }

    // server-side can call gateway directly
    return this.gateway.textEmbeddingModel(embedModel);
  }

  async isAvailable(): Promise<boolean> {
    return !!this.settings.aiGatewayApiKey;
  }

  async healthCheck(): Promise<boolean> {
    return !!this.settings.aiGatewayApiKey;
  }
}
