import { describe, expect, test } from 'vitest';
import {
  SETTINGS_KIND,
  SETTINGS_REPLICA_ID,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_WHITELIST,
  readPath,
  settingsAdapter,
  writePath,
  type SettingsRemoteRecord,
} from '@/services/sync/adapters/settings';
import type { FieldEnvelope, Hlc, ReplicaRow } from '@/types/replica';
import type { SystemSettings } from '@/types/settings';

const HLC = '00000000001-00000000-dev' as Hlc;
const env = <T>(v: T): FieldEnvelope<T> => ({ v, t: HLC, s: 'dev' });

const makeRow = (fields: Record<string, FieldEnvelope<unknown>>): ReplicaRow => ({
  user_id: 'u',
  kind: SETTINGS_KIND,
  replica_id: SETTINGS_REPLICA_ID,
  fields_jsonb: fields,
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: HLC,
  schema_version: 1,
});

describe('settingsAdapter', () => {
  test('kind + schemaVersion + replica id are stable', () => {
    expect(settingsAdapter.kind).toBe('settings');
    expect(settingsAdapter.schemaVersion).toBe(1);
    expect(SETTINGS_KIND).toBe('settings');
    expect(SETTINGS_SCHEMA_VERSION).toBe(1);
    expect(SETTINGS_REPLICA_ID).toBe('singleton');
  });

  test('declares no `binary` capability — bundled metadata only', () => {
    expect(settingsAdapter.binary).toBeUndefined();
  });

  test('computeId always returns the singleton id', async () => {
    expect(await settingsAdapter.computeId({ name: 'singleton', patch: {} })).toBe('singleton');
  });

  test('pack only emits whitelisted fields, dropping non-whitelist keys', () => {
    const userColors = [{ name: 'mint', color: '#a8e6cf' }];
    const record: SettingsRemoteRecord = {
      name: 'singleton',
      patch: {
        globalReadSettings: { userHighlightColors: userColors },
        // not in whitelist:
        telemetryEnabled: true,
        screenBrightness: 0.5,
        localBooksDir: '/should/not/sync',
      } as unknown as Partial<SystemSettings>,
    };
    const fields = settingsAdapter.pack(record);
    expect(fields['globalReadSettings.userHighlightColors']).toEqual(userColors);
    expect(fields['telemetryEnabled']).toBeUndefined();
    expect(fields['screenBrightness']).toBeUndefined();
    expect(fields['localBooksDir']).toBeUndefined();
  });

  test('pack flattens dot-namespaced nested keys', () => {
    const record: SettingsRemoteRecord = {
      name: 'singleton',
      patch: {
        kosync: { serverUrl: 'https://kosync.example' },
      } as Partial<SystemSettings>,
    };
    const fields = settingsAdapter.pack(record);
    expect(fields['kosync.serverUrl']).toBe('https://kosync.example');
  });

  test('pack ∘ unpack round-trips object-valued nested fields (highlight palette)', () => {
    const customColors = { yellow: '#ffeb3b', blue: '#2196f3' };
    const userColors = [{ name: 'mint', color: '#a8e6cf' }];
    const record: SettingsRemoteRecord = {
      name: 'singleton',
      patch: {
        globalReadSettings: {
          customHighlightColors: customColors,
          userHighlightColors: userColors,
        },
      } as unknown as Partial<SystemSettings>,
    };
    const fields = settingsAdapter.pack(record);
    const out = settingsAdapter.unpack(fields);
    expect(out.patch.globalReadSettings?.customHighlightColors).toEqual(customColors);
    expect(out.patch.globalReadSettings?.userHighlightColors).toEqual(userColors);
  });

  test('declares encryptedFields covering kosync / readwise / hardcover credentials only (not serverUrl)', () => {
    expect(settingsAdapter.encryptedFields).toEqual([
      'kosync.username',
      'kosync.userkey',
      'kosync.password',
      'readwise.accessToken',
      'hardcover.accessToken',
    ]);
  });

  test('kosync.serverUrl is plaintext (not in encryptedFields)', () => {
    expect(settingsAdapter.encryptedFields).not.toContain('kosync.serverUrl');
  });

  test('unpackRow reconstructs the patch from CRDT envelopes', () => {
    const userColors = [{ name: 'mint', color: '#a8e6cf' }];
    const row = makeRow({
      'globalReadSettings.userHighlightColors': env(userColors),
      'kosync.serverUrl': env('https://kosync.example'),
    });
    const out = settingsAdapter.unpackRow(row, '');
    expect(out).not.toBeNull();
    expect(out!.name).toBe('singleton');
    expect(out!.patch.globalReadSettings?.userHighlightColors).toEqual(userColors);
    expect(out!.patch.kosync?.serverUrl).toBe('https://kosync.example');
  });

  test('unpackRow returns null when the row carries no whitelisted fields', () => {
    const row = makeRow({ unknownField: env('garbage') });
    expect(settingsAdapter.unpackRow(row, '')).toBeNull();
  });
});

describe('SETTINGS_WHITELIST', () => {
  test('is non-empty (at least one field shipped in v1)', () => {
    expect(SETTINGS_WHITELIST.length).toBeGreaterThan(0);
  });

  test('includes only string-typed dot-paths', () => {
    for (const key of SETTINGS_WHITELIST) {
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    }
  });
});

describe('readPath / writePath', () => {
  test('reads top-level and nested values', () => {
    const obj = { a: 1, nested: { b: 'x', deep: { c: true } } };
    expect(readPath(obj, 'a')).toBe(1);
    expect(readPath(obj, 'nested.b')).toBe('x');
    expect(readPath(obj, 'nested.deep.c')).toBe(true);
    expect(readPath(obj, 'nested.missing')).toBeUndefined();
    expect(readPath(obj, 'missing.path')).toBeUndefined();
  });

  test('writes top-level and nested, creating intermediates', () => {
    const obj: Record<string, unknown> = {};
    writePath(obj, 'a', 1);
    writePath(obj, 'nested.b', 'x');
    writePath(obj, 'nested.deep.c', true);
    expect(obj).toEqual({ a: 1, nested: { b: 'x', deep: { c: true } } });
  });

  test('writePath overwrites a non-object intermediate with a fresh object', () => {
    const obj: Record<string, unknown> = { foo: 'oops' };
    writePath(obj, 'foo.bar', 1);
    expect(obj).toEqual({ foo: { bar: 1 } });
  });

  test('writePath rejects __proto__ / constructor / prototype segments', () => {
    const obj: Record<string, unknown> = {};
    writePath(obj, '__proto__.polluted', 'bad');
    writePath(obj, 'constructor.prototype.polluted', 'bad');
    writePath(obj, 'a.prototype.b', 'bad');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(obj).toEqual({});
  });

  test('readPath rejects __proto__ / constructor / prototype segments', () => {
    const obj = { a: 1 };
    expect(readPath(obj, '__proto__')).toBeUndefined();
    expect(readPath(obj, 'constructor')).toBeUndefined();
    expect(readPath(obj, 'a.prototype')).toBeUndefined();
  });
});
