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

  test('pack ∘ unpack round-trips WebDAV connection fields, dropping per-device state', () => {
    const record: SettingsRemoteRecord = {
      name: 'singleton',
      patch: {
        webdav: {
          enabled: true,
          serverUrl: 'https://dav.example.com',
          username: 'alice',
          password: 'hunter2',
          rootPath: '/Books',
          deviceId: 'this-device',
          lastSyncedAt: 123,
        },
      } as unknown as Partial<SystemSettings>,
    };
    const fields = settingsAdapter.pack(record);
    expect(fields['webdav.serverUrl']).toBe('https://dav.example.com');
    expect(fields['webdav.username']).toBe('alice');
    expect(fields['webdav.password']).toBe('hunter2');
    expect(fields['webdav.rootPath']).toBe('/Books');
    // Per-device bookkeeping must not ship.
    expect(fields['webdav.enabled']).toBeUndefined();
    expect(fields['webdav.deviceId']).toBeUndefined();
    expect(fields['webdav.lastSyncedAt']).toBeUndefined();

    const out = settingsAdapter.unpack(fields);
    expect(out.patch.webdav?.serverUrl).toBe('https://dav.example.com');
    expect(out.patch.webdav?.username).toBe('alice');
    expect(out.patch.webdav?.password).toBe('hunter2');
    expect(out.patch.webdav?.rootPath).toBe('/Books');
    expect(out.patch.webdav?.enabled).toBeUndefined();
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

  test('pack ∘ unpack round-trips S3 connection fields, dropping per-device state', () => {
    const record: SettingsRemoteRecord = {
      name: 'singleton',
      patch: {
        s3: {
          enabled: true,
          endpoint: 'https://acc.r2.cloudflarestorage.com',
          region: 'auto',
          bucket: 'readest',
          accessKeyId: 'AKIA',
          secretAccessKey: 'shh',
          deviceId: 'this-device',
          lastSyncedAt: 123,
          providerSelectedAt: 456,
        },
      } as unknown as Partial<SystemSettings>,
    };
    const fields = settingsAdapter.pack(record);
    expect(fields['s3.endpoint']).toBe('https://acc.r2.cloudflarestorage.com');
    expect(fields['s3.region']).toBe('auto');
    expect(fields['s3.bucket']).toBe('readest');
    expect(fields['s3.accessKeyId']).toBe('AKIA');
    expect(fields['s3.secretAccessKey']).toBe('shh');
    // Per-device bookkeeping must not ship.
    expect(fields['s3.enabled']).toBeUndefined();
    expect(fields['s3.deviceId']).toBeUndefined();
    expect(fields['s3.lastSyncedAt']).toBeUndefined();
    expect(fields['s3.providerSelectedAt']).toBeUndefined();

    const out = settingsAdapter.unpack(fields);
    expect(out.patch.s3?.endpoint).toBe('https://acc.r2.cloudflarestorage.com');
    expect(out.patch.s3?.accessKeyId).toBe('AKIA');
    expect(out.patch.s3?.secretAccessKey).toBe('shh');
    expect(out.patch.s3?.enabled).toBeUndefined();
  });

  test('declares encryptedFields covering kosync / readwise / hardcover / webdav / s3 credentials only (not serverUrl / endpoint)', () => {
    expect(settingsAdapter.encryptedFields).toEqual([
      'kosync.username',
      'kosync.userkey',
      'kosync.password',
      'readwise.accessToken',
      'hardcover.accessToken',
      'webdav.username',
      'webdav.password',
      's3.accessKeyId',
      's3.secretAccessKey',
    ]);
  });

  test('kosync.serverUrl is plaintext (not in encryptedFields)', () => {
    expect(settingsAdapter.encryptedFields).not.toContain('kosync.serverUrl');
  });

  test('webdav.serverUrl and webdav.rootPath are plaintext (not in encryptedFields)', () => {
    expect(settingsAdapter.encryptedFields).not.toContain('webdav.serverUrl');
    expect(settingsAdapter.encryptedFields).not.toContain('webdav.rootPath');
  });

  test('s3.endpoint / region / bucket are plaintext (not in encryptedFields)', () => {
    expect(settingsAdapter.encryptedFields).not.toContain('s3.endpoint');
    expect(settingsAdapter.encryptedFields).not.toContain('s3.region');
    expect(settingsAdapter.encryptedFields).not.toContain('s3.bucket');
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

  test('includes the dictionary settings paths (PR 6 — whole-field LWW)', () => {
    expect(SETTINGS_WHITELIST).toContain('dictionarySettings.providerOrder');
    expect(SETTINGS_WHITELIST).toContain('dictionarySettings.providerEnabled');
    expect(SETTINGS_WHITELIST).toContain('dictionarySettings.webSearches');
    // Dictionary popup font size (#4443) follows the user across devices.
    expect(SETTINGS_WHITELIST).toContain('dictionarySettings.fontScale');
  });

  test('includes the S3 connection fields but not its per-device bookkeeping', () => {
    expect(SETTINGS_WHITELIST).toContain('s3.endpoint');
    expect(SETTINGS_WHITELIST).toContain('s3.region');
    expect(SETTINGS_WHITELIST).toContain('s3.bucket');
    expect(SETTINGS_WHITELIST).toContain('s3.accessKeyId');
    expect(SETTINGS_WHITELIST).toContain('s3.secretAccessKey');
    expect(SETTINGS_WHITELIST).not.toContain('s3.enabled');
    expect(SETTINGS_WHITELIST).not.toContain('s3.deviceId');
    expect(SETTINGS_WHITELIST).not.toContain('s3.providerSelectedAt');
  });

  test('does NOT sync dictionarySettings.defaultProviderId (per-device last-used tab)', () => {
    expect(SETTINGS_WHITELIST).not.toContain('dictionarySettings.defaultProviderId');
  });

  test('syncs library-scope proofread rules (issue #4700 — PC rules not reaching mobile)', () => {
    expect(SETTINGS_WHITELIST).toContain('globalViewSettings.proofreadRules');
  });

  test('syncs WebDAV connection + credentials (issue #4810 — credentials not synced)', () => {
    expect(SETTINGS_WHITELIST).toContain('webdav.serverUrl');
    expect(SETTINGS_WHITELIST).toContain('webdav.username');
    expect(SETTINGS_WHITELIST).toContain('webdav.password');
    expect(SETTINGS_WHITELIST).toContain('webdav.rootPath');
  });

  test('does NOT sync per-device WebDAV bookkeeping fields', () => {
    // enabled / deviceId / lastSyncedAt / sync sub-toggles are per-device
    // state — syncing them would auto-arm a fresh device or rotate its id.
    expect(SETTINGS_WHITELIST).not.toContain('webdav.enabled');
    expect(SETTINGS_WHITELIST).not.toContain('webdav.deviceId');
    expect(SETTINGS_WHITELIST).not.toContain('webdav.lastSyncedAt');
  });
});

describe('settingsAdapter proofread rules', () => {
  test('pack ∘ unpack round-trips globalViewSettings.proofreadRules', () => {
    const proofreadRules = [
      {
        id: 'r1',
        scope: 'library',
        pattern: 'colour',
        replacement: 'color',
        enabled: true,
        isRegex: false,
        caseSensitive: true,
        order: 1000,
        wholeWord: true,
      },
    ];
    const record: SettingsRemoteRecord = {
      name: 'singleton',
      patch: {
        globalViewSettings: { proofreadRules },
      } as unknown as Partial<SystemSettings>,
    };
    const fields = settingsAdapter.pack(record);
    expect(fields['globalViewSettings.proofreadRules']).toEqual(proofreadRules);
    const out = settingsAdapter.unpack(fields);
    expect(out.patch.globalViewSettings?.proofreadRules).toEqual(proofreadRules);
  });

  test('unpackRow reconstructs proofread rules from a CRDT envelope', () => {
    const proofreadRules = [
      {
        id: 'r1',
        scope: 'library',
        pattern: 'teh',
        replacement: 'the',
        enabled: true,
        isRegex: false,
        caseSensitive: false,
        order: 1000,
        wholeWord: true,
      },
    ];
    const row = makeRow({ 'globalViewSettings.proofreadRules': env(proofreadRules) });
    const out = settingsAdapter.unpackRow(row, '');
    expect(out).not.toBeNull();
    expect(out!.patch.globalViewSettings?.proofreadRules).toEqual(proofreadRules);
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
