import { describe, it, expect, vi } from 'vitest';
import {
  getAIProvider,
  getAvailableProviders,
  OllamaProvider,
  OpenRouterProvider,
} from '../providers';
import { DEFAULT_AI_SETTINGS } from '../constants';
import type { AISettings } from '../types';

vi.mock('ollama/browser', () => {
  return {
    Ollama: class MockOllama {
      host: string;
      constructor(config: { host: string }) {
        this.host = config.host;
      }
      list = vi.fn().mockResolvedValue({ models: [{ name: 'qwen3-coder:32b' }] });
      embed = vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] });
      chat = vi.fn().mockImplementation(async function* () {
        yield { message: { content: 'test' } };
      });
    },
  };
});

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      apiKey: string;
      baseURL: string;
      constructor(config: { apiKey: string; baseURL: string }) {
        this.apiKey = config.apiKey;
        this.baseURL = config.baseURL;
      }
      chat = {
        completions: {
          create: vi.fn().mockImplementation(async function* () {
            yield { choices: [{ delta: { content: 'test' } }] };
          }),
        },
      };
      embeddings = {
        create: vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      };
    },
  };
});

describe('AI Provider Factory', () => {
  const baseSettings: AISettings = {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
  };

  describe('getAIProvider', () => {
    it('returns OllamaProvider for ollama', () => {
      const settings: AISettings = { ...baseSettings, provider: 'ollama' };
      const provider = getAIProvider(settings);
      expect(provider).toBeInstanceOf(OllamaProvider);
      expect(provider.id).toBe('ollama');
      expect(provider.requiresAuth).toBe(false);
    });

    it('returns OpenRouterProvider for openrouter', () => {
      const settings: AISettings = {
        ...baseSettings,
        provider: 'openrouter',
        openrouterApiKey: 'sk-or-test-key',
      };
      const provider = getAIProvider(settings);
      expect(provider).toBeInstanceOf(OpenRouterProvider);
      expect(provider.id).toBe('openrouter');
      expect(provider.requiresAuth).toBe(true);
    });

    it('throws for unknown provider', () => {
      const settings = { ...baseSettings, provider: 'unknown' } as unknown as AISettings;
      expect(() => getAIProvider(settings)).toThrow('Unknown provider');
    });

    it('throws for openrouter without api key', () => {
      const settings: AISettings = {
        ...baseSettings,
        provider: 'openrouter',
        openrouterApiKey: undefined,
      };
      expect(() => getAIProvider(settings)).toThrow('API key required');
    });
  });

  describe('getAvailableProviders', () => {
    it('includes openrouter when api key is present', async () => {
      const settings: AISettings = {
        ...baseSettings,
        openrouterApiKey: 'sk-or-test-key',
      };
      const providers = await getAvailableProviders(settings);
      expect(providers).toContain('openrouter');
    });

    it('excludes openrouter when api key is missing', async () => {
      const settings: AISettings = {
        ...baseSettings,
        openrouterApiKey: undefined,
      };
      const providers = await getAvailableProviders(settings);
      expect(providers).not.toContain('openrouter');
    });
  });
});

describe('OllamaProvider', () => {
  const settings: AISettings = { ...DEFAULT_AI_SETTINGS, provider: 'ollama' };

  it('has correct metadata', () => {
    const provider = new OllamaProvider(settings);
    expect(provider.id).toBe('ollama');
    expect(provider.name).toBe('Ollama (Local)');
    expect(provider.requiresAuth).toBe(false);
  });

  it('isAvailable returns true when ollama is reachable', async () => {
    const provider = new OllamaProvider(settings);
    const result = await provider.isAvailable();
    expect(result).toBe(true);
  });

  it('healthCheck returns true when model exists', async () => {
    const provider = new OllamaProvider(settings);
    const result = await provider.healthCheck();
    expect(result).toBe(true);
  });
});

describe('OpenRouterProvider', () => {
  const settings: AISettings = {
    ...DEFAULT_AI_SETTINGS,
    provider: 'openrouter',
    openrouterApiKey: 'sk-or-test-key',
  };

  it('has correct metadata', () => {
    const provider = new OpenRouterProvider(settings);
    expect(provider.id).toBe('openrouter');
    expect(provider.name).toBe('OpenRouter (Cloud)');
    expect(provider.requiresAuth).toBe(true);
  });

  it('isAvailable returns true when api key exists', async () => {
    const provider = new OpenRouterProvider(settings);
    const result = await provider.isAvailable();
    expect(result).toBe(true);
  });
});
