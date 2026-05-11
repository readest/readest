import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LibraryEmptyState from '@/app/library/components/LibraryEmptyState';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));

const useAuthMock = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

const navigateToLoginMock = vi.fn();
const routerStub = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => routerStub,
}));
vi.mock('@/utils/nav', () => ({
  navigateToLogin: (...args: unknown[]) => navigateToLoginMock(...args),
}));

const useEnvMock = vi.fn();
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => useEnvMock(),
}));

afterEach(() => {
  cleanup();
  useAuthMock.mockReset();
  navigateToLoginMock.mockReset();
  useEnvMock.mockReset();
});

describe('LibraryEmptyState', () => {
  it('renders title, desktop description, and both CTAs when logged out on desktop', () => {
    useEnvMock.mockReturnValue({ appService: { isMobile: false } });
    useAuthMock.mockReturnValue({ user: null });
    render(<LibraryEmptyState onImport={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Start your library' })).toBeTruthy();
    expect(screen.getByText(/drop a book anywhere on this window/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import Books' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in to sync your library' })).toBeTruthy();
  });

  it('renders mobile description (no drag-drop language) when appService.isMobile', () => {
    useEnvMock.mockReturnValue({ appService: { isMobile: true } });
    useAuthMock.mockReturnValue({ user: null });
    render(<LibraryEmptyState onImport={vi.fn()} />);

    expect(screen.getByText(/pick a book from your device/i)).toBeTruthy();
    expect(screen.queryByText(/drop a book anywhere on this window/i)).toBeNull();
  });

  it('hides the sync button when the user is logged in', () => {
    useEnvMock.mockReturnValue({ appService: { isMobile: false } });
    useAuthMock.mockReturnValue({ user: { id: 'stub-user' } });
    render(<LibraryEmptyState onImport={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Import Books' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in to sync your library' })).toBeNull();
  });

  it('calls onImport when the Import Books button is clicked', () => {
    useEnvMock.mockReturnValue({ appService: { isMobile: false } });
    useAuthMock.mockReturnValue({ user: null });
    const handleImport = vi.fn();
    render(<LibraryEmptyState onImport={handleImport} />);

    fireEvent.click(screen.getByRole('button', { name: 'Import Books' }));

    expect(handleImport).toHaveBeenCalledTimes(1);
  });
});
