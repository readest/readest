import { describe, expect, test } from 'vitest';
import { withActiveCloudProvider } from '@/components/settings/integrations/cloudSync';
import { CLOUD_SYNC_REQUIRES_PREMIUM, isCloudSyncAllowed, isCloudSyncInPlan } from '@/utils/access';
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

  // Selecting a third-party provider hands it the book-file channel:
  // native Readest Cloud uploads gate off, so without syncBooks the books
  // would back up nowhere. Activation therefore turns syncBooks on.
  describe('syncBooks auto-enable on activation', () => {
    const inactive = {
      webdav: { enabled: false, serverUrl: 'https://dav', syncBooks: false },
      googleDrive: { enabled: false, syncBooks: false },
    } as unknown as SystemSettings;

    test('activating a disabled provider turns its syncBooks on', () => {
      const next = withActiveCloudProvider(inactive, 'webdav');
      expect(next.webdav.syncBooks).toBe(true);
      expect(next.googleDrive.syncBooks).toBe(false);
    });

    test('activating gdrive turns only gdrive syncBooks on', () => {
      const next = withActiveCloudProvider(inactive, 'gdrive');
      expect(next.googleDrive.syncBooks).toBe(true);
      expect(next.webdav.syncBooks).toBe(false);
    });

    test('re-activating an already-active provider respects an explicit syncBooks opt-out', () => {
      const active = {
        webdav: { enabled: true, syncBooks: false },
        googleDrive: { enabled: false },
      } as unknown as SystemSettings;
      const next = withActiveCloudProvider(active, 'webdav');
      expect(next.webdav.syncBooks).toBe(false);
    });

    test('deactivating a provider leaves its syncBooks untouched', () => {
      const active = {
        webdav: { enabled: true, syncBooks: true },
        googleDrive: { enabled: false, syncBooks: false },
      } as unknown as SystemSettings;
      const next = withActiveCloudProvider(active, null);
      expect(next.webdav.syncBooks).toBe(true);
    });
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

describe('isCloudSyncAllowed (temporary ungate)', () => {
  test('cloud sync is currently ungated for every plan, including free', () => {
    // The feature ships ungated while it stabilises. When the paywall is
    // restored (flip CLOUD_SYNC_REQUIRES_PREMIUM back to true), update this.
    expect(CLOUD_SYNC_REQUIRES_PREMIUM).toBe(false);
    expect(isCloudSyncAllowed('free')).toBe(true);
    expect(isCloudSyncAllowed('plus')).toBe(true);
  });
});
