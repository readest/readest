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
 * While true, a storage add-on also unlocks Full Customization.
 *
 * Storage buyers from before the unlock existed already held every premium
 * feature, so the launch keeps granting it for a short grace period rather
 * than cutting anyone off mid-purchase. Flip to false when the grace period
 * ends and a storage add-on becomes extra space and nothing else.
 *
 * Flipping it off must NOT revoke the grace-window buyers. Run the
 * grandfather backfill FIRST, which writes each of them a durable
 * `metadata.grandfathered` payment row, and only then flip. In the other
 * order they keep the entitlement until their next purchase and silently lose
 * it when this recompute next runs.
 */
export const STORAGE_GRANTS_CUSTOMIZATION = true;

/**
 * Whether this recompute should record the grace grant. Pure so both sides of
 * the flag flip are testable; the caller supplies the flag.
 */
export const shouldGrantGraceCustomization = (
  totalStorageGB: number,
  alreadyEntitled: boolean,
  graceEnabled: boolean,
): boolean => graceEnabled && !alreadyEntitled && totalStorageGB > 0;

/** The durable row that carries a grace or backfill grant. */
const graceCustomizationRow = (userId: string) => ({
  user_id: userId,
  provider: 'readest',
  product_id: 'com.bilingify.readest.customization.grandfathered',
  storage_gb: 0,
  status: 'completed',
  metadata: {
    feature: CUSTOMIZATION_FEATURE,
    grandfathered: true,
    reason: 'storage add-on purchased during the Full Customization grace period',
  },
});

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
    let customizationPurchased = purchases.some(isCustomizationPurchase);

    // During the grace period a storage add-on still unlocks Full
    // Customization. Record that as a real payment row rather than deriving it
    // from the flag: the entitlement then survives the flag being switched
    // off, which a derived rule would silently revoke on this user's next
    // purchase, because this function is the only writer of
    // `customization_purchased` and reruns every time.
    if (
      shouldGrantGraceCustomization(
        totalStorageGB,
        customizationPurchased,
        STORAGE_GRANTS_CUSTOMIZATION,
      )
    ) {
      const { error: graceError } = await supabase
        .from('payments')
        .insert(graceCustomizationRow(userId));
      if (graceError) {
        // Never fail the purchase over the grace grant. Storage is what the
        // user paid for; a missed grant is recoverable by re-running the
        // backfill, whereas throwing here would lose the payment record.
        console.error('Failed to record the customization grace grant:', graceError);
      } else {
        customizationPurchased = true;
      }
    }

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
