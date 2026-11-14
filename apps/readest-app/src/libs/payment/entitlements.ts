import { UserPlan } from '@/types/quota';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { mapProductIdToUserPlan } from './iap/utils';

type IapSubscriptionRow = { product_id: string; status: string };

// A user can hold subscriptions from several providers at once — most often
// while migrating between card billing and a mobile store, where the old
// subscription outlives the new one by a billing period. Rank the plans so the
// account always reflects the highest one, whichever provider's event fires.
const PLAN_RANK: Record<UserPlan, number> = {
  free: 0,
  purchase: 0,
  plus: 1,
  pro: 2,
};

export const higherPlan = (_a: UserPlan, _b: UserPlan): UserPlan => 'free';

const IAP_SUBSCRIPTION_TABLES = ['google_iap_subscriptions', 'apple_iap_subscriptions'] as const;

const ENTITLED_STORED_IAP_STATUSES = ['active'];

export const getHighestActiveIapPlan = async (_userId: string): Promise<UserPlan> => 'free';

export const getHighestActiveStripePlan = async (
  _userId: string,
  _stripeCustomerId?: string,
): Promise<UserPlan> => 'free';

export const resolveUserPlan = async (
  _userId: string,
  _options: {
    stripeCustomerId?: string;
    entitledPlan?: UserPlan;
  } = {},
): Promise<UserPlan> => 'free';
