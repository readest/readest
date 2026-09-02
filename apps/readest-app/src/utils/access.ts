import { jwtDecode } from 'jwt-decode';
import { supabase } from '@/utils/supabase';
import { UserPlan } from '@/types/quota';
import { DEFAULT_DAILY_TRANSLATION_QUOTA, DEFAULT_STORAGE_QUOTA } from '@/services/constants';
import { isWebAppPlatform } from '@/services/environment';
import { getDailyUsage } from '@/services/translators/utils';
import { getRuntimeConfig } from '@/services/runtimeConfig';

interface Token {
  plan: UserPlan;
  storage_usage_bytes: number;
  storage_purchased_bytes: number;
  customization_purchased: boolean;
  [key: string]: string | number | boolean;
}

export const getSubscriptionPlan = (token: string): UserPlan => {
  const data = jwtDecode<Token>(token) || {};
  return data['plan'] || 'free';
};

export const getUserProfilePlan = (token: string): UserPlan => {
  const data = jwtDecode<Token>(token) || {};
  let plan = data['plan'] || 'free';
  if (plan === 'free') {
    const purchasedQuota = data['storage_purchased_bytes'] || 0;
    if (purchasedQuota > 0) {
      plan = 'purchase';
    }
  }
  return plan;
};

/**
 * Plans that include the "Send to Readest via email" feature: Plus,
 * Pro, and Lifetime (`purchase`). Free users see an upgrade card on
 * the client and get a 403 from the server endpoints that allocate /
 * rotate the address, plus a bounce from the inbound email Worker.
 *
 * Other Send channels (in-app `/send` page, mobile share-sheet, browser
 * extension) stay open to free users — the gate is the personal email
 * inbox only.
 */
export const EMAIL_IN_PLANS: readonly UserPlan[] = ['plus', 'pro', 'purchase'];

export const isEmailInPlan = (plan: UserPlan, customizationPurchased: boolean): boolean =>
  isCustomizationAllowed(plan, customizationPurchased);

/**
 * Plans that include third-party cloud sync (WebDAV / Google Drive): any paid
 * plan — Plus, Pro, and Lifetime (`purchase`). Free users see an upgrade prompt
 * in Settings and the reader's auto-sync stays off, so syncing to a personal
 * cloud is a premium feature.
 */
export const CLOUD_SYNC_PLANS: readonly UserPlan[] = ['plus', 'pro', 'purchase'];

export const isCloudSyncInPlan = (plan: UserPlan, customizationPurchased: boolean): boolean =>
  isCustomizationAllowed(plan, customizationPurchased);

/**
 * Master switch for the third-party cloud-sync premium paywall. ON: cloud
 * sync (WebDAV / Google Drive / S3) requires a {@link CLOUD_SYNC_PLANS} plan —
 * free users see the provider rows with a Premium badge and an upgrade route
 * instead of the config sub-pages, and a downgraded account's still-selected
 * provider is paused (never a silent fallback to Readest Cloud uploads, #4959).
 * Every gate goes through {@link isCloudSyncAllowed}, so this flag is the
 * whole toggle.
 */
export const CLOUD_SYNC_REQUIRES_PREMIUM = true;

/**
 * Whether third-party cloud sync is available for a plan. Falls back to the
 * {@link isCloudSyncInPlan} paywall while {@link CLOUD_SYNC_REQUIRES_PREMIUM}
 * is on; flipping the switch off ungates every plan.
 */
export const isCloudSyncAllowed = (plan: UserPlan, customizationPurchased: boolean): boolean =>
  !CLOUD_SYNC_REQUIRES_PREMIUM || isCloudSyncInPlan(plan, customizationPurchased);

/**
 * Plans that include the offline TTS audio cache — pre-downloading a book's
 * Read Aloud audio per chapter so it plays without a network: any paid plan
 * (Plus, Pro, and Lifetime `purchase`). Free users see the download row with a
 * Premium badge and an upgrade route instead of the per-chapter controls.
 */
export const TTS_CACHE_PLANS: readonly UserPlan[] = ['plus', 'pro', 'purchase'];

export const isTTSCacheInPlan = (plan: UserPlan, customizationPurchased: boolean): boolean =>
  isCustomizationAllowed(plan, customizationPurchased);

/**
 * Master switch for the offline-audio premium paywall, mirroring
 * {@link CLOUD_SYNC_REQUIRES_PREMIUM}. ON: pre-downloading TTS audio requires a
 * {@link TTS_CACHE_PLANS} plan. Flipping it off ungates every plan. The
 * automatic playback cache (audio kept as the user listens) is unaffected —
 * only the explicit download UI is gated.
 */
export const TTS_CACHE_REQUIRES_PREMIUM = true;

export const isTTSCacheAllowed = (plan: UserPlan, customizationPurchased: boolean): boolean =>
  !TTS_CACHE_REQUIRES_PREMIUM || isTTSCacheInPlan(plan, customizationPurchased);

/**
 * Plans that include Nearby BookDrop device pairing — trusted devices whose
 * drops skip the per-transfer confirmation dialog: any paid plan (Plus, Pro,
 * and Lifetime `purchase`). Free users see the pairing affordance with a
 * Premium badge and an upgrade route; plain confirm-every-time transfers stay
 * free. This gate is client-side only (LAN transfers have no server in the
 * path), matching the TTS-cache gate's trust level.
 */
export const NEARBY_PAIRING_PLANS: readonly UserPlan[] = ['plus', 'pro', 'purchase'];

export const isNearbyPairingInPlan = (plan: UserPlan, customizationPurchased: boolean): boolean =>
  isCustomizationAllowed(plan, customizationPurchased);

/**
 * Master switch for the pairing paywall, mirroring
 * {@link CLOUD_SYNC_REQUIRES_PREMIUM}. ON: pairing (and therefore
 * confirmation-free drops) requires a {@link NEARBY_PAIRING_PLANS} plan.
 * Flipping it off ungates every plan. Existing pairing records always
 * persist; only the auto-accept behavior is gated.
 */
export const NEARBY_PAIRING_REQUIRES_PREMIUM = true;

export const isNearbyPairingAllowed = (plan: UserPlan, customizationPurchased: boolean): boolean =>
  !NEARBY_PAIRING_REQUIRES_PREMIUM || isNearbyPairingInPlan(plan, customizationPurchased);

/**
 * Whether the account has bought the Full Customization unlock, as minted into
 * the access token by `custom_access_token_hook`. Absent on tokens issued
 * before the claim existed, which reads as not purchased.
 */
export const getCustomizationPurchased = (token: string): boolean => {
  const data = jwtDecode<Token>(token) || {};
  return data['customization_purchased'] === true;
};

/**
 * Plans that carry the premium feature set without a separate purchase.
 *
 * `purchase` is deliberately absent. {@link getUserProfilePlan} reports it for
 * anyone holding ANY one-time purchase, which is how a storage add-on
 * presents, so including it would hand every premium feature to a buyer who
 * only wanted more space.
 */
export const PREMIUM_PLANS: readonly UserPlan[] = ['plus', 'pro'];

/**
 * Self-hosted deployments unlock every premium feature, signed in or not.
 * There is no store to buy from, and the operator already runs the
 * infrastructure the paywall exists to fund. Read from the runtime config in
 * the browser, and straight from the environment on the server where the
 * window-injected config does not exist.
 */
export const isSelfHosted = (): boolean =>
  getRuntimeConfig()?.selfHosted === true ||
  // `??` would stop at an empty string, so an explicitly blank SELF_HOSTED
  // would mask NEXT_PUBLIC_SELF_HOSTED. `||` falls through on empty too.
  (process.env['SELF_HOSTED'] || process.env['NEXT_PUBLIC_SELF_HOSTED']) === 'true';

/**
 * The single gate for premium features: a self-hosted deployment, a paid
 * subscription, or the Full Customization unlock bought outright.
 */
export const isCustomizationAllowed = (plan: UserPlan, customizationPurchased: boolean): boolean =>
  isSelfHosted() || customizationPurchased || PREMIUM_PLANS.includes(plan);

export const STORAGE_QUOTA_GRACE_BYTES = 10 * 1024 * 1024; // 10 MB grace

export const getStoragePlanData = (token: string) => {
  const data = jwtDecode<Token>(token) || {};
  const plan = data['plan'] || 'free';
  const usage = data['storage_usage_bytes'] || 0;
  const purchasedQuota = data['storage_purchased_bytes'] || 0;
  const runtimeConfig = getRuntimeConfig();
  const fixedQuota =
    runtimeConfig?.storageFixedQuota ?? parseInt(process.env['STORAGE_FIXED_QUOTA'] ?? '0');
  const planQuota = fixedQuota || DEFAULT_STORAGE_QUOTA[plan] || DEFAULT_STORAGE_QUOTA['free'];
  const quota = planQuota + purchasedQuota;

  return {
    plan,
    usage,
    quota,
  };
};

export const getTranslationQuota = (plan: UserPlan): number => {
  const runtimeConfig = getRuntimeConfig();
  const fixedQuota =
    runtimeConfig?.translationFixedQuota ?? parseInt(process.env['TRANSLATION_FIXED_QUOTA'] ?? '0');
  return (
    fixedQuota || DEFAULT_DAILY_TRANSLATION_QUOTA[plan] || DEFAULT_DAILY_TRANSLATION_QUOTA['free']
  );
};

export const getTranslationPlanData = (token: string) => {
  const data = jwtDecode<Token>(token) || {};
  const plan: UserPlan = data['plan'] || 'free';
  const usage = getDailyUsage() || 0;
  const quota = getTranslationQuota(plan);

  return {
    plan,
    usage,
    quota,
  };
};

export const getDailyTranslationPlanData = (token: string) => {
  const data = jwtDecode<Token>(token) || {};
  const plan = data['plan'] || 'free';
  const quota = getTranslationQuota(plan);

  return {
    plan,
    quota,
  };
};

export const getAccessToken = async (): Promise<string | null> => {
  // In browser context there might be two instances of supabase one in the app route
  // and the other in the pages route, and they might have different sessions
  // making the access token invalid for API calls. In that case we should use localStorage.
  if (isWebAppPlatform()) {
    return localStorage.getItem('token') ?? null;
  }
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
};

export const getUserID = async (): Promise<string | null> => {
  if (isWebAppPlatform()) {
    const user = localStorage.getItem('user') ?? '{}';
    return JSON.parse(user).id ?? null;
  }
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
};

export const validateUserAndToken = async (authHeader: string | null | undefined) => {
  if (!authHeader) return {};

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) return {};
  return { user, token };
};
