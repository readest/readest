import { createSupabaseAdminClient } from '@/utils/supabase';
import { updateUserStorage } from '@/libs/payment/storage';
import { revokeGiftCardForPayment } from '@/libs/payment/gift/server';

type PaymentRefKey =
  | 'apple_original_transaction_id'
  | 'google_purchase_token'
  | 'stripe_payment_intent_id';

/**
 * Mark a one-time purchase as refunded, take back the gift card it bought (if
 * any) and recompute the user's purchased storage. Used by the App Store /
 * Google Play / Stripe webhooks when a non-subscription purchase (e.g. a
 * storage add-on or a gift card) is refunded or voided.
 */
export async function markPaymentRefunded(userId: string, column: PaymentRefKey, value: string) {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from('payments')
    .update({ status: 'refunded' })
    .eq(column, value);

  if (error) {
    throw new Error(`Failed to mark payment refunded: ${error.message}`);
  }

  await revokeGiftCardForPayment(column, value);
  await updateUserStorage(userId);
}
