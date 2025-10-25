import { z } from 'zod';
import { NextResponse } from 'next/server';
import {
  getGoogleIAPVerifier,
  ProductPurchase,
  SubscriptionPurchase,
} from '@/libs/payment/google/verifier';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { IAPError } from '@/types/error';
import { PlanType } from '@/types/quota';

const iapVerificationSchema = z.object({
  packageName: z.string().min(1, 'Package name is required'),
  productId: z.string().min(1, 'Product ID is required'),
  orderId: z.string().min(1, 'Order ID is required'),
  purchaseToken: z.string().min(1, 'Purchase token is required'),
});

const PRODUCT_MAP: Record<string, string> = {
  'com.bilingify.readest.monthly.plus': 'Plus',
  'com.bilingify.readest.yearly.plus': 'Plus',
  'com.bilingify.readest.monthly.pro': 'Pro',
  'com.bilingify.readest.yearly.pro': 'Pro',
};

const getProductName = (productId: string) => {
  return PRODUCT_MAP[productId] || productId;
};

const getProductPlan = (productId: string) => {
  if (productId.includes('plus')) {
    return 'plus';
  } else if (productId.includes('pro')) {
    return 'pro';
  }
  return 'free';
};

interface Purchase {
  status: string;
  customerEmail: string;
  subscriptionId: string;
  planName: string;
  planType: PlanType;
  productId: string;
  platform: string;
  purchaseToken: string;
  orderId: string;
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
}

async function updateUserSubscription(userId: string, purchase: Purchase) {
  try {
    const supabase = createSupabaseAdminClient();
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

    const plan = getProductPlan(purchase.productId);
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

export async function POST(request: Request) {
  const body = await request.json();
  let validatedInput;
  try {
    validatedInput = iapVerificationSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid input data',
          purchase: null,
        },
        { status: 400 },
      );
    }
  }
  const { purchaseToken, productId, packageName } = validatedInput!;

  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: IAPError.NOT_AUTHENTICATED }, { status: 403 });
  }

  try {
    const supabase = createSupabaseAdminClient();

    // Check if this purchase already exists
    if (purchaseToken) {
      const { data: existingSubscription } = await supabase
        .from('google_iap_subscriptions')
        .select('*')
        .eq('purchase_token', purchaseToken)
        .single();

      console.log('Existing subscription:', existingSubscription);

      // Should not restore purchase for another account
      if (existingSubscription && existingSubscription.user_id !== user.id) {
        return NextResponse.json(
          { error: IAPError.TRANSACTION_BELONGS_TO_ANOTHER_USER },
          { status: 403 },
        );
      }
    }

    const googleIAPVerifier = getGoogleIAPVerifier();
    const verificationResult = await googleIAPVerifier.verifyPurchase({
      purchaseToken,
      productId,
      packageName,
    });

    if (!verificationResult.success) {
      console.error('Google verification failed:', verificationResult.error);
      return NextResponse.json(
        {
          error: verificationResult.error || IAPError.UNKNOWN_ERROR,
          purchase: null,
        },
        { status: 400 },
      );
    }

    const purchaseData = verificationResult.purchaseData!;
    const isSubscription = verificationResult.purchaseType === 'subscription';
    console.log('Google verification successful:', {
      orderId: purchaseData.orderId,
      productId: productId,
      purchaseState: purchaseData.purchaseState,
    });

    // Check environment (test purchases have specific patterns in orderId)
    const isTestPurchase = purchaseData.purchaseType === 0; // 0 = Test, 1 = Promo, undefined = Real
    if (isTestPurchase && process.env.NODE_ENV === 'production') {
      console.warn('Test purchase in production environment');
    }

    let purchase: Purchase;

    if (isSubscription) {
      const subData = purchaseData as SubscriptionPurchase;
      purchase = {
        status: verificationResult.status!,
        customerEmail: user.email!,
        subscriptionId: subData.orderId || purchaseToken,
        planName: getProductName(productId),
        planType: 'subscription',
        productId: productId,
        platform: 'android',
        purchaseToken: purchaseToken,
        orderId: subData.orderId || '',
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
        status: verificationResult.status!,
        customerEmail: user.email!,
        subscriptionId: prodData.orderId || purchaseToken,
        planName: getProductName(productId),
        planType: 'purchase',
        productId: productId,
        platform: 'android',
        purchaseToken: purchaseToken,
        orderId: prodData.orderId || '',
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

    // Acknowledge the purchase if needed
    if (purchaseData.acknowledgementState === 0) {
      try {
        await googleIAPVerifier.acknowledgePurchase({
          purchaseToken,
          productId,
          packageName,
        });
        purchase.acknowledgementState = 1;
      } catch (ackError) {
        console.error('Failed to acknowledge purchase:', ackError);
        // Continue even if acknowledgement fails
      }
    }

    try {
      await updateUserSubscription(user.id, purchase);
    } catch (dbError) {
      console.error('Database update failed:', dbError);

      return NextResponse.json(
        {
          error: IAPError.TRANSACTION_SERVICE_UNAVAILABLE,
          purchase: null,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      purchase,
      error: null,
    });
  } catch (error) {
    console.error('IAP verification error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : IAPError.UNKNOWN_ERROR },
      { status: 500 },
    );
  }
}
