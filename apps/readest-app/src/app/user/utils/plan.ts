import { UserPlan } from '@/types/user';
import { stubTranslation as _ } from '@/utils/misc';
import { AvailablePlan } from '../page';

export type PlanDetails = {
  name: string;
  plan: UserPlan;
  color: string;
  price: number;
  price_id?: string;
  interval: string;
  features: string[];
  limits: Record<string, string | number>;
};

export const getPlanDetails = (
  userPlan: UserPlan,
  availablePlans: AvailablePlan[],
): PlanDetails => {
  const availablePlan = availablePlans.find((plan) => plan.plan === userPlan);
  switch (userPlan) {
    case 'free':
      return {
        name: _('Free Plan'),
        plan: userPlan,
        color: 'bg-gray-200 text-gray-800',
        price: 0,
        price_id: availablePlan?.price_id,
        interval: _('month'),
        features: [
          _('Community Support'),
          _('Unlimited Text-to-Speech Hours'),
          _('Unlimited Cloud Sync Devices'),
          _('DeepL Free Access (10K characters/day)'),
          _('500 MB Cloud Sync Space'),
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
        price: availablePlan?.price || 499,
        price_id: availablePlan?.price_id,
        interval: _('month'),
        features: [
          _('Includes All Free Plan Benefits'),
          _('Priority Support'),
          _('Basic AI Translations'),
          _('DeepL Pro Access (50K characters/day)'),
          _('2 GB Cloud Sync Space'),
        ],
        limits: {
          [_('Cloud Sync Storage')]: '2 GB',
          [_('AI Translations (per day)')]: '50K',
        },
      };
    case 'pro':
      return {
        name: _('Pro Plan'),
        plan: userPlan,
        color: 'bg-purple-200 text-purple-800',
        price: availablePlan?.price || 999,
        price_id: availablePlan?.price_id,
        interval: _('month'),
        features: [
          _('Includes All Plus Plan Benefits'),
          _('Early Feature Access'),
          _('More AI Translations'),
          _('Advanced AI Tools'),
          _('DeepL Pro Access (200K characters/day)'),
          _('10 GB Cloud Sync Space'),
        ],
        limits: {
          [_('Cloud Sync Storage')]: '10 GB',
          [_('AI Translations (per day)')]: '200K',
        },
      };
    default:
      return getPlanDetails('free', availablePlans);
  }
};
