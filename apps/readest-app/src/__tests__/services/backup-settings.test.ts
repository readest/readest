import { describe, it, expect } from 'vitest';
import {
  BACKUP_SETTINGS_BLACKLIST,
  BACKUP_SETTINGS_CREDENTIAL_FIELDS,
  sanitizeSettingsForBackup,
  mergeRestoredSettings,
} from '@/services/backupService';
import { SystemSettings } from '@/types/settings';

/**
 * Tests for global-settings backup support (issue #4098):
 * - sanitizeSettingsForBackup strips device-specific / sync-bookkeeping
 *   fields and (by default) credentials before writing settings.json.
 * - mergeRestoredSettings deep-merges a restored snapshot onto the
 *   current device settings, preserving stripped fields.
 */

/** Read an arbitrary (possibly stripped) field as a plain record. */
const rec = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

function makeSettings(overrides: Partial<SystemSettings> = {}): SystemSettings {
  return {
    version: 5,
    migrationVersion: 3,
    localBooksDir: '/Users/me/Books',
    customRootDir: '/Users/me/readest',
    externalLibraryFolders: ['/Users/me/Duokan', '/Users/me/Calibre'],
    keepLogin: true,
    screenBrightness: 0.7,
    autoScreenBrightness: false,
    lastOpenBooks: ['book-1', 'book-2'],
    savedBookCoverForLockScreen: 'cover',
    savedBookCoverForLockScreenPath: '/Users/me/cover.png',
    libraryViewMode: 'grid',
    librarySortBy: 'title',
    libraryColumns: 4,
    replicaDeviceId: 'device-uuid-aaa',
    lastSyncedAtBooks: 1234,
    lastSyncedAtConfigs: 1235,
    lastSyncedAtNotes: 1236,
    lastSyncedAtReplicas: { book: 'hlc-1' },
    opdsCatalogs: [
      {
        id: 'cat-1',
        title: 'Cat',
        url: 'https://example.com/opds',
        username: 'opds-user',
        password: 'opds-pass',
      },
    ],
    kosync: {
      enabled: true,
      serverUrl: 'https://kosync.example',
      username: 'kuser',
      userkey: 'kkey',
      password: 'kpass',
      deviceId: 'kosync-device-id',
      deviceName: 'My Phone',
      checksumMethod: 'binary',
      strategy: 'prompt',
    },
    webdav: {
      enabled: true,
      serverUrl: 'https://dav.example',
      username: 'wuser',
      password: 'wpass',
      rootPath: '/',
      deviceId: 'webdav-device-id',
      lastSyncedAt: 666,
    },
    readwise: { enabled: true, accessToken: 'rw-token', lastSyncedAt: 999 },
    hardcover: { enabled: false, accessToken: 'hc-token', lastSyncedAt: 888 },
    googleDrive: {
      enabled: true,
      accountLabel: 'me@gmail.com',
      strategy: 'silent',
      deviceId: 'gdrive-device-id',
      lastSyncedAt: 777,
    },
    aiSettings: {
      enabled: true,
      provider: 'ollama',
      ollamaBaseUrl: 'http://localhost',
      aiGatewayApiKey: 'ai-secret-key',
      openrouterApiKey: 'or-secret-key',
      openrouterBaseUrl: 'https://openrouter.ai/api/v1',
    },
    globalReadSettings: {
      sideBarWidth: '20%',
      customThemes: [{ name: 'mytheme' }],
    },
    globalViewSettings: {
      userStylesheet: 'body { color: red }',
      uiLanguage: 'en',
    },
    ...overrides,
  } as unknown as SystemSettings;
}

describe('sanitizeSettingsForBackup - blacklist', () => {
  it('strips device-specific filesystem paths', () => {
    const out = rec(sanitizeSettingsForBackup(makeSettings()));
    expect(out['localBooksDir']).toBeUndefined();
    expect(out['customRootDir']).toBeUndefined();
    expect(out['externalLibraryFolders']).toBeUndefined();
    expect(out['savedBookCoverForLockScreenPath']).toBeUndefined();
  });

  it('strips per-device identity fields', () => {
    const out = rec(sanitizeSettingsForBackup(makeSettings()));
    expect(out['replicaDeviceId']).toBeUndefined();
    expect(rec(out['kosync'])['deviceId']).toBeUndefined();
    expect(rec(out['googleDrive'])['deviceId']).toBeUndefined();
    // Non-identity Drive settings still travel with the backup.
    expect(rec(out['googleDrive'])['enabled']).toBe(true);
    // WebDAV device identity and cursor stay on the device; restoring
    // them onto a second device would duplicate WebDAV sync identity.
    expect(rec(out['webdav'])['deviceId']).toBeUndefined();
    expect(rec(out['webdav'])['lastSyncedAt']).toBeUndefined();
    expect(rec(out['webdav'])['serverUrl']).toBe('https://dav.example');
  });

  it('strips sync cursors', () => {
    const out = rec(sanitizeSettingsForBackup(makeSettings()));
    expect(out['lastSyncedAtBooks']).toBeUndefined();
    expect(out['lastSyncedAtConfigs']).toBeUndefined();
    expect(out['lastSyncedAtNotes']).toBeUndefined();
    expect(out['lastSyncedAtReplicas']).toBeUndefined();
    expect(rec(out['readwise'])['lastSyncedAt']).toBeUndefined();
    expect(rec(out['hardcover'])['lastSyncedAt']).toBeUndefined();
    expect(rec(out['googleDrive'])['lastSyncedAt']).toBeUndefined();
  });

  it('strips readestCloud.disabledAt but keeps readestCloud.enabled', () => {
    // disabledAt is device-local: it records when THIS device stopped
    // writing native sync rows, and anchors the mixed-fleet probe. A value
    // restored from another device's backup would corrupt that probe.
    // enabled must survive restore, matching the other providers' `enabled`
    // flags (see issue #5062).
    const out = sanitizeSettingsForBackup(
      makeSettings({ readestCloud: { enabled: false, disabledAt: 1234 } }),
    );
    expect(out.readestCloud?.disabledAt).toBeUndefined();
    expect(out.readestCloud?.enabled).toBe(false);
  });

  it('strips transient runtime state', () => {
    const out = rec(sanitizeSettingsForBackup(makeSettings()));
    expect(out['lastOpenBooks']).toBeUndefined();
    expect(out['screenBrightness']).toBeUndefined();
  });

  it('strips schema versioning fields', () => {
    const out = rec(sanitizeSettingsForBackup(makeSettings()));
    expect(out['version']).toBeUndefined();
    expect(out['migrationVersion']).toBeUndefined();
  });

  it('keeps preferences, layout and customization fields', () => {
    const out = sanitizeSettingsForBackup(makeSettings());
    expect(out.keepLogin).toBe(true);
    expect(out.libraryViewMode).toBe('grid');
    expect(out.libraryColumns).toBe(4);
    expect(out.kosync.serverUrl).toBe('https://kosync.example');
    expect(out.kosync.deviceName).toBe('My Phone');
    expect(out.globalReadSettings.customThemes).toEqual([{ name: 'mytheme' }]);
    expect(out.globalViewSettings.userStylesheet).toBe('body { color: red }');
  });

  it('does not mutate the input settings', () => {
    const input = makeSettings();
    const snapshot = JSON.stringify(input);
    sanitizeSettingsForBackup(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('every blacklisted path is a string', () => {
    expect(BACKUP_SETTINGS_BLACKLIST.every((p) => typeof p === 'string')).toBe(true);
  });
});

describe('sanitizeSettingsForBackup - credentials', () => {
  it('strips credentials by default', () => {
    const out = sanitizeSettingsForBackup(makeSettings());
    expect(rec(out.kosync)['username']).toBeUndefined();
    expect(rec(out.kosync)['userkey']).toBeUndefined();
    expect(rec(out.kosync)['password']).toBeUndefined();
    expect(rec(out.readwise)['accessToken']).toBeUndefined();
    expect(rec(out.hardcover)['accessToken']).toBeUndefined();
    expect(rec(out.aiSettings)['aiGatewayApiKey']).toBeUndefined();
    expect(rec(out.aiSettings)['openrouterApiKey']).toBeUndefined();
    // non-credential aiSettings fields (e.g. base URL) survive
    expect(rec(out.aiSettings)['openrouterBaseUrl']).toBe('https://openrouter.ai/api/v1');
    expect(out.opdsCatalogs[0]!.username).toBeUndefined();
    expect(out.opdsCatalogs[0]!.password).toBeUndefined();
  });

  it('keeps non-credential OPDS catalog fields when stripping credentials', () => {
    const out = sanitizeSettingsForBackup(makeSettings());
    expect(out.opdsCatalogs[0]!.id).toBe('cat-1');
    expect(out.opdsCatalogs[0]!.url).toBe('https://example.com/opds');
  });

  it('keeps credentials when includeCredentials is true', () => {
    const out = sanitizeSettingsForBackup(makeSettings(), { includeCredentials: true });
    expect(out.kosync.password).toBe('kpass');
    expect(out.readwise.accessToken).toBe('rw-token');
    expect(out.hardcover.accessToken).toBe('hc-token');
    expect(rec(out.aiSettings)['aiGatewayApiKey']).toBe('ai-secret-key');
    expect(rec(out.aiSettings)['openrouterApiKey']).toBe('or-secret-key');
    expect(out.opdsCatalogs[0]!.username).toBe('opds-user');
    expect(out.opdsCatalogs[0]!.password).toBe('opds-pass');
  });

  it('still strips blacklist fields even when credentials are included', () => {
    const out = rec(sanitizeSettingsForBackup(makeSettings(), { includeCredentials: true }));
    expect(out['localBooksDir']).toBeUndefined();
    expect(out['replicaDeviceId']).toBeUndefined();
  });

  it('every credential path is a string', () => {
    expect(BACKUP_SETTINGS_CREDENTIAL_FIELDS.every((p) => typeof p === 'string')).toBe(true);
  });
});

describe('mergeRestoredSettings', () => {
  it('overrides current scalar values with the backup snapshot', () => {
    const current = makeSettings({ libraryViewMode: 'list', libraryColumns: 2 });
    const backup = sanitizeSettingsForBackup(makeSettings({ libraryViewMode: 'grid' }));
    const merged = mergeRestoredSettings(current, backup);
    expect(merged.libraryViewMode).toBe('grid');
    expect(merged.libraryColumns).toBe(4);
  });

  it('preserves device-specific fields absent from the backup', () => {
    const current = makeSettings({
      localBooksDir: '/device/Books',
      version: 9,
      migrationVersion: 7,
    });
    const backup = sanitizeSettingsForBackup(makeSettings());
    const merged = mergeRestoredSettings(current, backup);
    expect(merged.localBooksDir).toBe('/device/Books');
    expect(merged.version).toBe(9);
    expect(merged.migrationVersion).toBe(7);
    expect(merged.replicaDeviceId).toBe('device-uuid-aaa');
  });

  it('deep-merges nested objects, keeping current-only nested keys', () => {
    const current = makeSettings();
    const backup = sanitizeSettingsForBackup(
      makeSettings({
        kosync: {
          enabled: true,
          serverUrl: 'https://new-kosync.example',
          username: 'kuser',
          userkey: 'kkey',
          password: 'kpass',
          deviceId: 'kosync-device-id',
          deviceName: 'Restored Name',
          checksumMethod: 'binary',
          strategy: 'prompt',
        },
      }),
    );
    const merged = mergeRestoredSettings(current, backup);
    // serverUrl/deviceName come from the backup, deviceId stays the device's own
    expect(merged.kosync.serverUrl).toBe('https://new-kosync.example');
    expect(merged.kosync.deviceName).toBe('Restored Name');
    expect(merged.kosync.deviceId).toBe('kosync-device-id');
  });

  it('replaces arrays wholesale rather than concatenating', () => {
    const current = makeSettings({
      globalReadSettings: {
        customThemes: [{ name: 'device-theme-a' }, { name: 'device-theme-b' }],
      } as SystemSettings['globalReadSettings'],
    });
    const backup = sanitizeSettingsForBackup(
      makeSettings({
        globalReadSettings: {
          customThemes: [{ name: 'restored-theme' }],
        } as SystemSettings['globalReadSettings'],
      }),
    );
    const merged = mergeRestoredSettings(current, backup);
    expect(merged.globalReadSettings.customThemes).toEqual([{ name: 'restored-theme' }]);
  });

  it('does not mutate the current or backup objects', () => {
    const current = makeSettings();
    const backup = sanitizeSettingsForBackup(makeSettings({ libraryViewMode: 'list' }));
    const currentSnapshot = JSON.stringify(current);
    const backupSnapshot = JSON.stringify(backup);
    mergeRestoredSettings(current, backup);
    expect(JSON.stringify(current)).toBe(currentSnapshot);
    expect(JSON.stringify(backup)).toBe(backupSnapshot);
  });
});
