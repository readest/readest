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
vi.mock('@/app/user/components/AccountActions', () => ({ default: () => null }));
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

// The library's Account menu opens these views directly; Back shows the
// account page they live on, and Back again returns to the library.
it.each([
  ['shared-links', 'shared links section'],
  ['sync', 'sync categories section'],
])('opens section=%s directly and goes back to the account page', (section, text) => {
  mocks.params = new URLSearchParams({ section, redirect: '/library' });
  render(<ProfilePage />);

  expect(screen.getByText(text)).toBeTruthy();
  expect(screen.queryByText('usage stats')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Go Back' }));
  expect(screen.queryByText(text)).toBeNull();
  expect(screen.getByText('usage stats')).toBeTruthy();
  expect(navigateBackFromProfile).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Go Back' }));
  expect(navigateBackFromProfile).toHaveBeenCalledWith(mocks.router, '/library', false);
});
