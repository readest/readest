import { describe, test, expect, vi, beforeEach } from 'vitest';

// mock environment
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => true),
}));

import {
  getAIRuntimeInfo,
  canUseAI,
  getStorageBackend,
  getEmbeddingSource,
  getChatSource,
} from '@/services/ai/runtime';
import { isTauriAppPlatform } from '@/services/environment';
import type { AISettings } from '@/services/ai/types';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

describe('getAIRuntimeInfo', () => {
  beforeEach(() => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
  });

  test('should return client mode for Tauri + Ollama', () => {
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true, provider: 'ollama' };
    const info = getAIRuntimeInfo(settings);

    expect(info.mode).toBe('client');
    expect(info.platform).toBe('tauri');
    expect(info.supportsOffline).toBe(true);
    expect(info.storageLocation).toBe('indexeddb');
  });

  test('should return client mode for Tauri + AI Gateway', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ai-gateway',
      aiGatewayApiKey: 'test-key',
    };
    const info = getAIRuntimeInfo(settings);

    expect(info.mode).toBe('client');
    expect(info.supportsOffline).toBe(false);
  });

  test('should throw for web + Ollama', () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true, provider: 'ollama' };

    expect(() => getAIRuntimeInfo(settings)).toThrow('Ollama is a local-only provider');
  });

  test('should return client mode for web + AI Gateway with user key', () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ai-gateway',
      aiGatewayApiKey: 'user-key',
    };
    const info = getAIRuntimeInfo(settings);

    expect(info.mode).toBe('client'); // currently client, will be server when tiers implemented
    expect(info.platform).toBe('web');
  });
});

describe('canUseAI', () => {
  beforeEach(() => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
  });

  test('should return false if AI disabled', () => {
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: false };
    const result = canUseAI(settings);

    expect(result.available).toBe(false);
    expect(result.reason).toContain('disabled');
  });

  test('should return false for web + Ollama', () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true, provider: 'ollama' };
    const result = canUseAI(settings);

    expect(result.available).toBe(false);
    expect(result.reason).toContain('desktop app');
  });

  test('should return false for AI Gateway without key', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ai-gateway',
      aiGatewayApiKey: undefined,
    };
    const result = canUseAI(settings);

    expect(result.available).toBe(false);
    expect(result.reason).toContain('API key');
  });

  test('should return true for valid config', () => {
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ai-gateway',
      aiGatewayApiKey: 'valid-key',
    };
    const result = canUseAI(settings);

    expect(result.available).toBe(true);
  });
});

describe('getStorageBackend', () => {
  test('should always return IndexedDB for now', () => {
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true };
    const backend = getStorageBackend(settings);

    expect(backend.type).toBe('indexeddb');
    expect(backend.isRemote).toBe(false);
    expect(backend.supportsSync).toBe(false); // will be true in future
  });
});

describe('getEmbeddingSource', () => {
  beforeEach(() => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
  });

  test('should return local for Tauri', () => {
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true };
    const source = getEmbeddingSource(settings);

    expect(source.type).toBe('local');
  });

  test('should return local for web with user key', () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    const settings: AISettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ai-gateway',
      aiGatewayApiKey: 'user-key',
    };
    const source = getEmbeddingSource(settings);

    expect(source.type).toBe('local'); // will be server when your key
  });
});

describe('getChatSource', () => {
  beforeEach(() => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
  });

  test('should return local for Tauri', () => {
    const settings: AISettings = { ...DEFAULT_AI_SETTINGS, enabled: true };
    const source = getChatSource(settings);

    expect(source.type).toBe('local');
  });
});
