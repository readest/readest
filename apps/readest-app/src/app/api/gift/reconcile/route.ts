import { NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { reconcileGiftCards } from '@/libs/payment/gift/reconcile';

/**
 * POST /api/gift/reconcile: the Cloudflare cron (worker.ts) claims cards for
 * newly confirmed emails, re-syncs plans when a gift starts or ends, and
 * clears stale drafts. 503 when no token is configured, 401 on a bad token.
 */
const getToken = (): string | undefined => {
  try {
    const env = getCloudflareContext().env as { GIFT_RECONCILE_TOKEN?: string } | undefined;
    if (env?.GIFT_RECONCILE_TOKEN) return env.GIFT_RECONCILE_TOKEN;
  } catch {
    // Outside the Worker runtime (local dev, tests).
  }
  return process.env['GIFT_RECONCILE_TOKEN'];
};

export async function POST(request: Request) {
  const expected = getToken();
  if (!expected) return NextResponse.json({ disabled: true }, { status: 503 });
  if (request.headers.get('x-gift-token') !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await reconcileGiftCards());
  } catch (error) {
    console.error('gift reconcile failed:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
