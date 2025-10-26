import { StripeAvailablePlan } from '@/libs/payment/stripe/client';
import { AvailablePlan, PlanInterval, PlanType, QuotaFeature, UserPlan } from '@/types/quota';
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

export const getPlanDetails = (
  planCode: UserPlan,
  availablePlans: (AvailablePlan & StripeAvailablePlan)[],
  interval: PlanInterval = 'month',
): PlanDetails => {
  const availablePlan = availablePlans.find(
    (plan) => plan.plan === planCode && (!plan.interval || plan.interval === interval),
  );
  const currency = availablePlans.length > 0 ? availablePlans[0]!.currency : 'USD';
  switch (planCode) {
    case 'purchase':
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
        color: 'bg-green-100 text-green-800',
        hintColor: 'text-green-800/75',
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
    case 'free':
      return {
        name: _('Free Plan'),
        plan: planCode,
        type: 'subscription',
        color: 'bg-gray-200 text-gray-800',
        hintColor: 'text-gray-800/75',
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
        color: 'bg-blue-200 text-blue-800',
        hintColor: 'text-blue-800/75',
        price: availablePlan?.price || 499,
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
        color: 'bg-purple-200 text-purple-800',
        hintColor: 'text-purple-800/75',
        price: availablePlan?.price || 999,
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
};
