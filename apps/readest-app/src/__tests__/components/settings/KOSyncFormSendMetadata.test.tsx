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

describe('KOSyncForm checksum method', () => {
  test('offers filename matching, explains legacy fallback, and persists both methods', async () => {
    render(<KOSyncForm onBack={vi.fn()} />);

    const select = screen.getByRole('combobox', { name: 'Checksum Method' });
    expect((select as HTMLSelectElement).value).toBe('binary');
    expect(screen.getByRole('option', { name: 'File Name' })).toHaveProperty('value', 'filename');

    fireEvent.change(select, { target: { value: 'filename' } });
    await waitFor(() => {
      expect(saveSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({
          kosync: expect.objectContaining({ checksumMethod: 'filename' }),
        }),
      );
    });
    expect(
      screen.getByText(
        'File Name uses the original filename, including its extension. Books without a saved original filename use File Content.',
      ),
    ).toBeTruthy();

    fireEvent.change(select, { target: { value: 'binary' } });
    await waitFor(() => {
      expect(saveSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ kosync: expect.objectContaining({ checksumMethod: 'binary' }) }),
      );
    });
  });
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
