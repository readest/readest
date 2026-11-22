// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useSettingsStore } from '@/store/settingsStore';

/**
 * #7799: Disconnect keeps a WebDAV / S3 connection so a reconnect is one
 * click, so the connect form offers Forget to remove the saved server
 * address and login. Renders the real forms and clicks the real button.
 */

const saveSettings = vi.fn(async () => {});
const ask = vi.fn(async () => true);

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ saveSettings, ask }) },
    appService: { ask },
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/utils/settingsSync', () => ({
  broadcastGlobalSettings: vi.fn(),
}));

vi.mock('@/services/sync/replicaSettingsSync', () => ({
  publishConnectionForget: vi.fn(async () => {}),
}));

// A Connect whose server never answers, to hold it pending.
vi.mock('@/services/sync/providers/webdav/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/sync/providers/webdav/client')>()),
  checkConnection: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@/services/sync/providers/s3/S3Provider', () => ({
  createS3Provider: () => ({ list: () => new Promise(() => {}) }),
}));

import { publishConnectionForget } from '@/services/sync/replicaSettingsSync';
import WebDAVForm from '@/components/settings/integrations/WebDAVForm';
import S3Form from '@/components/settings/integrations/S3Form';

const forms = [
  {
    kind: 'webdav' as const,
    Form: WebDAVForm,
    saved: {
      serverUrl: 'https://dav.example.com',
      username: 'alice',
      password: 'hunter2',
      rootPath: '/Books',
    },
    forgotten: { serverUrl: '', username: '', password: '', rootPath: '/' },
    inputs: { 'webdav-server-url': '', 'webdav-username': '', 'webdav-password': '' },
  },
  {
    kind: 's3' as const,
    Form: S3Form,
    saved: {
      endpoint: 'https://s3.example.com',
      region: 'eu-west-1',
      bucket: 'books',
      accessKeyId: 'AKID',
      secretAccessKey: 'SECRET',
    },
    forgotten: { endpoint: '', region: 'auto', bucket: '', accessKeyId: '', secretAccessKey: '' },
    inputs: {
      's3-endpoint': '',
      's3-bucket': '',
      's3-access-key-id': '',
      's3-secret-access-key': '',
    },
  },
];

const setConnection = (kind: 'webdav' | 's3', values: object, enabled = false) =>
  useSettingsStore.setState({
    settings: { version: 1, [kind]: { enabled, deviceId: 'dev-1', ...values } },
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  ask.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe.each(forms)('$kind connect form: Forget (#7799)', ({
  kind,
  Form,
  saved,
  forgotten,
  inputs,
}) => {
  test('Forget clears the saved connection here and empties the form', async () => {
    setConnection(kind, saved);
    render(<Form />);

    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));

    await waitFor(() => {
      expect(useSettingsStore.getState().settings[kind]).toMatchObject(forgotten);
    });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().settings[kind]).toMatchObject({ deviceId: 'dev-1' });
    for (const [id, value] of Object.entries(inputs)) {
      expect((document.getElementById(id) as HTMLInputElement).value).toBe(value);
    }
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
  });

  test('cancelling the confirmation keeps the connection', async () => {
    ask.mockResolvedValue(false);
    setConnection(kind, saved);
    render(<Form />);

    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));

    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().settings[kind]).toMatchObject(saved);
  });

  test('an open form drops the saved values when the connection is forgotten elsewhere', () => {
    setConnection(kind, saved);
    render(<Form />);

    // Another window's broadcast, or a pull from a device that forgot it.
    act(() => setConnection(kind, forgotten));

    for (const [id, value] of Object.entries(inputs)) {
      expect((document.getElementById(id) as HTMLInputElement).value).toBe(value);
    }
  });

  test('Forget is disabled while a Connect is pending', () => {
    setConnection(kind, saved);
    render(<Form />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(screen.getByRole('button', { name: 'Forget' })).toHaveProperty('disabled', true);
  });

  test('Connect is disabled while a Forget is running', async () => {
    vi.mocked(publishConnectionForget).mockImplementationOnce(() => new Promise(() => {}));
    setConnection(kind, saved);
    render(<Form />);

    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    await waitFor(() => {
      expect(useSettingsStore.getState().settings[kind]).toMatchObject(forgotten);
    });
    // Another server typed in before the Forget's upload finished.
    for (const id of Object.keys(inputs)) {
      fireEvent.change(document.getElementById(id)!, {
        target: { value: 'https://x.example.com' },
      });
    }

    expect(screen.getByRole('button', { name: 'Connect' })).toHaveProperty('disabled', true);
  });

  test('no Forget when nothing is saved', () => {
    setConnection(kind, forgotten);
    render(<Form />);

    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
  });
});
