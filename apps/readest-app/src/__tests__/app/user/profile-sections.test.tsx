// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProfilePage from '@/app/user/page';
import { navigateBackFromProfile } from '@/utils/nav';

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params }));
vi.mock('@/hooks/useAppRouter', () => ({ useAppRouter: () => mocks.router }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: { getState: () => ({ viewStates: {} }) },
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { hasIAP: false } }) }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    token: 'test-token',
    user: { email: 'reader@example.test', user_metadata: {} },
    refresh: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({}) }));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ quotas: [], userProfilePlan: 'free', customizationPurchased: false }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useUserActions', () => ({ useUserActions: () => ({ signingOut: false }) }));
vi.mock('@/hooks/useAvailablePlans', () => ({
  useAvailablePlans: () => ({ availablePlans: [], iapAvailable: false }),
}));
vi.mock('@/utils/nav', () => ({ navigateBackFromProfile: vi.fn() }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: vi.fn() } }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/libs/payment/iap/client', () => ({}));
vi.mock('@/libs/payment/stripe/client', () => ({}));
vi.mock('@/libs/payment/gift/client', () => ({
  claimGiftCards: vi.fn().mockResolvedValue(0),
  fetchGiftPrices: vi.fn().mockResolvedValue([]),
  fetchGiftCards: vi.fn().mockResolvedValue({ giftPlan: 'free', giftActiveUntil: null }),
}));
vi.mock('@/components/LegalLinks', () => ({ default: () => null }));
vi.mock('@/components/Spinner', () => ({ default: () => null }));
vi.mock('@/components/Toast', () => ({ Toast: () => null }));
vi.mock('@/app/user/components/Header', () => ({
  default: ({ onGoBack }: { onGoBack: () => void }) => (
    <button type='button' onClick={onGoBack}>
      Go Back
    </button>
  ),
}));
vi.mock('@/app/user/components/UserInfo', () => ({ default: () => null }));
vi.mock('@/app/user/components/UsageStats', () => ({ default: () => <div>usage stats</div> }));
vi.mock('@/app/user/components/PlansComparison', () => ({ default: () => null }));
vi.mock('@/app/user/components/AccountActions', () => ({
  default: ({ onManageSync }: { onManageSync: () => void }) => (
    <button type='button' onClick={onManageSync}>
      Manage Sync
    </button>
  ),
}));
vi.mock('@/app/user/components/StorageManager', () => ({ default: () => null }));
vi.mock('@/app/user/components/SharedLinksSection', () => ({
  default: () => <div>shared links section</div>,
}));
vi.mock('@/app/user/components/SyncPassphraseSection', () => ({
  SyncPassphraseSection: () => null,
}));
vi.mock('@/app/user/components/SyncDevicesSection', () => ({ SyncDevicesSection: () => null }));
vi.mock('@/app/user/components/SyncCategoriesSection', () => ({
  SyncCategoriesSection: () => <div>sync categories section</div>,
}));
vi.mock('@/app/user/components/Checkout', () => ({ default: () => null }));
vi.mock('@/app/user/components/gift/GiftCardsSection', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const goBack = () => fireEvent.click(screen.getByRole('button', { name: 'Go Back' }));

// The library's Sync Settings opens Manage Sync directly, and Back returns to
// the library without stopping on the account page.
it('goes back to the library from section=sync', () => {
  mocks.params = new URLSearchParams({ section: 'sync', redirect: '/library' });
  render(<ProfilePage />);

  expect(screen.getByText('sync categories section')).toBeTruthy();
  expect(screen.queryByText('usage stats')).toBeNull();

  goBack();
  expect(navigateBackFromProfile).toHaveBeenCalledWith(mocks.router, '/library', false);
});

it('goes back to the account page from Manage Sync opened there', () => {
  mocks.params = new URLSearchParams({ redirect: '/library' });
  render(<ProfilePage />);

  fireEvent.click(screen.getByRole('button', { name: 'Manage Sync' }));
  expect(screen.getByText('sync categories section')).toBeTruthy();

  goBack();
  expect(screen.queryByText('sync categories section')).toBeNull();
  expect(screen.getByText('usage stats')).toBeTruthy();
  expect(navigateBackFromProfile).not.toHaveBeenCalled();
});

it('opens the account page for section=shared-links', () => {
  mocks.params = new URLSearchParams({ section: 'shared-links', redirect: '/library' });
  render(<ProfilePage />);

  expect(screen.queryByText('shared links section')).toBeNull();
  expect(screen.getByText('usage stats')).toBeTruthy();
});
