import { COMPLETED_PAYMENT_STATUSES } from '@/types/payment';
import { createSupabaseAdminClient } from '@/utils/supabase';

type PurchaseRow = {
  storage_gb?: number | null;
  product_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

const CUSTOMIZATION_FEATURE = 'customization';

/**
 * Whether a completed payment is the Full Customization unlock. The two stores
 * identify it differently: IAP rows carry a readable product id and no
 * metadata, while Stripe rows carry an opaque `prod_xxx` and the product
 * metadata, so a product-id match alone would miss every Stripe purchase.
 */
const isCustomizationPurchase = (payment: PurchaseRow): boolean => {
  const metadata = payment.metadata ?? {};
  if (metadata['feature'] === CUSTOMIZATION_FEATURE) return true;
  if (typeof metadata[CUSTOMIZATION_FEATURE] === 'string' && metadata[CUSTOMIZATION_FEATURE]) {
    return true;
  }
  return (payment.product_id ?? '').includes(CUSTOMIZATION_FEATURE);
};

/**
 * Recompute every entitlement that is derived from one-time purchases and
 * write it to the user's plan. Deriving rather than incrementing is what makes
 * refunds work: `markPaymentRefunded` flips a row out of
 * {@link COMPLETED_PAYMENT_STATUSES} and calls back here, and the entitlement
 * disappears without any separate revoke path.
 */
export const updateUserStorage = async (userId: string) => {
  const supabase = createSupabaseAdminClient();

  try {
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('storage_gb, product_id, metadata')
      .eq('user_id', userId)
      .in('status', COMPLETED_PAYMENT_STATUSES);

    if (paymentsError) {
      throw paymentsError;
    }

    const purchases: PurchaseRow[] = payments || [];
    const totalStorageGB = purchases.reduce((sum, payment) => {
      return sum + (payment.storage_gb || 0);
    }, 0);
    const customizationPurchased = purchases.some(isCustomizationPurchase);

    console.log(`User ${userId} total storage: ${totalStorageGB} GB`);

    const { error: updateError } = await supabase
      .from('plans')
      .update({
        storage_purchased_bytes: totalStorageGB * 1024 * 1024 * 1024,
        customization_purchased: customizationPurchased,
      })
      .eq('id', userId);

    if (updateError) {
      throw updateError;
    }

    return totalStorageGB;
  } catch (error) {
    console.error('Error updating user storage:', error);
    throw error;
  }
};
