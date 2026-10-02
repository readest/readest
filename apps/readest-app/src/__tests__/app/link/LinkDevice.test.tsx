import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

let inApp = false;
let query = 'code=RQGF-WDCF';
let user: { email: string } | null = null;
const navigateToLibraryMock = vi.fn();
const routerBackMock = vi.fn();
const useAppUrlIngressMock = vi.fn();
const useOpenDeviceLinkMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: routerBackMock }),
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user }) }));
vi.mock('@/hooks/useAppUrlIngress', () => ({ useAppUrlIngress: () => useAppUrlIngressMock() }));
vi.mock('@/hooks/useOpenDeviceLink', () => ({ useOpenDeviceLink: () => useOpenDeviceLinkMock() }));
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
  query = 'code=RQGF-WDCF';
  user = null;
  navigateToLibraryMock.mockClear();
  routerBackMock.mockClear();
  useAppUrlIngressMock.mockClear();
  useOpenDeviceLinkMock.mockClear();
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

  // The app can sit on this page (e.g. on "Your reader is linked") when the
  // next reader's sign-in link arrives: the page keeps listening for links
  // and shows the new code.
  it('listens for sign-in links while it is open', () => {
    inApp = true;
    render(<LinkDevice />);
    expect(useAppUrlIngressMock).toHaveBeenCalled();
    expect(useOpenDeviceLinkMock).toHaveBeenCalled();
  });

  it('shows the code of a sign-in link that arrives while it is open', () => {
    inApp = true;
    user = { email: 'reader@example.com' };
    const { rerender } = render(<LinkDevice />);
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('RQGF-WDCF');
    query = 'code=BCDF-GHJK';
    rerender(<LinkDevice />);
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('BCDF-GHJK');
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
