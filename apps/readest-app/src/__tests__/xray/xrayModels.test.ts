import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings } from '@/services/ai/types';
import { createXRayModels } from '@/services/ai/xray/source/models';

vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({
    getModel: () => ({ __mock: 'language-model' }),
    getEmbeddingModel: () => ({ __mock: 'embedding-model' }),
  }),
}));

vi.mock('@/services/ai/utils/httpFetch', () => ({
  getAIFetch: () => vi.fn(),
}));

const settings = (overrides: Partial<AISettings>): AISettings => ({
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  ...overrides,
});

describe('createXRayModels', () => {
  it('identifies a chat model by provider and endpoint without including credentials', () => {
    const local = createXRayModels(
      settings({
        provider: 'ollama',
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'shared-model',
      }),
    );
    const remote = createXRayModels(
      settings({
        provider: 'ollama',
        ollamaBaseUrl: 'http://remote-host:11434',
        ollamaModel: 'shared-model',
      }),
    );
    const openrouter = createXRayModels(
      settings({
        provider: 'openrouter',
        openrouterApiKey: 'secret-key',
        openrouterBaseUrl: 'http://remote-host:11434',
        openrouterModel: 'shared-model',
      }),
    );

    expect(
      new Set([local.chatModelIdentity, remote.chatModelIdentity, openrouter.chatModelIdentity])
        .size,
    ).toBe(3);
    expect(openrouter.chatModelIdentity).not.toContain('secret-key');
  });
});
