// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { md5 } from 'js-md5';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';

vi.mock('@tauri-apps/plugin-os', () => ({ type: vi.fn(async () => 'linux') }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/services/bookorbit/BookOrbitClient', () => ({
  BookOrbitClient: vi.fn(function () {
    return { connect: async () => ({ success: true }) };
  }),
}));

import BookOrbitForm from '@/components/settings/integrations/BookOrbitForm';

const settings = {
  bookorbit: {
    enabled: false,
    serverUrl: 'https://books.example.com',
    username: 'alice',
    userkey: '',
    password: '',
    deviceName: 'Readest',
    strategy: 'prompt',
    syncProgress: true,
    syncNotes: true,
    syncStats: true,
    syncBookStates: true,
  },
} as unknown as SystemSettings;

beforeEach(() => {
  useSettingsStore.setState({ settings, saveSettings: vi.fn(async () => {}) } as never);
});

afterEach(() => cleanup());

const connect = async (fields: { password: string; apiKey?: string }) => {
  render(<BookOrbitForm onBack={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: fields.password } });
  if (fields.apiKey !== undefined) {
    fireEvent.change(screen.getByLabelText('API Key (optional)'), {
      target: { value: fields.apiKey },
    });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(useSettingsStore.getState().settings.bookorbit.userkey).not.toBe(''));
  return useSettingsStore.getState().settings.bookorbit;
};

describe('BookOrbitForm connect', () => {
  // KOReader sync still signs in with the KOReader credentials; the key only
  // replaces the account password the audiobook API used to need (#7508).
  test('keeps an API key in place of the password', async () => {
    const saved = await connect({ password: 'secret', apiKey: '  bok_key  ' });

    expect(saved.apiKey).toBe('bok_key');
    expect(saved.password).toBe('');
    expect(saved.userkey).toBe(md5('secret'));
  });

  // Servers before BookOrbit 3.8 have no API keys: leaving the field empty
  // must store what a connection always stored.
  test('keeps the password when no API key is given', async () => {
    const saved = await connect({ password: 'secret' });

    expect(saved.password).toBe('secret');
    expect(saved.apiKey).toBeFalsy();
  });
});
