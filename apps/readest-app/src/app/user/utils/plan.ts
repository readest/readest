import { UserPlan } from '@/types/user';
import { stubTranslation as _ } from '@/utils/misc';
import { AvailablePlan } from '../page';

type FeatureType = {
  label: string;
  description?: string;
};

export type PlanDetails = {
  name: string;
  plan: UserPlan;
  color: string;
  hintColor: string;
  price: number;
  currency: string;
  price_id?: string;
  interval: string;
  features: FeatureType[];
  limits: Record<string, string | number>;
};

export const getPlanDetails = (
  userPlan: UserPlan,
  availablePlans: AvailablePlan[],
  interval: 'month' | 'year' = 'month',
): PlanDetails => {
  const availablePlan = availablePlans.find(
    (plan) => plan.plan === userPlan && (!plan.interval || plan.interval === interval),
  );
  const currency = availablePlans.length > 0 ? availablePlans[0]!.currency : 'USD';
  switch (userPlan) {
    case 'free':
      return {
        name: _('Free Plan'),
        plan: userPlan,
        color: 'bg-gray-200 text-gray-800',
        hintColor: 'text-gray-800/75',
        price: 0,
        currency,
        price_id: availablePlan?.price_id,
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
        plan: userPlan,
        color: 'bg-blue-200 text-blue-800',
        hintColor: 'text-blue-800/75',
        price: availablePlan?.price || 499,
        currency,
        price_id: availablePlan?.price_id,
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
        plan: userPlan,
        color: 'bg-purple-200 text-purple-800',
        hintColor: 'text-purple-800/75',
        price: availablePlan?.price || 999,
        currency,
        price_id: availablePlan?.price_id,
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
