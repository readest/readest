import { gateway } from 'ai';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, AISettings, AIProviderName } from '../types';
import { aiLogger } from '../logger';
import { GATEWAY_MODELS } from '../constants';

export class AIGatewayProvider implements AIProvider {
  id: AIProviderName = 'ai-gateway';
  name = 'AI Gateway (Cloud)';
  requiresAuth = true;

  private settings: AISettings;

  constructor(settings: AISettings) {
    this.settings = settings;
    if (!settings.aiGatewayApiKey) {
      throw new Error('AI Gateway API key required');
    }
    aiLogger.provider.init('ai-gateway', settings.aiGatewayModel || GATEWAY_MODELS.CLAUDE_SONNET);
  }

  getModel(): LanguageModel {
    const modelId = this.settings.aiGatewayModel || GATEWAY_MODELS.CLAUDE_SONNET;
    return gateway(modelId);
  }

  getEmbeddingModel(): EmbeddingModel<string> {
    const embedModel = this.settings.aiGatewayEmbeddingModel || 'openai/text-embedding-3-small';
    return gateway.textEmbeddingModel(embedModel);
  }

  async isAvailable(): Promise<boolean> {
    return !!this.settings.aiGatewayApiKey;
  }

  async healthCheck(): Promise<boolean> {
    return !!this.settings.aiGatewayApiKey;
  }
}
