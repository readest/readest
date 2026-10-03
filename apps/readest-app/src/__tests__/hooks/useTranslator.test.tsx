import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const { generateTextMock, getFromCacheMock, storeInCacheMock, isTauriMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  getFromCacheMock: vi.fn(),
  storeInCacheMock: vi.fn(),
  isTauriMock: vi.fn(() => false),
}));

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: generateTextMock,
}));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => vi.fn() }));
vi.mock('@/services/translators/cache', () => ({
  getFromCache: getFromCacheMock,
  storeInCache: storeInCacheMock,
}));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: isTauriMock,
}));
vi.mock('@/utils/supabase', () => ({ supabase: { auth: {}, from: vi.fn() } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));

import { useTranslator } from '@/hooks/useTranslator';
import { useCustomTranslatorStore } from '@/store/customTranslatorStore';
import { getTranslatorDisplayLabel, getTranslators } from '@/services/translators';
import type { CustomTranslator } from '@/types/translation';

const llm: CustomTranslator = {
  id: 'llm',
  type: 'openai-compatible',
  name: 'My LLM',
  baseUrl: 'https://llm.example.com/v1',
  model: 'm1',
  addedAt: 1,
  updatedAt: 1,
};
const deepl: CustomTranslator = {
  id: 'dl',
  type: 'deepl',
  name: 'My DeepL',
  apiKey: 'k:fx',
  addedAt: 1,
  updatedAt: 1,
};

describe('custom translators in the registry and useTranslator', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    getFromCacheMock.mockReset().mockResolvedValue(null);
    storeInCacheMock.mockReset().mockResolvedValue(undefined);
    isTauriMock.mockReturnValue(false);
    useCustomTranslatorStore.setState({ translators: [llm, deepl], prompts: [], loaded: true });
  });

  it('lists custom translators after the built-ins', () => {
    const names = getTranslators().map((t) => t.name);
    expect(names.slice(-2)).toEqual(['custom:llm', 'custom:dl']);
  });

  it('greys out the DeepL type on web and enables it in the app', () => {
    const web = getTranslators().find((t) => t.name === 'custom:dl')!;
    expect(web.disabled).toBe(true);
    expect(getTranslatorDisplayLabel(web, false, (s) => s)).toBe('My DeepL (App only)');
    isTauriMock.mockReturnValue(true);
    useCustomTranslatorStore.setState({ translators: [llm, { ...deepl, updatedAt: 2 }] });
    expect(getTranslators().find((t) => t.name === 'custom:dl')!.disabled).toBe(false);
  });

  it('caches custom translations under a prompt-aware key and forwards the book context', async () => {
    generateTextMock.mockResolvedValue({ text: 'Bonjour' });
    const { result } = renderHook(() =>
      useTranslator({ provider: 'custom:llm', targetLang: 'fr', bookTitle: 'Candide' }),
    );
    await waitFor(() => expect(result.current.translator?.name).toBe('custom:llm'));
    let out: string[] = [];
    await act(async () => {
      out = await result.current.translate(['Hello']);
    });
    expect(out).toEqual(['Bonjour']);
    expect(generateTextMock.mock.calls[0]![0].system).toContain('Candide');
    const cacheKey = storeInCacheMock.mock.calls[0]![4] as string;
    expect(cacheKey).toMatch(/^custom:llm#/);
  });

  it('falls back to a built-in translator when the custom one is missing', async () => {
    const { result } = renderHook(() => useTranslator({ provider: 'custom:gone' }));
    await waitFor(() => expect(result.current.translator).toBeDefined());
    expect(result.current.translator!.name.startsWith('custom:')).toBe(false);
  });
});
