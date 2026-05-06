import { afterEach, describe, expect, test } from 'vitest';
import {
  __resetBootstrapForTests,
  bootstrapReplicaAdapters,
} from '@/services/sync/replicaBootstrap';
import {
  clearReplicaAdapters,
  getReplicaAdapter,
  listReplicaAdapters,
} from '@/services/sync/replicaRegistry';
import { dictionaryAdapter } from '@/services/sync/adapters/dictionary';

afterEach(() => {
  clearReplicaAdapters();
  __resetBootstrapForTests();
});

describe('bootstrapReplicaAdapters', () => {
  test('registers the dictionary adapter', () => {
    bootstrapReplicaAdapters();
    expect(getReplicaAdapter('dictionary')).toBe(dictionaryAdapter);
  });

  test('is idempotent: calling twice is a no-op (does not throw)', () => {
    bootstrapReplicaAdapters();
    bootstrapReplicaAdapters();
    expect(listReplicaAdapters()).toHaveLength(1);
  });

  test('only registers the kinds in the PR-1 allowlist', () => {
    bootstrapReplicaAdapters();
    const kinds = listReplicaAdapters().map((a) => a.kind);
    expect(kinds).toEqual(['dictionary']);
  });
});
