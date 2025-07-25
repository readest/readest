import { z } from 'zod';
import { NextResponse } from 'next/server';
import { defaultIAPVerifier } from '@/libs/iap/apple/verifier';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';

const iapVerificationSchema = z.object({
  transactionId: z.string().min(1, 'Transaction ID is required'),
  originalTransactionId: z.string().min(1, 'Original Transaction ID is required'),
});

const PRODUCT_MAP: Record<string, string> = {
  'com.bilingify.readest.monthly.plus': 'Monthly Plus Subscription',
  'com.bilingify.readest.yearly.plus': 'Yearly Plus Subscription',
  'com.bilingify.readest.monthly.pro': 'Monthly Pro Subscription',
  'com.bilingify.readest.yearly.pro': 'Yearly Pro Subscription',
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
  productId: string;
  platform: string;
  transactionId: string;
  originalTransactionId: string;
  purchaseDate?: string;
  expiresDate?: string | null;
  quantity: number;
  environment: string;
  bundleId: string;
  webOrderLineItemId?: string;
  subscriptionGroupIdentifier?: string;
  type?: string;
  revocationDate?: string | null;
  revocationReason?: number | null;
}

async function updateUserSubscription(userId: string, purchase: Purchase) {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.from('apple_iap_subscriptions').upsert(
      {
        user_id: userId,
        platform: purchase.platform,
        product_id: purchase.productId,
        transaction_id: purchase.transactionId,
        original_transaction_id: purchase.originalTransactionId,
        status: purchase.status === 'active' ? 'active' : 'expired',
        purchase_date: purchase.purchaseDate,
        expires_date: purchase.expiresDate,
        environment: purchase.environment,
        bundle_id: purchase.bundleId,
        quantity: purchase.quantity || 1,
        auto_renew_status: true,
        web_order_line_item_id: purchase.webOrderLineItemId,
        subscription_group_identifier: purchase.subscriptionGroupIdentifier,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        onConflict: 'user_id,original_transaction_id',
      },
    );

    if (error) {
      console.error('Database update error:', error);
      throw new Error(`Database update failed: ${error.message}`);
    }

    const plan = await getProductPlan(purchase.productId);
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
  const { transactionId, originalTransactionId } = validatedInput!;

  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: existingSubscription } = await supabase
      .from('apple_iap_subscriptions')
      .select('*')
      .eq('transaction_id', transactionId)
      .eq('user_id', user.id)
      .single();

    console.log('Existing subscription:', existingSubscription);
    if (existingSubscription && existingSubscription.status === 'active') {
      console.log('Transaction already verified and active');

      const purchase = {
        status: existingSubscription.status,
        customerEmail: user.email,
        subscriptionId:
          existingSubscription.web_order_line_item_id ||
          existingSubscription.original_transaction_id,
        planName: await getProductName(existingSubscription.product_id),
        productId: existingSubscription.product_id,
        platform: existingSubscription.platform,
        transactionId: existingSubscription.transaction_id,
        originalTransactionId: existingSubscription.original_transaction_id,
        purchaseDate: existingSubscription.purchase_date,
        expiresDate: existingSubscription.expires_date,
        quantity: existingSubscription.quantity,
        environment: existingSubscription.environment,
        bundleId: existingSubscription.bundle_id,
      };

      return NextResponse.json({
        purchase,
        error: null,
      });
    }

    const verificationResult = await defaultIAPVerifier.verifyTransaction(originalTransactionId);
    if (!verificationResult.success) {
      console.error('Apple verification failed:', verificationResult.error);
      return NextResponse.json(
        {
          error: verificationResult.error || 'Transaction verification failed with Apple',
          purchase: null,
        },
        { status: 400 },
      );
    }

    const transaction = verificationResult.transaction!;
    console.log('Apple verification successful:', {
      transactionId: transaction.transactionId,
      productId: transaction.productId,
      environment: transaction.environment,
    });
    if (transaction.environment === 'Sandbox' && process.env.NODE_ENV === 'production') {
      console.warn('Sandbox transaction in production environment');
    }

    const purchase = {
      status: verificationResult.status!,
      customerEmail: user.email!,
      subscriptionId: transaction.webOrderLineItemId || transaction.originalTransactionId,
      planName: await getProductName(transaction.productId),
      productId: transaction.productId,
      platform: 'ios',
      transactionId: transaction.transactionId,
      originalTransactionId: transaction.originalTransactionId,
      purchaseDate: verificationResult.purchaseDate?.toISOString(),
      expiresDate: verificationResult.expiresDate?.toISOString() || null,
      quantity: transaction.quantity,
      environment: transaction.environment.toLowerCase(),
      bundleId: transaction.bundleId,
      webOrderLineItemId: transaction.webOrderLineItemId,
      subscriptionGroupIdentifier: transaction.subscriptionGroupIdentifier,
      type: transaction.type,
      revocationDate: verificationResult.revocationDate?.toISOString() || null,
      revocationReason: verificationResult.revocationReason,
    };

    try {
      await updateUserSubscription(user.id, purchase);
    } catch (dbError) {
      console.error('Database update failed:', dbError);

      return NextResponse.json(
        {
          error: 'Transaction failed to update database. Please contact support.',
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
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
