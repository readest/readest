import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';

const saveSettings = vi.fn(async () => {});

vi.mock('@tauri-apps/plugin-os', () => ({ type: vi.fn(async () => 'macos') }));

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

import KOSyncForm from '@/components/settings/integrations/KOSyncForm';

const settings = {
  kosync: {
    enabled: true,
    serverUrl: 'https://sync.example.com',
    username: 'alice',
    userkey: 'key',
    password: '',
    deviceId: 'device-1',
    deviceName: 'Readest',
    checksumMethod: 'binary',
    strategy: 'prompt',
  },
} as unknown as SystemSettings;

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ settings } as never);
});

afterEach(() => {
  cleanup();
});

describe('KOSyncForm Send Document Metadata setting', () => {
  test('defaults off and persists both toggle states', async () => {
    render(<KOSyncForm onBack={vi.fn()} />);

    const toggle = screen.getByRole('checkbox', { name: 'Send Document Metadata' });
    expect((toggle as HTMLInputElement).checked).toBe(false);

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(useSettingsStore.getState().settings.kosync.sendMetadata).toBe(true);
    });
    expect(saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ kosync: expect.objectContaining({ sendMetadata: true }) }),
    );

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(useSettingsStore.getState().settings.kosync.sendMetadata).toBe(false);
    });
    expect(saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ kosync: expect.objectContaining({ sendMetadata: false }) }),
    );
  });
});
