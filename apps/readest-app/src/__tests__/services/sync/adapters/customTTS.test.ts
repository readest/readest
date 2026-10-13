import { describe, expect, test } from 'vitest';
import { CUSTOM_TTS_KIND, customTTSAdapter } from '@/services/sync/adapters/customTTS';
import { KIND_ALLOWLIST } from '@/libs/replicaSchemas';
import type { CustomTTSService } from '@/types/customTTS';
import type { FieldEnvelope, FieldsObject, Hlc, ReplicaRow } from '@/types/replica';

const HLC = '00000000000-00000000-dev' as Hlc;
const env = <T>(v: T): FieldEnvelope<T> => ({ v, t: HLC, s: 'dev' });

const service: CustomTTSService = {
  id: 's-1',
  name: 'Kokoro',
  baseUrl: 'http://127.0.0.1:8880/v1',
  apiKey: 'sk-secret',
  model: 'kokoro',
  instructions: 'Calm.',
  disabled: true,
  addedAt: 1700000000000,
  updatedAt: 1700000000001,
};

const row = (fields: Record<string, unknown>, overrides: Partial<ReplicaRow> = {}) =>
  ({
    user_id: 'u',
    kind: CUSTOM_TTS_KIND,
    replica_id: 'rid',
    fields_jsonb: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, env(v)]),
    ) as FieldsObject,
    manifest_jsonb: null,
    deleted_at_ts: null,
    reincarnation: null,
    updated_at_ts: HLC,
    schema_version: 1,
    ...overrides,
  }) as ReplicaRow;

describe('customTTSAdapter', () => {
  test('is the metadata-only custom_tts kind with an encrypted apiKey', () => {
    expect(customTTSAdapter.kind).toBe('custom_tts');
    expect(customTTSAdapter.binary).toBeUndefined();
    expect(customTTSAdapter.encryptedFields).toEqual(['apiKey']);
    expect(KIND_ALLOWLIST['custom_tts']).toBeDefined();
  });

  test('round-trips a service through pack and unpackRow', () => {
    const { id: _id, ...fields } = service;
    expect(customTTSAdapter.pack(service)).toEqual(fields);
    const unpacked = customTTSAdapter.unpackRow(
      row(customTTSAdapter.pack(service), { replica_id: 's-1', reincarnation: 'r1' }),
      '',
    );
    expect(unpacked).toEqual({ ...service, reincarnation: 'r1' });
  });

  test('carries a cleared API key as empty', () => {
    const packed = customTTSAdapter.pack({ ...service, apiKey: '' });
    expect(packed['apiKey']).toBe('');
    const unpacked = customTTSAdapter.unpackRow(row(packed, { replica_id: 's-1' }), '');
    expect(unpacked!.apiKey).toBe('');
  });

  test('rejects rows without a name, base URL or model', () => {
    const { id: _id, ...fields } = service;
    for (const missing of ['name', 'baseUrl', 'model']) {
      expect(customTTSAdapter.unpackRow(row({ ...fields, [missing]: undefined }), '')).toBeNull();
    }
  });
});
