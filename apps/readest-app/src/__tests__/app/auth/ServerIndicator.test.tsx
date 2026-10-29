import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { writeStoredServerConfig } from '@/services/serverConfig';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => options?.[name] ?? `{{${name}}}`),
}));
vi.mock('@/components/settings/integrations/ServerSettings', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  default: () => <div data-testid='server-settings' />,
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div role='dialog'>{children}</div> : null,
}));

import ServerIndicator from '@/app/auth/components/ServerIndicator';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
});
afterEach(cleanup);

describe('ServerIndicator', () => {
  test('names Readest Cloud by default', () => {
    render(<ServerIndicator />);
    expect(screen.getByRole('button').textContent).toBe('Server: Readest Cloud');
  });

  test('names a stored custom server by host', () => {
    writeStoredServerConfig({
      v: 1,
      serverUrl: 'https://books.example.com',
      config: { supabaseUrl: 'https://books.example.com', supabaseAnonKey: 'k' },
      savedAt: 1,
    });
    render(<ServerIndicator />);
    expect(screen.getByRole('button').textContent).toBe('Server: books.example.com');
  });

  test('names a server baked in at build time', () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://baked.example.com');
    render(<ServerIndicator />);
    expect(screen.getByRole('button').textContent).toBe('Server: baked.example.com');
  });

  test('opens the server settings', () => {
    render(<ServerIndicator />);
    expect(screen.queryByTestId('server-settings')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('server-settings')).toBeTruthy();
  });
});
