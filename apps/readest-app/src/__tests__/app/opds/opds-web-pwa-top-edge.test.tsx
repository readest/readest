// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * #7887: iOS 26+ blurs the top of a Home Screen web app unless an opaque fixed
 * or sticky box covers that edge. The OPDS header bar sat in a transparent
 * `relative` box, so the catalog's back, home and search controls went soft.
 * In an installed web app the box is now sticky and opaque; elsewhere the
 * header keeps its old box.
 */

const h = vi.hoisted(() => ({
  appService: { appPlatform: 'web', hasSafeAreaInset: true, hasRoundedWindow: false },
  router: { push: () => {}, replace: () => {}, back: () => {} },
  searchParams: new URLSearchParams('url=https://catalog.example/feed.xml'),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  useSearchParams: () => h.searchParams,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService, envConfig: {} }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => {} }));
vi.mock('@/hooks/useTransferQueue', () => ({ useTransferQueue: () => {} }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => {} }));
vi.mock('@/hooks/useQuotaStats', () => ({ useQuotaStats: () => ({ userProfilePlan: 'free' }) }));
vi.mock('@/hooks/useLibrary', () => ({ useLibrary: () => ({ libraryLoaded: false }) }));
vi.mock('@/app/library/hooks/useLibraryFileSync', () => ({ useLibraryFileSync: () => {} }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: null, isRoundedWindow: false, isIPhoneDuo: false }),
}));
vi.mock('@/app/opds/components/PublicationView', () => ({ PublicationView: () => null }));
vi.mock('@/app/opds/components/FeedView', () => ({ FeedView: () => null }));
vi.mock('@/app/opds/components/SearchView', () => ({ SearchView: () => null }));
vi.mock('@/app/opds/utils/opdsReq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/opds/utils/opdsReq')>()),
  fetchWithAuth: vi.fn(() => new Promise<Response>(() => {})),
}));
vi.mock('@/app/opds/components/Navigation', () => ({
  Navigation: () => <header data-testid='opds-nav' />,
}));

const { default: BrowserPage } = await import('@/app/opds/page');

const headerBox = () => screen.getByTestId('opds-nav').parentElement!.classList;

afterEach(cleanup);

describe('OPDS header box at the top edge (#7887)', () => {
  it('is sticky and opaque in an installed web app', () => {
    h.appService = { appPlatform: 'web', hasSafeAreaInset: true, hasRoundedWindow: false };
    render(<BrowserPage />);
    expect(headerBox().contains('sticky')).toBe(true);
    expect(headerBox().contains('top-0')).toBe(true);
    expect(headerBox().contains('bg-base-100')).toBe(true);
  });

  it('stays relative and transparent in a browser tab', () => {
    h.appService = { appPlatform: 'web', hasSafeAreaInset: false, hasRoundedWindow: false };
    render(<BrowserPage />);
    expect(headerBox().contains('relative')).toBe(true);
    expect(headerBox().contains('bg-base-100')).toBe(false);
  });

  it('stays relative and transparent in the native app', () => {
    h.appService = { appPlatform: 'tauri', hasSafeAreaInset: true, hasRoundedWindow: false };
    render(<BrowserPage />);
    expect(headerBox().contains('relative')).toBe(true);
    expect(headerBox().contains('bg-base-100')).toBe(false);
  });
});
