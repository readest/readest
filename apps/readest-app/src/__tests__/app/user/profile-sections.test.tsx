// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProfilePage from '@/app/user/page';
import { navigateBackFromProfile } from '@/utils/nav';

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  refresh: vi.fn(),
  hasIAP: false,
  iapAvailable: false,
  userProfilePlan: 'plus' as string,
  customizationPurchased: false,
  giftOnly: false,
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params }));
vi.mock('@/hooks/useAppRouter', () => ({ useAppRouter: () => mocks.router }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: { getState: () => ({ viewStates: {} }) },
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasIAP: mocks.hasIAP } }),
}));
const authRefresh = vi.hoisted(() => mocks.refresh);
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    token: 'test-token',
    user: { email: 'reader@example.test', user_metadata: {} },
    refresh: authRefresh,
  }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({}) }));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({
    quotas: [],
    userProfilePlan: mocks.userProfilePlan,
    customizationPurchased: mocks.customizationPurchased,
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useUserActions', () => ({
  useUserActions: () => ({
    signingOut: false,
    handleResetPassword: vi.fn(),
    handleUpdateEmail: vi.fn(),
    handleConfirmDelete: vi.fn(),
  }),
}));
vi.mock('@/hooks/useAvailablePlans', () => ({
  useAvailablePlans: () => ({ availablePlans: [], iapAvailable: mocks.iapAvailable }),
}));
vi.mock('@/utils/nav', () => ({ navigateBackFromProfile: vi.fn() }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: vi.fn() } }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/libs/payment/iap/client', () => ({}));
vi.mock('@/libs/payment/stripe/client', () => ({}));
vi.mock('@/libs/payment/gift/client', () => ({
  claimGiftCards: vi.fn().mockResolvedValue(0),
  fetchGiftPrices: vi.fn().mockResolvedValue([]),
  fetchGiftCards: vi.fn(async () => ({
    sent: [],
    received: [],
    giftPlan: 'free',
    giftActiveUntil: null,
    giftOnly: mocks.giftOnly,
  })),
}));
vi.mock('@/components/LegalLinks', () => ({ default: () => <div>legal links</div> }));
vi.mock('@/components/Spinner', () => ({ default: () => null }));
vi.mock('@/components/Toast', () => ({ Toast: () => null }));
vi.mock('@/app/user/components/Header', () => ({
  default: ({ onGoBack }: { onGoBack: () => void }) => (
    <button type='button' onClick={onGoBack}>
      Go Back
    </button>
  ),
}));
vi.mock('@/app/user/components/UserInfo', () => ({ default: () => <div>user info</div> }));
vi.mock('@/app/user/components/UsageStats', () => ({ default: () => <div>usage stats</div> }));
vi.mock('@/app/user/components/PlansComparison', () => ({
  default: () => <div>plans comparison</div>,
}));
vi.mock('@/app/user/components/StorageManager', () => ({
  default: () => <div>storage manager</div>,
}));
vi.mock('@/app/user/components/SharedLinksSection', () => ({
  default: () => <div>shared links section</div>,
}));
vi.mock('@/app/user/components/SyncPassphraseSection', () => ({
  SyncPassphraseSection: () => <div>sync passphrase section</div>,
}));
vi.mock('@/app/user/components/SyncCategoriesSection', () => ({
  SyncCategoriesSection: () => <div>sync categories section</div>,
}));
vi.mock('@/app/user/components/Checkout', () => ({ default: () => null }));
vi.mock('@/app/user/components/gift/GiftCardsSection', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.params = new URLSearchParams();
  mocks.hasIAP = false;
  mocks.iapAvailable = false;
  mocks.userProfilePlan = 'plus';
  mocks.customizationPurchased = false;
  mocks.giftOnly = false;
});

const goBack = () => fireEvent.click(screen.getByRole('button', { name: 'Go Back' }));

it.each([
  ['shared-links', 'shared links section'],
  ['security', 'Login & Security'],
] as const)('opens section=%s directly and goes back to the Subscription page', (section, expectedText) => {
  mocks.params = new URLSearchParams({ section, redirect: '/library' });
  render(<ProfilePage />);

  expect(screen.getByText(expectedText)).toBeTruthy();
  expect(screen.queryByText('usage stats')).toBeNull();
  expect(screen.queryByText('plans comparison')).toBeNull();

  goBack();
  expect(screen.queryByText(expectedText)).toBeNull();
  expect(screen.getByText('usage stats')).toBeTruthy();
  expect(screen.getByText('plans comparison')).toBeTruthy();
  expect(navigateBackFromProfile).not.toHaveBeenCalled();

  goBack();
  expect(navigateBackFromProfile).toHaveBeenCalledWith(mocks.router, '/library', false);
});

it('opens section=sync directly and goes back to the opener', () => {
  mocks.params = new URLSearchParams({ section: 'sync', redirect: '/library' });
  render(<ProfilePage />);

  expect(screen.getByText('sync categories section')).toBeTruthy();
  goBack();
  expect(navigateBackFromProfile).toHaveBeenCalledWith(mocks.router, '/library', false);
});

it('opens Manage Storage from the Subscription page and goes back to it', () => {
  mocks.params = new URLSearchParams({ redirect: '/library' });
  render(<ProfilePage />);

  fireEvent.click(screen.getByRole('button', { name: 'Manage Storage' }));
  expect(screen.getByText('storage manager')).toBeTruthy();
  expect(screen.queryByText('plans comparison')).toBeNull();

  goBack();
  // Files removed there change the storage quota.
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('storage manager')).toBeNull();
  expect(screen.getByText('plans comparison')).toBeTruthy();
  expect(navigateBackFromProfile).not.toHaveBeenCalled();
});

it('renders Manage Billing alongside Redeem Gift Card for paid web plans and hides Manage Billing when giftOnly', async () => {
  mocks.params = new URLSearchParams();
  mocks.userProfilePlan = 'plus';
  mocks.giftOnly = false;
  render(<ProfilePage />);

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Manage Billing' })).toBeTruthy();
  });
  expect(screen.getByRole('button', { name: 'Redeem Gift Card' })).toBeTruthy();

  cleanup();
  mocks.giftOnly = true;
  await act(async () => {
    render(<ProfilePage />);
  });

  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Manage Billing' })).toBeNull();
  });
  expect(screen.getByRole('button', { name: 'Redeem Gift Card' })).toBeTruthy();
});

it('renders Restore Purchase alongside Redeem Gift Card on IAP builds', () => {
  mocks.hasIAP = true;
  mocks.iapAvailable = true;
  mocks.params = new URLSearchParams();
  render(<ProfilePage />);

  expect(screen.getByRole('button', { name: 'Restore Purchase' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Redeem Gift Card' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Manage Billing' })).toBeNull();
});
