import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

let inApp = false;
const navigateToLibraryMock = vi.fn();
const routerBackMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: routerBackMock }),
  useSearchParams: () => new URLSearchParams('code=RQGF-WDCF'),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (k: string) => k }));
vi.mock('@/services/environment', async (orig) => {
  const actual = await orig<typeof import('@/services/environment')>();
  return { ...actual, isTauriAppPlatform: () => inApp };
});
vi.mock('@/utils/nav', () => ({
  navigateToLogin: vi.fn(),
  navigateToLibrary: (...a: unknown[]) => navigateToLibraryMock(...a),
}));

import LinkDevice from '@/app/link/LinkDevice';

beforeEach(() => {
  navigateToLibraryMock.mockClear();
  routerBackMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('LinkDevice', () => {
  // A phone browser is usually not signed in to Readest, and on iOS a social
  // sign-in started there finishes in the app, so the page offers the app,
  // which is already signed in.
  it('offers to open the code in the app when the browser is not signed in', () => {
    inApp = false;
    render(<LinkDevice />);
    expect(screen.getByText('Open in app').closest('a')?.getAttribute('href')).toBe(
      'readest://link?code=RQGF-WDCF',
    );
    expect(screen.getByText('Sign in to continue')).toBeTruthy();
  });

  it('signs in within the app', () => {
    inApp = true;
    render(<LinkDevice />);
    expect(screen.queryByText('Open in app')).toBeNull();
    expect(screen.getByText('Sign in to continue')).toBeTruthy();
  });

  it('goes back to the page the app was on when the link arrived', () => {
    inApp = true;
    window.history.pushState({}, '', '/link?code=RQGF-WDCF');
    render(<LinkDevice />);
    fireEvent.click(screen.getByLabelText('Go Back'));
    expect(routerBackMock).toHaveBeenCalled();
    expect(navigateToLibraryMock).not.toHaveBeenCalled();
  });

  it('goes to the library when the link launched the app', () => {
    inApp = true;
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    render(<LinkDevice />);
    fireEvent.click(screen.getByLabelText('Go Back'));
    expect(navigateToLibraryMock).toHaveBeenCalled();
    expect(routerBackMock).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
