import { GooglePaymentData } from '@/types/payment';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { updateUserStorage } from '@/libs/payment/storage';
import {
  isStoragePurchase,
  mapProductIdToProductName,
  mapProductIdToUserPlan,
  parseStorageGB,
} from '../utils';
import { IAPError, VerifiedIAP } from '../types';
import {
  ProductPurchase,
  SubscriptionPurchase,
  VerificationResult,
  VerifyPurchaseParams,
} from './verifier';

export type VerifiedPurchase = VerifiedIAP & {
  purchaseToken: string;
  purchaseDate?: string;
  expiresDate?: string | null;
  quantity: number;
  environment: string;
  packageName: string;
  purchaseState?: number | null;
  acknowledgementState?: number | null;
  autoRenewing?: boolean | null;
  priceAmountMicros?: string | null;
  priceCurrencyCode?: string | null;
  countryCode?: string | null;
  developerPayload?: string | null;
  linkedPurchaseToken?: string | null;
  obfuscatedExternalAccountId?: string | null;
  obfuscatedExternalProfileId?: string | null;
  cancelReason?: number | null;
  userCancellationTimeMillis?: string | null;
};

export async function createOrUpdateSubscription(userId: string, purchase: VerifiedPurchase) {
  try {
    const supabase = createSupabaseAdminClient();

    const { data: existingSubscription } = await supabase
      .from('google_iap_subscriptions')
      .select('*')
      .eq('purchase_token', purchase.purchaseToken)
      .single();
    if (existingSubscription && existingSubscription.user_id !== userId) {
      throw new Error(IAPError.TRANSACTION_BELONGS_TO_ANOTHER_USER);
    }

    const { data, error } = await supabase.from('google_iap_subscriptions').upsert(
      {
        user_id: userId,
        platform: purchase.platform,
        product_id: purchase.productId,
        purchase_token: purchase.purchaseToken,
        order_id: purchase.orderId,
        status: purchase.status === 'active' ? 'active' : 'expired',
        purchase_date: purchase.purchaseDate,
        expires_date: purchase.expiresDate,
        environment: purchase.environment,
        package_name: purchase.packageName,
        quantity: purchase.quantity || 1,
        auto_renew_status: purchase.autoRenewing || false,
        purchase_state: purchase.purchaseState,
        acknowledgement_state: purchase.acknowledgementState,
        price_amount_micros: purchase.priceAmountMicros,
        price_currency_code: purchase.priceCurrencyCode,
        country_code: purchase.countryCode,
        developer_payload: purchase.developerPayload,
        linked_purchase_token: purchase.linkedPurchaseToken,
        obfuscated_external_account_id: purchase.obfuscatedExternalAccountId,
        obfuscated_external_profile_id: purchase.obfuscatedExternalProfileId,
        cancel_reason: purchase.cancelReason,
        user_cancellation_time_millis: purchase.userCancellationTimeMillis,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        onConflict: 'user_id,order_id',
      },
    );

    if (error) {
      console.error('Database update error:', error);
      throw new Error(`Database update failed: ${error.message}`);
    }

    const plan = mapProductIdToUserPlan(purchase.productId, true);
    await supabase
      .from('plans')
      .update({
        plan: ['active', 'trialing'].includes(purchase.status) ? plan : 'free',
        status: purchase.status,
      })
      .eq('id', userId);

    return data;
  } catch (error) {
    console.error('Failed to update user subscription:', error);
    throw error;
  }
}

export async function createOrUpdatePayment(userId: string, purchase: VerifiedPurchase) {
  try {
    const supabase = createSupabaseAdminClient();
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('*')
      .eq('google_purchase_token', purchase.purchaseToken)
      .single();

    if (existingPayment && existingPayment.user_id !== userId) {
      throw new Error(IAPError.TRANSACTION_BELONGS_TO_ANOTHER_USER);
    }
    const paymentData: Partial<GooglePaymentData> = {
      user_id: userId,
      provider: 'google',
      product_id: purchase.productId,
      google_order_id: purchase.orderId,
      google_purchase_token: purchase.purchaseToken,
      storage_gb: isStoragePurchase(purchase.productId) ? parseStorageGB(purchase.productId) : 0,
      status: purchase.status === 'active' ? 'completed' : 'failed',
      amount: purchase.amount,
      currency: purchase.currency,
    };

    const { data, error } = await supabase.from('payments').upsert(paymentData, {
      onConflict: 'google_purchase_token',
      ignoreDuplicates: false,
    });

    if (error) {
      console.error('Database payment update error:', error);
      throw new Error(`Database payment update failed: ${error.message}`);
    }

    await updateUserStorage(userId);
    return data;
  } catch (error) {
    console.error('Failed to update user payment:', error);
    throw error;
  }
}

export async function processPurchaseData(
  user: { id: string; email?: string | undefined },
  verifyParams: VerifyPurchaseParams,
  verificationResult: VerificationResult,
): Promise<VerifiedPurchase> {
  const { orderId, purchaseToken, productId, packageName } = verifyParams;
  const purchaseData = verificationResult.purchaseData!;
  const isSubscription = verificationResult.purchaseType === 'subscription';

  // Check environment (test purchases have specific patterns in orderId)
  const isTestPurchase = purchaseData.purchaseType === 0; // 0 = Test, 1 = Promo, undefined = Real
  if (isTestPurchase && process.env.NODE_ENV === 'production') {
    console.warn('Test purchase in production environment');
  }

  let purchase: VerifiedPurchase;
  if (isSubscription) {
    const subData = purchaseData as SubscriptionPurchase;
    purchase = {
      platform: 'android',
      status: verificationResult.status!,
      customerEmail: user.email!,
      orderId: subData.orderId || orderId,
      subscriptionId: subData.orderId || orderId,
      planName: mapProductIdToProductName(productId),
      planType: 'subscription',
      productId: productId,
      amount: subData.priceAmountMicros ? Number(subData.priceAmountMicros) / 10000 : undefined,
      currency: subData.priceCurrencyCode || undefined,
      purchaseToken: purchaseToken,
      purchaseDate: verificationResult.purchaseDate?.toISOString(),
      expiresDate: verificationResult.expiresDate?.toISOString() || null,
      quantity: subData.quantity || 1,
      environment: isTestPurchase ? 'sandbox' : 'production',
      packageName: packageName,
      purchaseState: subData.purchaseState,
      acknowledgementState: subData.acknowledgementState,
      autoRenewing: subData.autoRenewing,
      priceAmountMicros: subData.priceAmountMicros,
      priceCurrencyCode: subData.priceCurrencyCode,
      countryCode: subData.countryCode,
      developerPayload: subData.developerPayload,
      linkedPurchaseToken: subData.linkedPurchaseToken,
      obfuscatedExternalAccountId: subData.obfuscatedExternalAccountId,
      obfuscatedExternalProfileId: subData.obfuscatedExternalProfileId,
      cancelReason: subData.cancelReason,
      userCancellationTimeMillis: subData.userCancellationTimeMillis,
    };
  } else {
    const prodData = purchaseData as ProductPurchase;
    purchase = {
      platform: 'android',
      status: verificationResult.status!,
      customerEmail: user.email!,
      orderId: prodData.orderId || purchaseToken,
      subscriptionId: prodData.orderId || purchaseToken,
      planName: mapProductIdToProductName(productId),
      planType: 'purchase',
      productId: productId,
      purchaseToken: purchaseToken,
      purchaseDate: verificationResult.purchaseDate?.toISOString(),
      expiresDate: null, // One-time purchases don't expire
      quantity: prodData.quantity || 1,
      environment: isTestPurchase ? 'sandbox' : 'production',
      packageName: packageName,
      purchaseState: prodData.purchaseState,
      acknowledgementState: prodData.acknowledgementState,
      autoRenewing: false, // Not applicable for one-time purchases
      priceAmountMicros: undefined,
      priceCurrencyCode: prodData.regionCode,
      countryCode: prodData.regionCode,
      developerPayload: prodData.developerPayload,
      linkedPurchaseToken: undefined,
      obfuscatedExternalAccountId: prodData.obfuscatedExternalAccountId,
      obfuscatedExternalProfileId: prodData.obfuscatedExternalProfileId,
      cancelReason: null,
      userCancellationTimeMillis: null,
    };
  }

  if (isSubscription) {
    await createOrUpdateSubscription(user.id, purchase);
  } else {
    await createOrUpdatePayment(user.id, purchase);
  }

  return purchase;
}
