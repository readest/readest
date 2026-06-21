import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { recordIapReconcile } from '@/libs/payment/iap/telemetry';

// Reconciliation sweep for store subscriptions. A missed webhook leaves a row
// marked `active` while its store expiry has already passed; this endpoint
// counts that drift per store so it can be alerted on (it is detection-only and
// never mutates state). Protect it with CRON_SECRET and trigger it on a
// schedule (a Cloudflare Cron Trigger worker that fetches this URL, or any
// external scheduler) sending `Authorization: Bearer <CRON_SECRET>`.

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

const countDrift = async (supabase: SupabaseAdminClient, table: string): Promise<number> => {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
    .lt('expires_date', new Date().toISOString());

  if (error) {
    throw new Error(`Failed to count drift in ${table}: ${error.message}`);
  }
  return count ?? 0;
};

export async function GET(request: Request) {
  const secret = process.env['CRON_SECRET'];
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const supabase = createSupabaseAdminClient();
    const [appleDrift, googleDrift] = await Promise.all([
      countDrift(supabase, 'apple_iap_subscriptions'),
      countDrift(supabase, 'google_iap_subscriptions'),
    ]);

    recordIapReconcile({ appleDrift, googleDrift, durationMs: Date.now() - startedAt });

    return NextResponse.json({ appleDrift, googleDrift, checkedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('IAP reconcile error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
