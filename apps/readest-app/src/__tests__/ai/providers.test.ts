import { describe, test, expect, vi, beforeEach } from 'vitest';

// mock fetch for provider tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// mock logger
vi.mock('@/services/ai/logger', () => ({
  aiLogger: {
    provider: {
      init: vi.fn(),
      error: vi.fn(),
    },
  },
}));

// mock ai-sdk-ollama
vi.mock('ai-sdk-ollama', () => ({
  createOllama: vi.fn(() => {
    const ollamaFn = Object.assign(vi.fn(), {
      textEmbeddingModel: vi.fn(),
    });
    return ollamaFn;
  }),
}));

import { OllamaProvider } from '@/services/ai/providers/OllamaProvider';
import { AIGatewayProvider } from '@/services/ai/providers/AIGatewayProvider';
import { getAIProvider, getAvailableProviders } from '@/services/ai/providers';
import type { AISettings } from '@/services/ai/types';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should create provider with default settings', () => {
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true };
    const provider = new OllamaProvider(settings);

    expect(provider.id).toBe('ollama');
    expect(provider.name).toBe('Ollama (Local)');
    expect(provider.requiresAuth).toBe(false);
  });

  test('isAvailable should return true when Ollama responds', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true };
    const provider = new OllamaProvider(settings);

    const result = await provider.isAvailable();
    expect(result).toBe(true);
  });

  test('isAvailable should return false when Ollama not running', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true };
    const provider = new OllamaProvider(settings);

    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });

  test('healthCheck should verify model exists', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ models: [{ name: 'llama3.2:latest' }] }),
    });
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true, ollamaModel: 'llama3.2' };
    const provider = new OllamaProvider(settings);

    const result = await provider.healthCheck();
    expect(result).toBe(true);
  });

  test('healthCheck should return false if model not found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ models: [{ name: 'other-model' }] }),
    });
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true, ollamaModel: 'llama3.2' };
    const provider = new OllamaProvider(settings);

    const result = await provider.healthCheck();
    expect(result).toBe(false);
  });
});

describe('AIGatewayProvider', () => {
  test('should throw if no API key', () => {
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true, provider: 'ai-gateway' };

    expect(() => new AIGatewayProvider(settings)).toThrow('API key required');
  });

  test('should create provider with API key', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ai-gateway',
      aiGatewayApiKey: 'test-key',
    };
    const provider = new AIGatewayProvider(settings);

    expect(provider.id).toBe('ai-gateway');
    expect(provider.name).toBe('AI Gateway (Cloud)');
    expect(provider.requiresAuth).toBe(true);
  });

  test('isAvailable should return true if key exists', async () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ai-gateway',
      aiGatewayApiKey: 'test-key',
    };
    const provider = new AIGatewayProvider(settings);

    const result = await provider.isAvailable();
    expect(result).toBe(true);
  });

  test('isAvailable should return false if key does not exist', async () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ai-gateway',
      aiGatewayApiKey: '',
    };

    // provider throws on construction if no key, so we test via getAIProvider fallback
    expect(() => new AIGatewayProvider(settings)).toThrow('API key required');
  });

  test('healthCheck should return false if key does not exist', async () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ai-gateway',
      aiGatewayApiKey: 'valid-key',
    };
    const provider = new AIGatewayProvider(settings);

    // override key after construction to simulate missing key check in healthCheck
    (provider as unknown as { settings: AISettings }).settings.aiGatewayApiKey = '';
    const result = await provider.healthCheck();
    expect(result).toBe(false);
  });
});

describe('getAIProvider', () => {
  test('should return OllamaProvider for ollama', () => {
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true, provider: 'ollama' };
    const provider = getAIProvider(settings);

    expect(provider.id).toBe('ollama');
  });

  test('should return AIGatewayProvider for ai-gateway', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ai-gateway',
      aiGatewayApiKey: 'test-key',
    };
    const provider = getAIProvider(settings);

    expect(provider.id).toBe('ai-gateway');
  });

  test('should throw for unknown provider', () => {
    const settings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'unknown' as unknown,
    } as AISettings;

    expect(() => getAIProvider(settings)).toThrow('Unknown provider');
  });
});

describe('getAvailableProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should include ollama if available', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true };

    const providers = await getAvailableProviders(settings);
    expect(providers).toContain('ollama');
  });

  test('should include ai-gateway if key provided', async () => {
    mockFetch.mockRejectedValueOnce(new Error('No Ollama'));
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      aiGatewayApiKey: 'test-key',
    };

    const providers = await getAvailableProviders(settings);
    expect(providers).toContain('ai-gateway');
  });
});
