import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type StoredServerConfig, writeStoredServerConfig } from '@/services/serverConfig';

const mocks = vi.hoisted(() => ({
  ask: vi.fn(),
  logout: vi.fn(),
  testServer: vi.fn(),
  switchServer: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { ask: mocks.ask } }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ logout: mocks.logout }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => options?.[name] ?? `{{${name}}}`),
}));
vi.mock('@/services/serverConnection', () => ({ testServer: mocks.testServer }));
vi.mock('@/services/serverSwitch', () => ({ switchServer: mocks.switchServer }));

import ServerSettings from '@/components/settings/integrations/ServerSettings';

const CONFIG = {
  supabaseUrl: 'https://books.example.com',
  supabaseAnonKey: 'anon-key',
  apiBaseUrl: 'https://books.example.com',
};

const stored = (serverUrl: string): StoredServerConfig => ({
  v: 1,
  serverUrl,
  config: { ...CONFIG, supabaseUrl: serverUrl, apiBaseUrl: serverUrl },
  savedAt: 1,
});

const chooseCustom = () =>
  fireEvent.change(screen.getByLabelText('Server'), { target: { value: 'custom' } });
const typeUrl = (url: string) =>
  fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: url } });
const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

beforeEach(() => {
  localStorage.clear();
  Object.values(mocks).forEach((m) => m.mockReset());
});
afterEach(cleanup);

describe('ServerSettings', () => {
  test('shows Readest Cloud as the active server by default', () => {
    render(<ServerSettings />);
    expect(screen.getByText('Readest Cloud', { selector: '[data-testid=active-server]' }));
  });

  test('shows the host of a stored custom server', () => {
    writeStoredServerConfig(stored('https://books.example.com'));
    render(<ServerSettings />);
    expect(screen.getByTestId('active-server').textContent).toBe('books.example.com');
  });

  test('keeps Save disabled until a test succeeds for the current input', async () => {
    mocks.testServer.mockResolvedValue({
      ok: true,
      config: CONFIG,
      authHost: 'books.example.com',
      authHostDiffers: false,
    });
    render(<ServerSettings />);
    chooseCustom();
    typeUrl('https://books.example.com');
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await screen.findByText('Connection successful');
    expect(mocks.testServer).toHaveBeenCalledWith('https://books.example.com', undefined);
    expect(saveButton().disabled).toBe(false);

    typeUrl('https://other.example.com');
    expect(saveButton().disabled).toBe(true);
  });

  test('discloses a different auth host', async () => {
    mocks.testServer.mockResolvedValue({
      ok: true,
      config: { ...CONFIG, supabaseUrl: 'https://auth.example.com' },
      authHost: 'auth.example.com',
      authHostDiffers: true,
    });
    render(<ServerSettings />);
    chooseCustom();
    typeUrl('https://books.example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await screen.findByText('Sign-in will use auth.example.com');
  });

  test.each([
    [
      { ok: false, error: 'outdated' },
      'This server does not support app setup yet. Update your Readest server',
    ],
    [{ ok: false, error: 'disabled' }, "This server doesn't allow app connections"],
    [{ ok: false, error: 'unreachable' }, 'Could not reach the server'],
    [{ ok: false, error: 'not-readest' }, 'This does not look like a Readest server'],
    [
      { ok: false, error: 'incomplete' },
      'The server did not provide its sign-in settings. Set them under Advanced',
    ],
    [
      { ok: false, error: 'auth-unreachable', authHost: 'auth.example.com' },
      'Could not reach the sign-in service at auth.example.com',
    ],
  ])('reports %o', async (result, message) => {
    mocks.testServer.mockResolvedValue(result);
    render(<ServerSettings />);
    chooseCustom();
    typeUrl('https://books.example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await screen.findByText(message);
    expect(saveButton().disabled).toBe(true);
  });

  test('rejects an invalid URL without testing', async () => {
    render(<ServerSettings />);
    chooseCustom();
    typeUrl('books example');
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await screen.findByText('Enter a valid server URL');
    expect(mocks.testServer).not.toHaveBeenCalled();
  });

  test('requires acknowledging an unencrypted http URL', async () => {
    mocks.testServer.mockResolvedValue({
      ok: true,
      config: CONFIG,
      authHost: '192.168.1.10:3000',
      authHostDiffers: false,
    });
    render(<ServerSettings />);
    chooseCustom();
    typeUrl('http://192.168.1.10:3000');
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await screen.findByText(/This connection is not encrypted/);
    expect(mocks.testServer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('I trust this network'));
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await screen.findByText('Connection successful');
    expect(mocks.testServer).toHaveBeenCalledWith('http://192.168.1.10:3000', undefined);
  });

  test('passes advanced overrides to the test', async () => {
    mocks.testServer.mockResolvedValue({ ok: false, error: 'unreachable' });
    render(<ServerSettings />);
    chooseCustom();
    typeUrl('https://books.example.com');
    fireEvent.change(screen.getByLabelText('Supabase URL'), {
      target: { value: 'https://auth.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await waitFor(() =>
      expect(mocks.testServer).toHaveBeenCalledWith('https://books.example.com', {
        supabaseUrl: 'https://auth.example.com',
      }),
    );
  });

  test('switches only after the user confirms', async () => {
    mocks.testServer.mockResolvedValue({
      ok: true,
      config: CONFIG,
      authHost: 'books.example.com',
      authHostDiffers: false,
    });
    render(<ServerSettings />);
    chooseCustom();
    typeUrl('https://books.example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    await screen.findByText('Connection successful');

    mocks.ask.mockResolvedValueOnce(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(1));
    expect(mocks.ask.mock.calls[0]![0]).toMatch(/signed out/);
    expect(mocks.switchServer).not.toHaveBeenCalled();

    mocks.ask.mockResolvedValueOnce(true);
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.switchServer).toHaveBeenCalledTimes(1));
    expect(mocks.switchServer.mock.calls[0]![0]).toMatchObject({
      logout: mocks.logout,
      next: { v: 1, serverUrl: 'https://books.example.com', config: CONFIG },
    });
  });

  test('switches back to Readest Cloud after confirmation', async () => {
    writeStoredServerConfig(stored('https://books.example.com'));
    mocks.ask.mockResolvedValue(true);
    render(<ServerSettings />);
    fireEvent.change(screen.getByLabelText('Server'), { target: { value: 'cloud' } });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Readest Cloud' }));
    await waitFor(() => expect(mocks.switchServer).toHaveBeenCalledTimes(1));
    expect(mocks.switchServer.mock.calls[0]![0]).toMatchObject({ next: null });
  });
});
