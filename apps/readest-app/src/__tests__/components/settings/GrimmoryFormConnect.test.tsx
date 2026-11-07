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
    // Nothing was saved, so the form stays unconnected.
    expect(useSettingsStore.getState().settings.grimmory.enabled).toBe(false);
    expect(useSettingsStore.getState().settings.grimmory.password).toBe('');
    // The spinner is gone (the button has its label back) and a new password
    // can be tried.
    fireEvent.change(screen.getByPlaceholderText('Your Password'), {
      target: { value: 'secret' },
    });
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  test('shows the connection only once it is stored, and a failure keeps other changes', async () => {
    let rejectSave: (error: Error) => void = () => {};
    useSettingsStore.setState({
      saveSettings: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectSave = reject;
          }),
      ),
    } as never);
    render(<GrimmoryForm onBack={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Your Password'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(useSettingsStore.getState().saveSettings).toHaveBeenCalled());

    // While the save is pending the form isn't connected yet.
    expect(useSettingsStore.getState().settings.grimmory.enabled).toBe(false);
    // Something else changes a setting meanwhile.
    const current = useSettingsStore.getState().settings;
    useSettingsStore.setState({
      settings: { ...current, grimmory: { ...current.grimmory, syncStats: false } },
    });
    rejectSave(new Error('disk full'));

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect(useSettingsStore.getState().settings.grimmory.syncStats).toBe(false);
    expect(useSettingsStore.getState().settings.grimmory.enabled).toBe(false);
  });

  test('a setting changed while the connection is saved is kept and stored', async () => {
    let resolveSave: () => void = () => {};
    const saveSettings = vi
      .fn<(env: unknown, settings: SystemSettings) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    useSettingsStore.setState({ saveSettings } as never);
    render(<GrimmoryForm onBack={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Your Password'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());

    // Something else changes a setting while the write is pending.
    const current = useSettingsStore.getState().settings;
    useSettingsStore.setState({
      settings: { ...current, grimmory: { ...current.grimmory, syncStats: false } },
    });
    resolveSave();

    await waitFor(() => expect(useSettingsStore.getState().settings.grimmory.enabled).toBe(true));
    expect(useSettingsStore.getState().settings.grimmory.syncStats).toBe(false);
    const stored = saveSettings.mock.calls.at(-1)?.[1];
    expect(stored?.grimmory).toMatchObject({ enabled: true, password: 'secret', syncStats: false });
  });
});
