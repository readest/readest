// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  markConnectionForgetPublish: vi.fn(),
}));

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

  test('no Forget when nothing is saved', () => {
    setConnection(kind, forgotten);
    render(<Form />);

    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
  });
});
