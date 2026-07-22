import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';
import { useFileSyncStore } from '@/store/fileSyncStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Regression for #5062: every provider's Disconnect used to call the old
 * exclusive-provider activation helper, which wrote `enabled: false` to ALL
 * FOUR backend slices (that era's "no third-party provider active" meaning).
 * Under multi-select that silently turns off every OTHER mirror too —
 * disconnecting Google Drive would also stop WebDAV.
 *
 * This renders the real GoogleDriveForm component and clicks its actual
 * Disconnect button (not just the underlying `withCloudProviderEnabled`
 * reducer) so a regression in the component's wiring — not only in the
 * shared helper — would be caught.
 */

const saveSettings = vi.fn(async () => {});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ saveSettings }) },
    appService: null,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/utils/settingsSync', () => ({
  broadcastGlobalSettings: vi.fn(),
}));

vi.mock('@/services/sync/providers/gdrive/googleDriveConnect', () => ({
  runGoogleDriveConnect: vi.fn(),
  runGoogleDriveDisconnect: vi.fn(async () => {}),
}));

import GoogleDriveForm from '@/components/settings/integrations/GoogleDriveForm';

const bothEnabled = {
  version: 1,
  webdav: {
    enabled: true,
    serverUrl: 'https://dav.example.com',
    username: 'alice',
    password: 'hunter2',
    rootPath: '/',
  },
  googleDrive: { enabled: true, accountLabel: 'alice@example.com' },
} as unknown as SystemSettings;

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ settings: bothEnabled } as never);
  useLibraryStore.setState({ library: [], libraryLoaded: true } as never);
  useFileSyncStore.setState({ byKind: {}, activeKind: null, lastErrorByKind: {} });
});

afterEach(() => {
  cleanup();
});

describe('GoogleDriveForm disconnect (#5062 regression)', () => {
  test('disconnecting Google Drive leaves WebDAV enabled', async () => {
    render(<GoogleDriveForm />);

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => {
      expect(useSettingsStore.getState().settings.googleDrive.enabled).toBe(false);
    });

    // The bug: the old disconnect call disabled EVERY backend, not just gdrive.
    expect(useSettingsStore.getState().settings.webdav.enabled).toBe(true);
    // WebDAV's config must also survive untouched (only its own Disconnect tears it down).
    expect(useSettingsStore.getState().settings.webdav.serverUrl).toBe('https://dav.example.com');
  });
});
