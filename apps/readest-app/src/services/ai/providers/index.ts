import { OllamaProvider } from './OllamaProvider';
import { AIGatewayProvider } from './AIGatewayProvider';
import { OpenRouterProvider } from './OpenRouterProvider';
import type { AIProvider, AISettings } from '../types';

export { OllamaProvider, AIGatewayProvider, OpenRouterProvider };

export function getAIProvider(settings: AISettings): AIProvider {
  switch (settings.provider) {
    case 'ollama':
      return new OllamaProvider(settings);
    case 'ai-gateway':
      if (!settings.aiGatewayApiKey) {
        throw new Error('API key required for AI Gateway');
      }
      return new AIGatewayProvider(settings);
    case 'openrouter':
      if (!settings.openrouterApiKey) {
        throw new Error('API key required for OpenRouter');
      }
      return new OpenRouterProvider(settings);
    default:
      throw new Error(`Unknown provider: ${settings.provider}`);
  }
}
