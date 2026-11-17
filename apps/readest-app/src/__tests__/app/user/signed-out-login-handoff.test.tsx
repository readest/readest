// @vitest-environment happy-dom
// Signed out, the account page hands off to the login page. It has to replace
// itself: the login page goes back to the reader beneath when it is left
// (#7567), and a /user entry left in between would send the user to /user,
// which hands off to /auth again.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProfilePage from '@/app/user/page';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  refresh: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ redirect: '/reader?ids=book1' }),
}));
vi.mock('@/hooks/useAppRouter', () => ({ useAppRouter: () => mocks.router }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: { getState: () => ({ viewStates: {} }) },
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasIAP: true } }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null, refresh: mocks.refresh }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({}) }));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({
    quotas: [],
    userProfilePlan: 'free',
    customizationPurchased: false,
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) =>
    params ? key.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(params[name] ?? '')) : key,
}));
vi.mock('@/hooks/useUserActions', () => ({ useUserActions: () => ({}) }));
vi.mock('@/hooks/useAvailablePlans', () => ({
  useAvailablePlans: () => ({ availablePlans: [], iapAvailable: true }),
}));
vi.mock('@/utils/nav', () => ({ navigateBackFromProfile: vi.fn() }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: mocks.dispatch } }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/libs/payment/iap/client', () => ({
  purchaseIAPProduct: vi.fn(),
  restoreIAPPurchases: vi.fn(),
  verifyGooglePurchaseProducts: vi.fn(),
  verifyApplePurchaseProducts: vi.fn(),
  getSubscriptionSuccessUrl: vi.fn(),
}));
vi.mock('@/libs/payment/stripe/client', () => ({}));
vi.mock('@/components/LegalLinks', () => ({ default: () => null }));
vi.mock('@/components/Spinner', () => ({ default: () => null }));
vi.mock('@/components/Toast', () => ({ Toast: () => null }));
vi.mock('@/app/user/components/Header', () => ({ default: () => null }));
vi.mock('@/app/user/components/UserInfo', () => ({ default: () => null }));
vi.mock('@/app/user/components/UsageStats', () => ({ default: () => null }));
vi.mock('@/app/user/components/PlansComparison', () => ({ default: () => null }));
vi.mock('@/app/user/components/StorageManager', () => ({ default: () => null }));
vi.mock('@/app/user/components/SharedLinksSection', () => ({ default: () => null }));
vi.mock('@/app/user/components/SyncPassphraseSection', () => ({
  SyncPassphraseSection: () => null,
}));
vi.mock('@/app/user/components/SyncCategoriesSection', () => ({
  SyncCategoriesSection: () => null,
}));
vi.mock('@/app/user/components/Checkout', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it('replaces itself with the login page when signed out, keeping the redirect', () => {
  vi.useFakeTimers();
  render(<ProfilePage />);

  act(() => vi.advanceTimersByTime(1000));

  expect(mocks.router.replace).toHaveBeenCalledWith(
    `/auth?redirect=${encodeURIComponent('/reader?ids=book1')}`,
  );
  expect(mocks.router.push).not.toHaveBeenCalled();
});
