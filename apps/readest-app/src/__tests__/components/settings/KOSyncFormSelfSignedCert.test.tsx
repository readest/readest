import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';

vi.mock('@tauri-apps/plugin-os', () => ({ type: vi.fn(async () => 'macos') }));

vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => true,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ saveSettings: vi.fn(async () => {}) }) },
    appService: null,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/utils/settingsSync', () => ({
  broadcastGlobalSettings: vi.fn(),
}));

import KOSyncForm from '@/components/settings/integrations/KOSyncForm';

const renderNewConnection = (allowSelfSignedCert?: boolean) => {
  const settings = {
    kosync: {
      enabled: false,
      serverUrl: 'https://sync.example.com',
      username: '',
      userkey: '',
      password: '',
      deviceId: 'device-1',
      deviceName: 'Readest',
      checksumMethod: 'binary',
      strategy: 'prompt',
      ...(allowSelfSignedCert === undefined ? {} : { allowSelfSignedCert }),
    },
  } as unknown as SystemSettings;
  useSettingsStore.setState({ settings } as never);
  render(<KOSyncForm onBack={vi.fn()} />);
  return screen.getByRole('checkbox', {
    name: 'Allow Self-Signed Certificate',
  }) as HTMLInputElement;
};

afterEach(() => {
  cleanup();
});

describe('KOSyncForm self-signed certificate switch', () => {
  test('is on for a connection with no saved choice', () => {
    expect(renderNewConnection().checked).toBe(true);
  });

  test('stays off when the user turned it off', () => {
    expect(renderNewConnection(false).checked).toBe(false);
  });
});
