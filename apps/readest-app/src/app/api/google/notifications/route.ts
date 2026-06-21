import { NextResponse } from 'next/server';
import { handleGoogleNotification } from '@/libs/payment/iap/google/notifications';

// Google Play Real-Time Developer Notifications (RTDN) endpoint, delivered via a
// Cloud Pub/Sub push subscription. The push URL must include the shared secret
// (`?token=...`) matching GOOGLE_RTDN_VERIFICATION_TOKEN; the notification state
// itself is re-verified against the Play Developer API in the handler.
export async function POST(request: Request) {
  const expectedToken = process.env['GOOGLE_RTDN_VERIFICATION_TOKEN'];
  if (expectedToken) {
    const token = new URL(request.url).searchParams.get('token');
    if (token !== expectedToken) {
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
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Pub/Sub may deliver an empty message (e.g. during endpoint validation).
  // Acknowledge it so it is not retried.
  if (typeof messageData !== 'string' || !messageData) {
    return NextResponse.json({ received: true, handled: false, reason: 'empty_message' });
  }

  try {
    const result = await handleGoogleNotification(messageData);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    // Respond 500 so Pub/Sub retries transient failures.
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Google notification error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
