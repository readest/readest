import { COMPLETED_PAYMENT_STATUSES } from '@/types/payment';
import { createSupabaseAdminClient } from '@/utils/supabase';

export const updateUserStorage = async (userId: string) => {
  const supabase = createSupabaseAdminClient();

  try {
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('storage_gb')
      .eq('user_id', userId)
      .in('status', COMPLETED_PAYMENT_STATUSES);

    if (paymentsError) {
      throw paymentsError;
    }

    const totalStorageGB =
      payments?.reduce((sum, payment) => {
        return sum + (payment.storage_gb || 0);
      }, 0) || 0;

    console.log(`User ${userId} total storage: ${totalStorageGB} GB`);

    const { error: updateError } = await supabase
      .from('plans')
      .update({
        storage_purchased_bytes: totalStorageGB * 1024 * 1024 * 1024,
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
