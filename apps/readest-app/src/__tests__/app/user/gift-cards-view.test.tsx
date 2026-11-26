// @vitest-environment happy-dom
// The account page opens the Gift Cards view from a Stripe return. An IAP
// build sells gifts through its store only, even while the store is still
// being checked: Stripe must never show up inside an App Store or Play build.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProfilePage from '@/app/user/page';

const STRIPE_RETURN = { section: 'gifts', session_id: 'cs_returning' };

const mocks = vi.hoisted(() => ({
  fetchGiftPrices: vi.fn().mockResolvedValue([]),
  fetchGiftCards: vi.fn(),
  profilePlan: 'free' as string,
  createStripeCheckoutSession: vi.fn(),
  createStripePortalSession: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  sectionProps: vi.fn(),
  plansProps: vi.fn(),
  accountProps: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params }));
vi.mock('@/hooks/useAppRouter', () => ({ useAppRouter: () => mocks.router }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: { getState: () => ({ viewStates: {} }) },
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasIAP: true } }),
}));
const authRefresh = vi.hoisted(() => vi.fn());
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    token: 'test-token',
    user: { email: 'reader@example.test', user_metadata: {} },
    // Stable, like AuthContext's useCallback: a new one each render loops the page's claim effect.
    refresh: authRefresh,
  }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: vi.fn() }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({}) }));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({
    quotas: [],
    userProfilePlan: mocks.profilePlan,
    customizationPurchased: false,
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useUserActions', () => ({ useUserActions: () => ({}) }));
// The store check hasn't finished: iapAvailable is still false.
vi.mock('@/hooks/useAvailablePlans', () => ({
  useAvailablePlans: () => ({ availablePlans: [], iapAvailable: false }),
}));
vi.mock('@/utils/nav', () => ({ navigateBackFromProfile: vi.fn() }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: vi.fn() } }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/libs/payment/iap/client', () => ({}));
vi.mock('@/libs/payment/stripe/client', () => ({
  createStripeCheckoutSession: mocks.createStripeCheckoutSession,
  createStripePortalSession: mocks.createStripePortalSession,
  redirectToStripeCheckout: vi.fn(),
  redirectToStripePortal: vi.fn(),
  handleStripeCheckoutError: vi.fn(),
}));
vi.mock('@/libs/payment/gift/client', () => ({
  claimGiftCards: vi.fn().mockResolvedValue(0),
  fetchGiftPrices: mocks.fetchGiftPrices,
  fetchGiftCards: mocks.fetchGiftCards.mockResolvedValue({
    sent: [],
    received: [],
    giftPlan: 'free',
    giftActiveUntil: null,
    giftOnly: false,
  }),
}));
vi.mock('@/components/LegalLinks', () => ({ default: () => <div>legal links</div> }));
vi.mock('@/components/Spinner', () => ({ default: () => null }));
vi.mock('@/components/Toast', () => ({ Toast: () => null }));
vi.mock('@/app/user/components/Header', () => ({
  default: ({ onGoBack }: { onGoBack: () => void }) => (
    <button type='button' onClick={onGoBack}>
      back
    </button>
  ),
}));
vi.mock('@/app/user/components/UserInfo', () => ({ default: () => <div>account block</div> }));
vi.mock('@/app/user/components/UsageStats', () => ({
  default: () => <div>usage stats</div>,
}));
vi.mock('@/app/user/components/PlansComparison', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.plansProps(props);
    return null;
  },
}));
vi.mock('@/app/user/components/AccountActions', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.accountProps(props);
    return null;
  },
}));
vi.mock('@/app/user/components/StorageManager', () => ({ default: () => null }));
vi.mock('@/app/user/components/SharedLinksSection', () => ({ default: () => null }));
vi.mock('@/app/user/components/SyncPassphraseSection', () => ({
  SyncPassphraseSection: () => null,
}));
vi.mock('@/app/user/components/SyncCategoriesSection', () => ({
  SyncCategoriesSection: () => null,
}));
vi.mock('@/app/user/components/Checkout', () => ({ default: () => null }));
vi.mock('@/app/user/components/gift/GiftCardsSection', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.sectionProps(props);
    return <div>gift cards view</div>;
  },
}));

afterEach(() => {
  cleanup();
  mocks.profilePlan = 'free';
  vi.clearAllMocks();
  mocks.params = new URLSearchParams(STRIPE_RETURN);
  window.history.replaceState(null, '', '/');
});

mocks.params = new URLSearchParams(STRIPE_RETURN);

it('opens the Gift Cards view from a Stripe return and sells through the store on an IAP build', () => {
  render(<ProfilePage />);

  expect(screen.getByText('gift cards view')).toBeTruthy();
  expect(screen.queryByText('usage stats')).toBeNull();
  expect(mocks.sectionProps).toHaveBeenLastCalledWith(
    expect.objectContaining({ view: 'give', useIAP: true, stripeSessionId: 'cs_returning' }),
  );
});

// A gift code in the URL stays in history and analytics, and fills the form
// again on every reload.
it('takes a gift link code out of the URL and keeps it in the redeem form', () => {
  const CODE = 'ABCD1234EFGH5678';
  window.history.replaceState(null, '', `/user?gift=${CODE}`);
  mocks.params = new URLSearchParams({ gift: CODE });
  mocks.router.replace.mockImplementationOnce((url: string) => {
    window.history.replaceState(null, '', url);
    mocks.params = new URLSearchParams(url.split('?')[1]);
  });

  const { rerender } = render(<ProfilePage />);
  rerender(<ProfilePage />);

  expect(mocks.router.replace).toHaveBeenCalledWith('/user?section=redeem');
  expect(screen.getByText('gift cards view')).toBeTruthy();
  expect(mocks.sectionProps).toHaveBeenLastCalledWith(
    expect.objectContaining({ view: 'redeem', initialCode: CODE }),
  );
});

it('reopens the redeem view on a reload after a gift link', () => {
  mocks.params = new URLSearchParams({ section: 'redeem' });
  render(<ProfilePage />);

  expect(mocks.sectionProps).toHaveBeenLastCalledWith(
    expect.objectContaining({ view: 'redeem', stripeSessionId: undefined }),
  );
});

const lastProps = <T,>(fn: ReturnType<typeof vi.fn>) => fn.mock.lastCall?.[0] as T;

it.each([
  [
    'the Gift Card tile',
    'give',
    () => lastProps<{ onGiftCard: () => void }>(mocks.plansProps).onGiftCard(),
  ],
  [
    'Redeem Gift Card',
    'redeem',
    () => lastProps<{ onRedeemGiftCard: () => void }>(mocks.accountProps).onRedeemGiftCard(),
  ],
] as const)('%s opens the %s view', (_name, view, open) => {
  mocks.params = new URLSearchParams();
  render(<ProfilePage />);
  expect(screen.queryByText('gift cards view')).toBeNull();

  act(() => open());

  expect(screen.getByText('gift cards view')).toBeTruthy();
  expect(mocks.sectionProps).toHaveBeenLastCalledWith(
    expect.objectContaining({ view, stripeSessionId: undefined }),
  );
});

// The Gift Card tile shows the lowest price and the buy view sells at these,
// so the page loads them once, from the store on an IAP build.
it('loads the gift prices once for the Gift Card tile and the buy view', async () => {
  const PRICES = [
    {
      tier: 'plus',
      productId: 'com.bilingify.readest.giftcard_plus_1y.purchase',
      price: 4999,
      currency: 'USD',
    },
  ];
  mocks.fetchGiftPrices.mockResolvedValueOnce(PRICES);
  mocks.params = new URLSearchParams();
  render(<ProfilePage />);

  await waitFor(() =>
    expect(mocks.plansProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ giftPrices: PRICES }),
    ),
  );
  act(() => lastProps<{ onGiftCard: () => void }>(mocks.plansProps).onGiftCard());

  expect(mocks.sectionProps).toHaveBeenLastCalledWith(
    expect.objectContaining({ view: 'give', prices: PRICES, useIAP: true }),
  );
  expect(mocks.fetchGiftPrices).toHaveBeenCalledTimes(1);
  expect(mocks.fetchGiftPrices).toHaveBeenCalledWith(true);
});

// Owner: "In gift card purchase page, we don't need the user avatar section".
it.each([
  ['the buy view', false, { section: 'gifts' }],
  ['the redeem view', true, { section: 'redeem' }],
  ['the plans', true, {}],
] as const)('%s shows the account block: %s', (_name, shown, params) => {
  mocks.params = new URLSearchParams(params);
  render(<ProfilePage />);

  expect(!!screen.queryByText('account block')).toBe(shown);
});

// Owner: "remove the tos and privacy line on the gift card buy page since the
// line is already present in the user page".
it.each([
  ['the buy view', false, { section: 'gifts' }],
  ['the redeem view', true, { section: 'redeem' }],
  ['the plans', true, {}],
] as const)('%s shows the Terms and Privacy line: %s', (_name, shown, params) => {
  mocks.params = new URLSearchParams(params);
  render(<ProfilePage />);

  expect(!!screen.queryByText('legal links')).toBe(shown);
});

// Review (CodeRabbit): AuthContext's refresh is stable, so the page claims and
// loads the gift info once, not on every render.
it('loads the gift info once', async () => {
  mocks.params = new URLSearchParams();
  render(<ProfilePage />);

  await waitFor(() => expect(mocks.fetchGiftCards).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mocks.fetchGiftCards).toHaveBeenCalledTimes(1);
});

// Review (CodeRabbit): whether a gift alone sets the plan decides between a
// new checkout and the billing portal, so the page waits for it.
it('asks for the gift status before sending a plan holder to the billing portal', async () => {
  mocks.params = new URLSearchParams();
  mocks.profilePlan = 'plus';
  mocks.fetchGiftCards
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce({
      sent: [],
      received: [],
      giftPlan: 'plus',
      giftActiveUntil: '2027-11-26T00:00:00Z',
      giftOnly: true,
    });
  mocks.createStripeCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.test' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<ProfilePage />);
  // The opening load is in flight and hasn't answered.
  await waitFor(() => expect(mocks.fetchGiftCards).toHaveBeenCalledTimes(1));

  await act(async () => {
    await lastProps<{ onSubscribe: (id: string) => Promise<void> }>(mocks.plansProps).onSubscribe(
      'price_month_pro',
    );
  });

  expect(mocks.fetchGiftCards).toHaveBeenCalledTimes(2);
  expect(mocks.createStripePortalSession).not.toHaveBeenCalled();
  expect(mocks.createStripeCheckoutSession).toHaveBeenCalledWith('price_month_pro', 'subscription');
});

// Review (CodeRabbit): an older gift-status answer landing after a newer one
// must not put back a stale "gift only" and send a gift holder to the portal.
it('keeps the newest gift status when two loads overlap', async () => {
  mocks.params = new URLSearchParams({ section: 'redeem' });
  mocks.profilePlan = 'plus';
  let finishOpening!: (value: unknown) => void;
  mocks.fetchGiftCards
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOpening = resolve;
        }),
    )
    .mockResolvedValueOnce({
      sent: [],
      received: [],
      giftPlan: 'plus',
      giftActiveUntil: '2027-11-26T00:00:00Z',
      giftOnly: true,
    });
  mocks.createStripeCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.test' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<ProfilePage />);
  await waitFor(() => expect(mocks.fetchGiftCards).toHaveBeenCalledTimes(1));

  // A redemption: the page reloads the gift status, and the newer answer lands first.
  await act(async () =>
    lastProps<{ onPlanChanged: () => void }>(mocks.sectionProps).onPlanChanged(),
  );
  await waitFor(() => expect(mocks.fetchGiftCards).toHaveBeenCalledTimes(2));
  // The opening load, from before the redemption, lands last.
  await act(async () =>
    finishOpening({
      sent: [],
      received: [],
      giftPlan: 'free',
      giftActiveUntil: null,
      giftOnly: false,
    }),
  );

  await act(async () => screen.getByRole('button', { name: 'back' }).click());
  await act(async () => {
    await lastProps<{ onSubscribe: (id: string) => Promise<void> }>(mocks.plansProps).onSubscribe(
      'price_month_pro',
    );
  });

  expect(mocks.createStripePortalSession).not.toHaveBeenCalled();
  expect(mocks.createStripeCheckoutSession).toHaveBeenCalledWith('price_month_pro', 'subscription');
});
