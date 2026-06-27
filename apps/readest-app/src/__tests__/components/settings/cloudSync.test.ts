import { describe, expect, test } from 'vitest';
import { withActiveCloudProvider } from '@/components/settings/integrations/cloudSync';
import { isCloudSyncInPlan } from '@/utils/access';
import type { SystemSettings } from '@/types/settings';

const base = {
  webdav: { enabled: true, serverUrl: 'https://dav', username: 'u', password: 'p', rootPath: '/' },
  googleDrive: { enabled: true, accountLabel: 'a@b.com' },
} as unknown as SystemSettings;

describe('withActiveCloudProvider', () => {
  test('enabling WebDAV disables Google Drive (exclusive)', () => {
    const next = withActiveCloudProvider(base, 'webdav');
    expect(next.webdav.enabled).toBe(true);
    expect(next.googleDrive.enabled).toBe(false);
  });

  test('enabling Google Drive disables WebDAV (exclusive)', () => {
    const next = withActiveCloudProvider(base, 'gdrive');
    expect(next.webdav.enabled).toBe(false);
    expect(next.googleDrive.enabled).toBe(true);
  });

  test('null disables both', () => {
    const next = withActiveCloudProvider(base, null);
    expect(next.webdav.enabled).toBe(false);
    expect(next.googleDrive.enabled).toBe(false);
  });

  test('leaves the rest of each provider config untouched', () => {
    const next = withActiveCloudProvider(base, 'gdrive');
    expect(next.webdav.serverUrl).toBe('https://dav');
    expect(next.googleDrive.accountLabel).toBe('a@b.com');
  });
});

describe('isCloudSyncInPlan', () => {
  test('any paid plan can use cloud sync', () => {
    expect(isCloudSyncInPlan('plus')).toBe(true);
    expect(isCloudSyncInPlan('pro')).toBe(true);
    expect(isCloudSyncInPlan('purchase')).toBe(true); // lifetime
  });

  test('free plan cannot', () => {
    expect(isCloudSyncInPlan('free')).toBe(false);
  });
});
