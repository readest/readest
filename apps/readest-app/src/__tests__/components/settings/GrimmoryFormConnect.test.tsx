import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';

vi.mock('@tauri-apps/plugin-os', () => ({ type: vi.fn(async () => 'linux') }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/services/grimmory/GrimmoryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/grimmory/GrimmoryClient')>()),
  GrimmoryClient: vi.fn(function () {
    return { connect: async () => ({ success: true }) };
  }),
}));

import GrimmoryForm from '@/components/settings/integrations/GrimmoryForm';

const settings = {
  grimmory: {
    enabled: false,
    serverUrl: 'https://books.example.com',
    username: 'alice',
    password: '',
    strategy: 'prompt',
    syncProgress: true,
    syncNotes: true,
    syncStats: true,
    syncBookStates: true,
  },
} as unknown as SystemSettings;

beforeEach(() => {
  useSettingsStore.setState({
    settings,
    setSettings: vi.fn(),
    saveSettings: vi.fn(async () => {
      throw new Error('disk full');
    }),
  } as never);
});

afterEach(() => cleanup());

describe('GrimmoryForm connect', () => {
  test('a failed save after connecting shows an error and frees the Connect button', async () => {
    const toast = vi.spyOn(eventDispatcher, 'dispatch');
    render(<GrimmoryForm onBack={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Your Password'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'toast',
        expect.objectContaining({ type: 'error', message: 'Failed to connect: disk full' }),
      ),
    );
    // The spinner is gone (the button has its label back) and a new password
    // can be tried.
    fireEvent.change(screen.getByPlaceholderText('Your Password'), {
      target: { value: 'secret' },
    });
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
