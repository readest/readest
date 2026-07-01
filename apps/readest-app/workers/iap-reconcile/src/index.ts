import { createClient } from '@supabase/supabase-js';
import { buildReconcileDataPoint, countSubscriptionDrift } from './reconcile';

// Dedicated Cloudflare Cron Worker for IAP subscription reconciliation. Invoked
// by a Cron Trigger (see wrangler.toml) through the `scheduled()` handler, so it
// has NO public HTTP surface and needs no shared request secret. It reads the
// IAP tables directly and records a drift metric to the shared `iap_webhooks`
// Analytics Engine dataset.

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  IAP_WEBHOOK_AE?: AnalyticsEngineDataset;
}

export default {
  async scheduled(_controller, env, _ctx): Promise<void> {
    const startedAt = Date.now();
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    try {
      const { appleDrift, googleDrift } = await countSubscriptionDrift(supabase);
      const durationMs = Date.now() - startedAt;

      // Mirrors the webhook log tag so both stream together under `wrangler tail`.
      console.log(
        JSON.stringify({
          tag: 'iap-webhook',
          kind: 'reconcile',
          appleDrift,
          googleDrift,
          durationMs,
        }),
      );
      env.IAP_WEBHOOK_AE?.writeDataPoint(
        buildReconcileDataPoint({ appleDrift, googleDrift, durationMs }),
      );
    } catch (error) {
      // Rethrow so Cloudflare records a failed scheduled invocation.
      console.error('IAP reconcile failed:', error instanceof Error ? error.message : error);
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
