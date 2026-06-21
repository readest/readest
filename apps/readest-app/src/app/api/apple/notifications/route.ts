import { NextResponse } from 'next/server';
import { handleAppleNotification } from '@/libs/payment/iap/apple/notifications';
import { recordIapWebhook } from '@/libs/payment/iap/telemetry';

// App Store Server Notifications V2 endpoint. Configure this URL in App Store
// Connect (Production and Sandbox). The payload is signed by Apple and verified
// inside `handleAppleNotification`, so no separate authentication is needed.
export async function POST(request: Request) {
  const startedAt = Date.now();

  let signedPayload: unknown;
  try {
    const body = await request.json();
    signedPayload = body?.signedPayload;
  } catch {
    recordIapWebhook({
      provider: 'apple',
      outcome: 'rejected',
      reason: 'invalid_body',
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (typeof signedPayload !== 'string' || !signedPayload) {
    recordIapWebhook({
      provider: 'apple',
      outcome: 'rejected',
      reason: 'missing_payload',
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: 'Missing signedPayload' }, { status: 400 });
  }

  try {
    const result = await handleAppleNotification(signedPayload);
    recordIapWebhook({
      provider: 'apple',
      outcome: result.handled ? 'handled' : 'skipped',
      notificationType: result.notificationType,
      status: result.status,
      reason: result.reason,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    // Respond 500 so Apple retries transient failures (e.g. a database hiccup).
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Apple notification error:', message);
    recordIapWebhook({
      provider: 'apple',
      outcome: 'error',
      reason: message,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
