import { NextResponse } from 'next/server';
import { handleGoogleNotification } from '@/libs/payment/iap/google/notifications';
import { recordIapWebhook } from '@/libs/payment/iap/telemetry';

// Google Play Real-Time Developer Notifications (RTDN) endpoint, delivered via a
// Cloud Pub/Sub push subscription. The push URL must include the shared secret
// (`?token=...`) matching GOOGLE_RTDN_VERIFICATION_TOKEN; the notification state
// itself is re-verified against the Play Developer API in the handler.
export async function POST(request: Request) {
  const startedAt = Date.now();

  const expectedToken = process.env['GOOGLE_RTDN_VERIFICATION_TOKEN'];
  if (expectedToken) {
    const token = new URL(request.url).searchParams.get('token');
    if (token !== expectedToken) {
      recordIapWebhook({
        provider: 'google',
        outcome: 'rejected',
        reason: 'invalid_token',
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: 'Invalid verification token' }, { status: 401 });
    }
  } else {
    console.warn('GOOGLE_RTDN_VERIFICATION_TOKEN is not set; skipping token verification');
  }

  let messageData: unknown;
  try {
    const body = await request.json();
    messageData = body?.message?.data;
  } catch {
    recordIapWebhook({
      provider: 'google',
      outcome: 'rejected',
      reason: 'invalid_body',
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Pub/Sub may deliver an empty message (e.g. during endpoint validation).
  // Acknowledge it so it is not retried.
  if (typeof messageData !== 'string' || !messageData) {
    recordIapWebhook({
      provider: 'google',
      outcome: 'skipped',
      reason: 'empty_message',
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ received: true, handled: false, reason: 'empty_message' });
  }

  try {
    const result = await handleGoogleNotification(messageData);
    recordIapWebhook({
      provider: 'google',
      outcome: result.handled ? 'handled' : 'skipped',
      notificationType: result.notificationType,
      status: result.status,
      reason: result.reason,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    // Respond 500 so Pub/Sub retries transient failures.
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Google notification error:', message);
    recordIapWebhook({
      provider: 'google',
      outcome: 'error',
      reason: message,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
