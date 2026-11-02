import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProfilePage from '@/app/user/page';

const mocks = vi.hoisted(() => ({
  customizationPurchased: false,
  refresh: vi.fn(),
  verifyGoogle: vi.fn(),
  verifyApple: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/hooks/useAppRouter', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasIAP: true } }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    token: 'test-token',
    user: { email: 'reader@example.test', user_metadata: {} },
    refresh: mocks.refresh,
  }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({}) }));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({
    quotas: [],
    userProfilePlan: 'free',
    customizationPurchased: mocks.customizationPurchased,
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
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: vi.fn() } }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/libs/payment/iap/client', () => ({
  purchaseIAPProduct: vi.fn(),
  restoreIAPPurchases: async () => [{ productId: 'readest.purchase.customization' }],
  verifyGooglePurchaseProducts: mocks.verifyGoogle,
  verifyApplePurchaseProducts: mocks.verifyApple,
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
  mocks.customizationPurchased = false;
});

it('refreshes verified restored purchases before showing the account deletion warning', async () => {
  let finishVerification: (() => void) | undefined;
  mocks.verifyGoogle.mockResolvedValue(undefined);
  mocks.verifyApple.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishVerification = resolve;
      }),
  );
  mocks.refresh.mockImplementation(async () => {
    mocks.customizationPurchased = true;
  });
  render(<ProfilePage />);

  fireEvent.click(screen.getByRole('button', { name: 'Restore Purchase' }));
  await waitFor(() => expect(mocks.verifyApple).toHaveBeenCalledTimes(1));
  expect(mocks.refresh).not.toHaveBeenCalled();
  finishVerification!();
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));
  expect(screen.getByText('This account has a paid plan or purchases.')).toBeTruthy();
});
