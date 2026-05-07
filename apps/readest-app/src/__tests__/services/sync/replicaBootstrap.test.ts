import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/store/customDictionaryStore', () => ({
  useCustomDictionaryStore: { getState: () => ({ markAvailableByContentId: vi.fn() }) },
}));

vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: { getState: () => ({ markAvailableByContentId: vi.fn() }) },
}));

vi.mock('@/store/customTextureStore', () => ({
  useCustomTextureStore: { getState: () => ({ markAvailableByContentId: vi.fn() }) },
}));

import {
  __resetBootstrapForTests,
  bootstrapReplicaAdapters,
} from '@/services/sync/replicaBootstrap';
import {
  clearReplicaAdapters,
  getReplicaAdapter,
  listReplicaAdapters,
} from '@/services/sync/replicaRegistry';
import { __resetReplicaTransferIntegrationForTests } from '@/services/sync/replicaTransferIntegration';
import { dictionaryAdapter } from '@/services/sync/adapters/dictionary';

afterEach(() => {
  clearReplicaAdapters();
  __resetBootstrapForTests();
  __resetReplicaTransferIntegrationForTests();
});

describe('bootstrapReplicaAdapters', () => {
  test('registers the dictionary adapter', () => {
    bootstrapReplicaAdapters();
    expect(getReplicaAdapter('dictionary')).toBe(dictionaryAdapter);
  });

  test('is idempotent: calling twice is a no-op (does not throw)', () => {
    bootstrapReplicaAdapters();
    bootstrapReplicaAdapters();
    expect(listReplicaAdapters()).toHaveLength(3);
  });

  test('registers the current allowlist (dictionary, font, texture)', () => {
    bootstrapReplicaAdapters();
    const kinds = listReplicaAdapters().map((a) => a.kind);
    expect(kinds).toEqual(['dictionary', 'font', 'texture']);
  });
});
