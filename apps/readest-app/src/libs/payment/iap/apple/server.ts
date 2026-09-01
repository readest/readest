import { ApplePaymentData } from '@/types/payment';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { updateUserStorage } from '@/libs/payment/storage';
import {
  isEntitledStatus,
  isStoragePurchase,
  mapProductIdToProductName,
  mapProductIdToUserPlan,
  parseStorageGB,
} from '../utils';
import { IAPError, VerifiedIAP } from '../types';
import { VerificationResult } from './verifier';

export type VerifiedPurchase = VerifiedIAP & {
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
  autoRenewStatus?: boolean;
};

export async function createOrUpdateSubscription(userId: string, purchase: VerifiedPurchase) {
  try {
    const supabase = createSupabaseAdminClient();

    const { data: existingSubscription } = await supabase
      .from('apple_iap_subscriptions')
      .select('*')
      .eq('original_transaction_id', purchase.originalTransactionId)
      .single();
    if (existingSubscription && existingSubscription.user_id !== userId) {
      throw new Error(IAPError.TRANSACTION_BELONGS_TO_ANOTHER_USER);
    }

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
        auto_renew_status: purchase.autoRenewStatus ?? true,
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

    const plan = mapProductIdToUserPlan(purchase.productId, true);
    await supabase
      .from('plans')
      .update({
        plan: isEntitledStatus(purchase.status) ? plan : 'free',
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

    const paymentData: ApplePaymentData = {
      user_id: userId,
      provider: 'apple',
      product_id: purchase.productId,
      apple_transaction_id: purchase.transactionId,
      apple_original_transaction_id: purchase.originalTransactionId,
      storage_gb: isStoragePurchase(purchase.productId) ? parseStorageGB(purchase.productId) : 0,
      status: purchase.status === 'active' ? 'completed' : 'failed',
      amount: purchase.amount,
      currency: purchase.currency,
    };
    // Ownership is decided by the write itself, never by a preceding read. Two
    // callers can now race for the same transaction (the client verification
    // flow and the ONE_TIME_CHARGE notification), and a check-then-upsert lets
    // both pass the check before the loser silently reassigns `user_id`, after
    // which each call credits storage to a different account. Update only a row
    // that already belongs to this user; otherwise insert and let the unique
    // constraint on apple_original_transaction_id arbitrate.
    const { data: updated, error: updateError } = await supabase
      .from('payments')
      .update(paymentData)
      .eq('apple_original_transaction_id', purchase.originalTransactionId)
      .eq('user_id', userId)
      .select('id');

    if (updateError) {
      console.error('Database payment update error:', updateError);
      throw new Error(`Database payment update failed: ${updateError.message}`);
    }

    if (!updated || updated.length === 0) {
      const { error: insertError } = await supabase.from('payments').insert(paymentData);
      // 23505 is a unique violation: the transaction exists under another user,
      // since an existing row of our own would have been updated above.
      if (insertError?.code === '23505') {
        throw new Error(IAPError.TRANSACTION_BELONGS_TO_ANOTHER_USER);
      }
      if (insertError) {
        console.error('Database payment insert error:', insertError);
        throw new Error(`Database payment update failed: ${insertError.message}`);
      }
    }

    await updateUserStorage(userId);
  } catch (error) {
    console.error('Failed to update user payment:', error);
    throw error;
  }
}

export async function processPurchaseData(
  user: { id: string; email?: string | undefined },
  verificationResult: VerificationResult,
): Promise<VerifiedPurchase> {
  const transaction = verificationResult.transaction!;

  if (transaction.environment === 'Sandbox' && process.env.NODE_ENV === 'production') {
    console.warn('Sandbox transaction in production environment');
  }

  const purchase: VerifiedPurchase = {
    status: verificationResult.status!,
    customerEmail: user.email!,
    orderId: transaction.webOrderLineItemId || transaction.originalTransactionId,
    subscriptionId: transaction.webOrderLineItemId || transaction.originalTransactionId,
    planName: mapProductIdToProductName(transaction.productId),
    planType: verificationResult.planType!,
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

  if (purchase.planType === 'subscription') {
    await createOrUpdateSubscription(user.id, purchase);
  } else if (purchase.planType === 'purchase') {
    await createOrUpdatePayment(user.id, purchase);
  }

  return purchase;
}
