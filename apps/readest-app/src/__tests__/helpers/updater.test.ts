import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import semver from 'semver';

// ── Mocks for Tauri and internal modules ─────────────────────────
const mockCheck = vi.fn();
const mockOsType = vi.fn();
const mockTauriFetch = vi.fn();

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => mockCheck(...args),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  type: () => mockOsType(),
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => mockTauriFetch(...args),
}));

// WebviewWindow is used with `new`, so the mock must be a constructor
const mockWebviewWindowOnce = vi.fn();
const MockWebviewWindowLastArgs: unknown[][] = [];
vi.mock('@tauri-apps/api/webviewWindow', () => {
  return {
    WebviewWindow: class MockWebviewWindow {
      once = mockWebviewWindowOnce;
      constructor(...args: unknown[]) {
        MockWebviewWindowLastArgs.push(args);
      }
    },
  };
});

const mockSetUpdaterWindowVisible = vi.fn();
vi.mock('@/components/UpdaterWindow', () => ({
  setUpdaterWindowVisible: (...args: unknown[]) => mockSetUpdaterWindowVisible(...args),
}));

let mockIsTauriAppPlatform = false;
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => mockIsTauriAppPlatform,
}));

let mockAppVersion = '1.0.0';
vi.mock('@/utils/version', () => ({
  getAppVersion: () => mockAppVersion,
}));

vi.mock('@/services/constants', () => ({
  CHECK_UPDATE_INTERVAL_SEC: 86400,
  READEST_UPDATER_FILE: 'https://example.com/latest.json',
  READEST_CHANGELOG_FILE: 'https://example.com/release-notes.json',
}));

import {
  checkForAppUpdates,
  checkAppReleaseNotes,
  setLastShownReleaseNotesVersion,
  getLastShownReleaseNotesVersion,
} from '@/helpers/updater';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockIsTauriAppPlatform = false;
  mockAppVersion = '1.0.0';
  MockWebviewWindowLastArgs.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helper to create a dummy TranslationFunc ─────────────────────
const dummyTranslate = (key: string) => key;

describe('updater', () => {
  // ── setLastShownReleaseNotesVersion / getLastShownReleaseNotesVersion ──
  describe('release notes version tracking', () => {
    test('getLastShownReleaseNotesVersion returns empty string when not set', () => {
      expect(getLastShownReleaseNotesVersion()).toBe('');
    });

    test('setLastShownReleaseNotesVersion stores value in localStorage', () => {
      setLastShownReleaseNotesVersion('2.0.0');
      expect(getLastShownReleaseNotesVersion()).toBe('2.0.0');
    });

    test('overwrites previous value', () => {
      setLastShownReleaseNotesVersion('1.0.0');
      setLastShownReleaseNotesVersion('2.0.0');
      expect(getLastShownReleaseNotesVersion()).toBe('2.0.0');
    });
  });

  // ── checkForAppUpdates ─────────────────────────────────────────
  describe('checkForAppUpdates', () => {
    test('skips check when auto-check and interval has not elapsed', async () => {
      const now = Date.now();
      localStorage.setItem('lastAppUpdateCheck', now.toString());

      const result = await checkForAppUpdates(dummyTranslate, true);

      expect(result).toBe(false);
      expect(mockCheck).not.toHaveBeenCalled();
    });

    test('proceeds with check when interval has elapsed', async () => {
      const pastTime = Date.now() - 86400 * 1000 - 1000;
      localStorage.setItem('lastAppUpdateCheck', pastTime.toString());

      mockOsType.mockReturnValue('macos');
      mockCheck.mockResolvedValue(null);

      const result = await checkForAppUpdates(dummyTranslate, true);

      expect(result).toBe(false);
      expect(mockCheck).toHaveBeenCalled();
    });

    test('proceeds when no previous check timestamp', async () => {
      mockOsType.mockReturnValue('macos');
      mockCheck.mockResolvedValue(null);

      const result = await checkForAppUpdates(dummyTranslate, true);

      expect(result).toBe(false);
      expect(mockCheck).toHaveBeenCalled();
    });

    test('always checks when isAutoCheck is false', async () => {
      const now = Date.now();
      localStorage.setItem('lastAppUpdateCheck', now.toString());

      mockOsType.mockReturnValue('macos');
      mockCheck.mockResolvedValue(null);

      const result = await checkForAppUpdates(dummyTranslate, false);

      expect(result).toBe(false);
      expect(mockCheck).toHaveBeenCalled();
    });

    test('returns true and shows update window when update available on macOS', async () => {
      mockOsType.mockReturnValue('macos');
      mockCheck.mockResolvedValue({ version: '2.0.0' });

      const result = await checkForAppUpdates(dummyTranslate, false);

      expect(result).toBe(true);
      expect(MockWebviewWindowLastArgs).toHaveLength(1);
      expect(MockWebviewWindowLastArgs[0]![0]).toBe('updater');
      expect(MockWebviewWindowLastArgs[0]![1]).toEqual(
        expect.objectContaining({
          url: '/updater?latestVersion=2.0.0',
          title: 'Software Update',
        }),
      );
    });

    test('handles windows platform', async () => {
      mockOsType.mockReturnValue('windows');
      mockCheck.mockResolvedValue(null);

      const result = await checkForAppUpdates(dummyTranslate, false);
      expect(result).toBe(false);
    });

    test('handles linux platform', async () => {
      mockOsType.mockReturnValue('linux');
      mockCheck.mockResolvedValue({ version: '3.0.0' });

      const result = await checkForAppUpdates(dummyTranslate, false);
      expect(result).toBe(true);
    });

    test('checks Android update via fetch when OS is android', async () => {
      mockOsType.mockReturnValue('android');
      mockAppVersion = '1.0.0';

      mockTauriFetch.mockResolvedValue({
        json: () =>
          Promise.resolve({
            version: '2.0.0',
            platforms: { 'android-arm64': {} },
          }),
      });

      const result = await checkForAppUpdates(dummyTranslate, false);

      expect(result).toBe(true);
      expect(mockSetUpdaterWindowVisible).toHaveBeenCalledWith(true, '2.0.0', '1.0.0');
    });

    test('Android check with android-universal platform', async () => {
      mockOsType.mockReturnValue('android');
      mockAppVersion = '1.0.0';

      mockTauriFetch.mockResolvedValue({
        json: () =>
          Promise.resolve({
            version: '2.0.0',
            platforms: { 'android-universal': {} },
          }),
      });

      const result = await checkForAppUpdates(dummyTranslate, false);

      expect(result).toBe(true);
      expect(mockSetUpdaterWindowVisible).toHaveBeenCalled();
    });

    test('Android returns false when version is not newer', async () => {
      mockOsType.mockReturnValue('android');
      mockAppVersion = '2.0.0';

      mockTauriFetch.mockResolvedValue({
        json: () =>
          Promise.resolve({
            version: '1.0.0',
            platforms: { 'android-arm64': {} },
          }),
      });

      const result = await checkForAppUpdates(dummyTranslate, false);

      expect(result).toBe(false);
      expect(mockSetUpdaterWindowVisible).not.toHaveBeenCalled();
    });

    test('Android fetch failure throws error', async () => {
      mockOsType.mockReturnValue('android');

      mockTauriFetch.mockRejectedValue(new Error('Network error'));

      await expect(checkForAppUpdates(dummyTranslate, false)).rejects.toThrow(
        'Failed to fetch Android update info',
      );
    });

    test('returns false for unsupported OS types', async () => {
      mockOsType.mockReturnValue('ios');

      const result = await checkForAppUpdates(dummyTranslate, false);

      expect(result).toBe(false);
    });

    test('stores check timestamp in localStorage', async () => {
      mockOsType.mockReturnValue('macos');
      mockCheck.mockResolvedValue(null);

      const before = Date.now();
      await checkForAppUpdates(dummyTranslate, false);
      const after = Date.now();

      const stored = parseInt(localStorage.getItem('lastAppUpdateCheck')!, 10);
      expect(stored).toBeGreaterThanOrEqual(before);
      expect(stored).toBeLessThanOrEqual(after);
    });
  });

  // ── checkAppReleaseNotes ───────────────────────────────────────
  describe('checkAppReleaseNotes', () => {
    test('shows release notes when current version is newer than last shown', async () => {
      mockAppVersion = '2.0.0';
      setLastShownReleaseNotesVersion('1.0.0');

      const mockFetchFn = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetchFn);

      const result = await checkAppReleaseNotes(true);

      expect(result).toBe(true);
      expect(mockSetUpdaterWindowVisible).toHaveBeenCalledWith(true, '2.0.0', '1.0.0', false);
    });

    test('returns false when current version equals last shown', async () => {
      mockAppVersion = '1.0.0';
      setLastShownReleaseNotesVersion('1.0.0');

      const result = await checkAppReleaseNotes(true);

      expect(result).toBe(false);
    });

    test('sets current version as last shown when no previous version recorded', async () => {
      mockAppVersion = '1.5.0';

      const result = await checkAppReleaseNotes(true);

      expect(result).toBe(false);
      expect(getLastShownReleaseNotesVersion()).toBe('1.5.0');
    });

    test('shows release notes when isAutoCheck is false regardless of version comparison', async () => {
      mockAppVersion = '1.0.0';
      setLastShownReleaseNotesVersion('1.0.0');

      const mockFetchFn = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetchFn);

      const result = await checkAppReleaseNotes(false);

      expect(result).toBe(true);
      expect(mockSetUpdaterWindowVisible).toHaveBeenCalled();
    });

    test('returns false when fetch fails', async () => {
      mockAppVersion = '2.0.0';
      setLastShownReleaseNotesVersion('1.0.0');

      const mockFetchFn = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetchFn);

      const result = await checkAppReleaseNotes(true);

      expect(result).toBe(false);
    });

    test('returns false when fetch response is not ok', async () => {
      mockAppVersion = '2.0.0';
      setLastShownReleaseNotesVersion('1.0.0');

      const mockFetchFn = vi.fn().mockResolvedValue({ ok: false });
      vi.stubGlobal('fetch', mockFetchFn);

      const result = await checkAppReleaseNotes(true);

      expect(result).toBe(false);
    });

    test('uses tauri fetch when on tauri platform', async () => {
      mockIsTauriAppPlatform = true;
      mockAppVersion = '2.0.0';
      setLastShownReleaseNotesVersion('1.0.0');

      mockTauriFetch.mockResolvedValue({ ok: true });

      const result = await checkAppReleaseNotes(true);

      expect(result).toBe(true);
      expect(mockTauriFetch).toHaveBeenCalledWith('https://example.com/release-notes.json');
    });
  });

  // ── semver usage validation ────────────────────────────────────
  describe('semver gt (sanity checks for the logic used)', () => {
    test('2.0.0 is greater than 1.0.0', () => {
      expect(semver.gt('2.0.0', '1.0.0')).toBe(true);
    });

    test('1.0.0 is not greater than 2.0.0', () => {
      expect(semver.gt('1.0.0', '2.0.0')).toBe(false);
    });

    test('equal versions return false', () => {
      expect(semver.gt('1.0.0', '1.0.0')).toBe(false);
    });
  });
});
