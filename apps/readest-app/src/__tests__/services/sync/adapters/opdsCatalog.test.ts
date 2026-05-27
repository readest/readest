import { describe, expect, test } from 'vitest';
import {
  computeOpdsCatalogContentId,
  opdsCatalogAdapter,
  OPDS_CATALOG_KIND,
  OPDS_CATALOG_SCHEMA_VERSION,
} from '@/services/sync/adapters/opdsCatalog';
import type { OPDSCatalog } from '@/types/opds';
import type { FieldEnvelope, Hlc, ReplicaRow } from '@/types/replica';

const sample: OPDSCatalog = {
  id: 'cid',
  contentId: 'cid',
  name: 'My Library',
  url: 'https://example.com/opds',
  description: 'A test catalog',
  icon: '📚',
  customHeaders: { 'X-Token': 'abc' },
  autoDownload: true,
  addedAt: 1700000000000,
};

const HLC = '00000000000-00000000-dev' as Hlc;
const env = <T>(v: T): FieldEnvelope<T> => ({ v, t: HLC, s: 'dev' });

const makeRow = (overrides: Partial<ReplicaRow> = {}): ReplicaRow => ({
  user_id: 'u',
  kind: OPDS_CATALOG_KIND,
  replica_id: 'cid',
  fields_jsonb: {
    name: env('My Library'),
    url: env('https://example.com/opds'),
    description: env('A test catalog'),
    icon: env('📚'),
    customHeaders: env({ 'X-Token': 'abc' }),
    autoDownload: env(true),
    addedAt: env(1700000000000),
  },
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: HLC,
  schema_version: 1,
  ...overrides,
});

describe('opdsCatalogAdapter', () => {
  test('kind + schemaVersion are stable constants', () => {
    expect(opdsCatalogAdapter.kind).toBe('opds_catalog');
    expect(opdsCatalogAdapter.schemaVersion).toBe(1);
    expect(OPDS_CATALOG_KIND).toBe('opds_catalog');
    expect(OPDS_CATALOG_SCHEMA_VERSION).toBe(1);
  });

  test('declares no `binary` capability — metadata-only kind', () => {
    expect(opdsCatalogAdapter.binary).toBeUndefined();
  });

  test('pack passes username + password through as plaintext (middleware encrypts)', () => {
    const withCreds: OPDSCatalog = { ...sample, username: 'alice', password: 'hunter2' };
    const fields = opdsCatalogAdapter.pack(withCreds);
    // Adapter is plaintext-in-plaintext-out. The publish-side
    // replicaCryptoMiddleware.encryptPackedFields wraps these in
    // cipher envelopes (or drops them if the session is locked)
    // before they reach fields_jsonb.
    expect(fields['username']).toBe('alice');
    expect(fields['password']).toBe('hunter2');
    expect(fields['name']).toBe('My Library');
    expect(fields['url']).toBe('https://example.com/opds');
  });

  test('declares encryptedFields = [username, password]', () => {
    expect(opdsCatalogAdapter.encryptedFields).toEqual(['username', 'password']);
  });

  test('pack ∘ unpack is identity for non-credential fields', async () => {
    const fields = opdsCatalogAdapter.pack(sample);
    const out = opdsCatalogAdapter.unpack(fields);
    expect(out.name).toBe(sample.name);
    expect(out.url).toBe(sample.url);
    expect(out.description).toBe(sample.description);
    expect(out.icon).toBe(sample.icon);
    expect(out.customHeaders).toEqual(sample.customHeaders);
    expect(out.autoDownload).toBe(true);
    expect(out.addedAt).toBe(sample.addedAt);
  });

  test('computeId returns the contentId', async () => {
    const id = await opdsCatalogAdapter.computeId(sample);
    expect(id).toBe('cid');
  });

  test('unpackRow rebuilds the catalog from CRDT envelopes', () => {
    const row = makeRow();
    const out = opdsCatalogAdapter.unpackRow(row, '');
    expect(out).not.toBeNull();
    expect(out!.id).toBe('cid');
    expect(out!.contentId).toBe('cid');
    expect(out!.name).toBe('My Library');
    expect(out!.url).toBe('https://example.com/opds');
    expect(out!.autoDownload).toBe(true);
  });

  test('unpackRow returns null when name or url is missing', () => {
    const noName = makeRow({ fields_jsonb: { url: env('https://x') } });
    expect(opdsCatalogAdapter.unpackRow(noName, '')).toBeNull();

    const noUrl = makeRow({ fields_jsonb: { name: env('x') } });
    expect(opdsCatalogAdapter.unpackRow(noUrl, '')).toBeNull();
  });

  test('unpackRow surfaces the reincarnation token', () => {
    const row = makeRow({ reincarnation: 'rev1' });
    const out = opdsCatalogAdapter.unpackRow(row, '');
    expect(out!.reincarnation).toBe('rev1');
  });
});

describe('computeOpdsCatalogContentId', () => {
  test('is stable under whitespace and case differences in URL', () => {
    const a = computeOpdsCatalogContentId('https://Example.com/OPDS/');
    const b = computeOpdsCatalogContentId('  https://example.com/opds/  ');
    expect(a).toBe(b);
  });

  test('different URLs produce different ids', () => {
    const a = computeOpdsCatalogContentId('https://example.com/opds');
    const b = computeOpdsCatalogContentId('https://example.com/feed');
    expect(a).not.toBe(b);
  });
});
