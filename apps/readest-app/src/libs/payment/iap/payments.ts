import { createSupabaseAdminClient } from '@/utils/supabase';
import { updateUserStorage } from '@/libs/payment/storage';

type PaymentRefKey = 'apple_original_transaction_id' | 'google_purchase_token';

/**
 * Mark a one-time purchase as refunded and recompute the user's purchased
 * storage. Used by the App Store / Google Play webhooks when a non-subscription
 * purchase (e.g. a storage add-on) is refunded or voided.
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

  await updateUserStorage(userId);
}
