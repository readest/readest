import { createSupabaseAdminClient } from '@/utils/supabase';

export const USAGE_TYPES = {
  TRANSLATION_CHARS: 'translation_chars',
} as const;

export const QUOTA_TYPES = {
  DAILY: 'daily',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
} as const;

export class UsageStatsManager {
  static async trackUsage(
    userId: string,
    usageType: string,
    increment: number = 1,
    metadata: Record<string, string | number> = {},
  ): Promise<number> {
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.rpc('increment_daily_usage', {
        p_user_id: userId,
        p_usage_type: usageType,
        p_usage_date: new Date().toISOString().split('T')[0],
        p_increment: increment,
        p_metadata: metadata,
      });

      if (error) {
        console.error('Usage tracking error:', error);
        return 0;
      }

      return data || 0;
    } catch (error) {
      console.error('Usage tracking failed:', error);
      return 0;
    }
  }

  static async getCurrentUsage(
    userId: string,
    usageType: string,
    period: 'daily' | 'monthly' = 'daily',
  ): Promise<number> {
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.rpc('get_current_usage', {
        p_user_id: userId,
        p_usage_type: usageType,
        p_period: period,
      });

      if (error) {
        console.error('Get current usage error:', error);
        return 0;
      }

      return data || 0;
    } catch (error) {
      console.error('Get current usage failed:', error);
      return 0;
    }
  }

  // Strict variant for quota ENFORCEMENT: unlike `getCurrentUsage` (which
  // returns 0 on error — safe for read-only display), this throws when the
  // usage counter cannot be read. Callers that gate a paid/metered operation
  // must use this so a Supabase outage fails CLOSED (the operation is refused)
  // instead of silently treating usage as 0 and letting it through unmetered.
  static async getCurrentUsageOrThrow(
    userId: string,
    usageType: string,
    period: 'daily' | 'monthly' = 'daily',
  ): Promise<number> {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.rpc('get_current_usage', {
      p_user_id: userId,
      p_usage_type: usageType,
      p_period: period,
    });

    if (error) {
      throw new Error(`Could not read current usage: ${error.message}`);
    }

    return data || 0;
  }
}
