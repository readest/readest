import type { AIProvider, AISettings, AIProviderName } from '../types';
import { OllamaProvider } from './OllamaProvider';
import { OpenRouterProvider } from './OpenRouterProvider';

export function getAIProvider(settings: AISettings): AIProvider {
  switch (settings.provider) {
    case 'ollama':
      return new OllamaProvider(settings);
    case 'openrouter':
      return new OpenRouterProvider(settings);
    default:
      throw new Error(`Unknown provider: ${settings.provider}`);
  }
}

export async function getAvailableProviders(settings: AISettings): Promise<AIProviderName[]> {
  const available: AIProviderName[] = [];

  try {
    const ollama = new OllamaProvider(settings);
    if (await ollama.isAvailable()) {
      available.push('ollama');
    }
  } catch {
    // ollama not available
  }

  if (settings.openrouterApiKey) {
    available.push('openrouter');
  }

  return available;
}

export { OllamaProvider, OpenRouterProvider };
