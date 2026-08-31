import type { StripeAvailablePlan } from '@/libs/payment/stripe/client';
import type { AvailablePlan, PlanInterval, PlanType, QuotaFeature, UserPlan } from '@/types/quota';
import { stubTranslation as _ } from '@/utils/misc';

type FeatureType = {
  label: string;
  description?: string;
};

type ProductInfo = {
  id: string;
  name: string;
  feature: QuotaFeature;
  price: number; // in cents
  currency: string;
};

export type PlanDetails = {
  name: string;
  plan: UserPlan;
  type: PlanType;
  color: string;
  hintColor: string;
  price: number; // in cents
  currency: string;
  productId?: string;
  interval: string;
  features: FeatureType[];
  limits?: Record<string, string | number>;
  products?: ProductInfo[];
};

const getProductFeature = (productId: string): QuotaFeature | undefined => {
  const features: QuotaFeature[] = ['storage', 'translation', 'tokens', 'customization'];
  const lowerId = productId.toLowerCase();
  for (const feature of features) {
    if (lowerId.includes(feature)) {
      return feature;
    }
  }

  return undefined;
};

// Only Plus and Pro are sold on a recurring interval; `purchase` is one-time
// and `free` has no price to compare.
const SUBSCRIPTION_TIERS: UserPlan[] = ['plus', 'pro'];

/**
 * Which billing intervals the store front may offer. Yearly only appears once
 * the store actually returns a yearly price for a subscription tier, so this
 * ships safely ahead of the Stripe prices / App Store / Play SKUs existing.
 */
export const getSubscriptionIntervals = (availablePlans: AvailablePlan[]): PlanInterval[] => {
  const hasYearly = availablePlans.some(
    (plan) => plan.interval === 'year' && SUBSCRIPTION_TIERS.includes(plan.plan),
  );
  return hasYearly ? ['month', 'year'] : ['month'];
};

/**
 * The headline discount for paying yearly, as a whole percentage off twelve
 * monthly payments. Returns the largest saving across tiers, or `null` when no
 * tier has both intervals priced or the yearly price saves nothing — the badge
 * is then omitted rather than claiming a discount that isn't there.
 */
export const getYearlySavingsPercent = (availablePlans: AvailablePlan[]): number | null => {
  let best: number | null = null;
  for (const tier of SUBSCRIPTION_TIERS) {
    const monthly = availablePlans.find((p) => p.plan === tier && p.interval === 'month');
    const yearly = availablePlans.find((p) => p.plan === tier && p.interval === 'year');
    if (!monthly?.price || !yearly?.price) continue;
    const saving = Math.floor((1 - yearly.price / (monthly.price * 12)) * 100);
    if (saving > 0 && (best === null || saving > best)) {
      best = saving;
    }
  }
  return best;
};

/**
 * A user who already holds a Stripe subscription must change it through the
 * billing portal: a second checkout session would leave both subscriptions
 * running and bill them twice. `purchase` means storage add-ons with no
 * subscription behind them, so those users still go to checkout.
 */
export const shouldUseBillingPortal = (userPlan: UserPlan, planType: PlanType): boolean =>
  planType === 'subscription' && (userPlan === 'plus' || userPlan === 'pro');

/**
 * Per-tier accent. The store front is the one surface that is actively selling,
 * so it carries colour the rest of the app deliberately does not.
 *
 * Every colour is `not-eink:` guarded: on e-ink none of it applies and the card
 * falls back to the neutral + 1px border treatment, which is the only thing
 * that reads on those screens. The hues avoid `blue`/`red` on purpose —
 * globals.css flattens `[class*='text-blue']` to base-content AND
 * `font-weight: normal`, which would silently un-bold the price.
 */
export type PlanAccent = {
  header: string;
  border: string;
  current: string;
  price: string;
  check: string;
  cta: string;
  tile: string;
};

const PLAN_ACCENTS: Record<UserPlan, PlanAccent> = {
  free: {
    header: 'not-eink:bg-slate-100',
    border: 'not-eink:border-slate-400',
    current: 'not-eink:bg-slate-200 not-eink:text-slate-700',
    price: '',
    check: 'not-eink:text-slate-500',
    cta: '',
    tile: '',
  },
  plus: {
    header: 'not-eink:bg-sky-50',
    border: 'not-eink:border-sky-400',
    current: 'not-eink:bg-sky-100 not-eink:text-sky-900',
    price: 'not-eink:text-sky-700',
    check: 'not-eink:text-sky-600',
    cta: 'not-eink:border-sky-600 not-eink:bg-sky-600 not-eink:hover:border-sky-700 not-eink:hover:bg-sky-700 not-eink:text-white',
    tile: '',
  },
  pro: {
    header: 'not-eink:bg-violet-50',
    border: 'not-eink:border-violet-400',
    current: 'not-eink:bg-violet-100 not-eink:text-violet-900',
    price: 'not-eink:text-violet-700',
    check: 'not-eink:text-violet-600',
    cta: 'not-eink:border-violet-200 not-eink:bg-violet-50 not-eink:text-violet-700 not-eink:hover:bg-violet-100',
    tile: '',
  },
  purchase: {
    header: 'not-eink:bg-emerald-50',
    border: 'not-eink:border-emerald-400',
    current: 'not-eink:bg-emerald-100 not-eink:text-emerald-900',
    price: 'not-eink:text-emerald-700',
    check: 'not-eink:text-emerald-600',
    cta: '',
    tile: 'not-eink:bg-emerald-50 not-eink:text-emerald-700 not-eink:hover:bg-emerald-100',
  },
};

export const getPlanAccent = (plan: UserPlan): PlanAccent =>
  PLAN_ACCENTS[plan] ?? PLAN_ACCENTS.free;

export function getPlanDetails(
  planCode: UserPlan,
  availablePlans: (AvailablePlan & StripeAvailablePlan)[],
  interval: PlanInterval = 'month',
): PlanDetails {
  const availablePlan = availablePlans.find(
    (plan) => plan.plan === planCode && (!plan.interval || plan.interval === interval),
  );
  const currency = availablePlans?.[0]?.currency ?? 'USD';
  switch (planCode) {
    case 'purchase': {
      const purchasableProducts: ProductInfo[] = availablePlans
        .filter((plan) => plan.plan === planCode)
        .sort((a, b) => a.price - b.price)
        .map((plan) => {
          return {
            id: plan.productId,
            name: plan.productName,
            feature: plan.metadata?.feature || getProductFeature(plan.productId) || 'generic',
            price: plan.price,
            currency: plan.currency,
          } as ProductInfo;
        });
      return {
        name: _('Lifetime Plan'),
        plan: planCode,
        type: 'purchase',
        color: 'not-eink:bg-emerald-100 not-eink:text-emerald-800 eink-bordered',
        hintColor: 'text-base-content/60',
        price: availablePlan?.price || 1999,
        currency,
        productId: availablePlan?.productId,
        interval: _('lifetime'),
        features: [
          {
            label: _('One-Time Payment'),
            description: _(
              'Make a single payment to enjoy lifetime access to specific features on all devices. Purchase specific features or services only when you need them.',
            ),
          },
          {
            label: _('Expand Cloud Sync Storage'),
            description: _(
              'Expand your cloud storage forever with a one-time purchase. Each additional purchase adds more space.',
            ),
          },
          {
            label: _('Unlock All Customization Options'),
            description: _(
              'Unlock additional themes, fonts, layout options and read aloud, translators, cloud storage services.',
            ),
          },
        ],
        products: purchasableProducts,
      };
    }
    case 'free':
      return {
        name: _('Free Plan'),
        plan: planCode,
        type: 'subscription',
        color: 'not-eink:bg-slate-200 not-eink:text-slate-800 eink-bordered',
        hintColor: 'text-base-content/60',
        price: 0,
        currency,
        productId: availablePlan?.productId,
        interval: interval === 'month' ? _('month') : _('year'),
        features: [
          {
            label: _('Cross-Platform Sync'),
            description: _(
              'Seamlessly sync your library, progress, highlights, and notes across all your devices—never lose your place again.',
            ),
          },
          {
            label: _('Customizable Reading'),
            description: _(
              'Personalize every detail with adjustable fonts, layouts, themes, and advanced display settings for the perfect reading experience.',
            ),
          },
          {
            label: _('AI Read Aloud'),
            description: _(
              'Enjoy hands-free reading with natural-sounding AI voices that bring your books to life.',
            ),
          },
          {
            label: _('AI Translations'),
            description: _(
              'Translate any text instantly with the power of Google, Azure, or DeepL—understand content in any language.',
            ),
          },
          {
            label: _('Community Support'),
            description: _(
              'Connect with fellow readers and get help fast in our friendly community channels.',
            ),
          },
        ],
        limits: {
          [_('Cloud Sync Storage')]: '500 MB',
          [_('AI Translations (per day)')]: '10K',
        },
      };
    case 'plus':
      return {
        name: _('Plus Plan'),
        plan: planCode,
        type: 'subscription',
        color: 'not-eink:bg-sky-100 not-eink:text-sky-800 eink-bordered',
        hintColor: 'text-base-content/60',
        price: availablePlan?.price || (interval === 'year' ? 3999 : 499),
        currency,
        productId: availablePlan?.productId,
        interval: interval === 'month' ? _('month') : _('year'),
        features: [
          {
            label: _('Includes All Free Plan Benefits'),
          },
          {
            label: _('Unlimited AI Read Aloud Hours'),
            description: _(
              'Listen without limits—convert as much text as you like into immersive audio.',
            ),
          },
          {
            label: _('More AI Translations'),
            description: _(
              'Unlock enhanced translation capabilities with more daily usage and advanced options.',
            ),
          },
          {
            label: _('DeepL Pro Access'),
            description: _(
              'Translate up to 100,000 characters daily with the most accurate translation engine available.',
            ),
          },
          {
            label: _('Cloud Sync Storage'),
            description: _(
              'Securely store and access your entire reading collection with up to 5 GB of cloud storage.',
            ),
          },
          {
            label: _('Priority Support'),
            description: _(
              'Enjoy faster responses and dedicated assistance whenever you need help.',
            ),
          },
        ],
        limits: {
          [_('Cloud Sync Storage')]: '5 GB',
          [_('AI Translations (per day)')]: '100K',
        },
      };
    case 'pro':
      return {
        name: _('Pro Plan'),
        plan: planCode,
        type: 'subscription',
        color: 'not-eink:bg-violet-100 not-eink:text-violet-800 eink-bordered',
        hintColor: 'text-base-content/60',
        price: availablePlan?.price || (interval === 'year' ? 7999 : 999),
        currency,
        productId: availablePlan?.productId,
        interval: interval === 'month' ? _('month') : _('year'),
        features: [
          {
            label: _('Includes All Plus Plan Benefits'),
          },
          {
            label: _('Early Feature Access'),
            description: _(
              'Be the first to explore new features, updates, and innovations before anyone else.',
            ),
          },
          {
            label: _('Advanced AI Tools'),
            description: _(
              'Harness powerful AI tools for smarter reading, translation, and content discovery.',
            ),
          },
          {
            label: _('DeepL Pro Access'),
            description: _(
              'Translate up to 500,000 characters daily with the most accurate translation engine available.',
            ),
          },
          {
            label: _('Cloud Sync Storage'),
            description: _(
              'Securely store and access your entire reading collection with up to 20 GB of cloud storage.',
            ),
          },
        ],
        limits: {
          [_('Cloud Sync Storage')]: '20 GB',
          [_('AI Translations (per day)')]: '500K',
        },
      };
    default:
      return getPlanDetails('free', availablePlans);
  }
}
