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

vi.mock('@/store/customOPDSStore', () => ({
  useCustomOPDSStore: {
    getState: () => ({ applyRemoteCatalog: vi.fn(), softDeleteByContentId: vi.fn() }),
  },
  findOPDSCatalogByContentId: vi.fn(),
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
    expect(listReplicaAdapters()).toHaveLength(5);
  });

  test('registers the current allowlist (dictionary, font, texture, opds_catalog, settings)', () => {
    bootstrapReplicaAdapters();
    const kinds = listReplicaAdapters().map((a) => a.kind);
    expect(kinds).toEqual(['dictionary', 'font', 'texture', 'opds_catalog', 'settings']);
  });
});
