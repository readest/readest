import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { hashDeviceKey, newSecret, sha256Hex } from '@/libs/crosspoint';

// The user's own Readest session, as a password sign-in would return it. The
// magic link is never sent: its token is verified here instead.
const startSession = async (userId: string) => {
  const admin = createSupabaseAdminClient();
  const { data: userData } = await admin.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (!email) return null;
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !link) return null;
  // verifyOtp signs this client in, so it is used for nothing after it.
  const { data } = await admin.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
  });
  const session = data?.session;
  if (!session) return null;
  const { id, user_metadata } = session.user;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: { id, email: session.user.email, user_metadata },
  };
};

// POST /api/crosspoint/device/token {device_code, grant?} — poll a reader sign-in.
// Answers like an OAuth device access token request: 400 authorization_pending
// until the owner approves the code, then, once, the reader's own key, or
// with grant "session" (the KOReader plugin) a Readest session.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    device_code?: unknown;
    grant?: unknown;
  } | null;
  const deviceCode = body?.device_code;
  if (typeof deviceCode !== 'string' || !deviceCode) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const codeHash = await sha256Hex(deviceCode);
  const now = new Date().toISOString();
  // Deleting the approved sign-in claims it, so only one poll mints a key.
  const { data: claimed, error } = await supabase
    .from('crosspoint_device_codes')
    .delete()
    .eq('device_code_hash', codeHash)
    .not('user_id', 'is', null)
    .gt('expires_at', now)
    .select('user_code, user_id, username, expires_at');
  if (error) return NextResponse.json({ error: 'server_error' }, { status: 500 });

  const approved = claimed?.[0];
  if (!approved) {
    const { data: pending, error: pendingError } = await supabase
      .from('crosspoint_device_codes')
      .select('expires_at')
      .eq('device_code_hash', codeHash)
      .gt('expires_at', now)
      .maybeSingle();
    if (pendingError) return NextResponse.json({ error: 'server_error' }, { status: 500 });
    return NextResponse.json(
      { error: pending ? 'authorization_pending' : 'expired_token' },
      { status: 400 },
    );
  }

  // Puts the approval back, so the reader's next poll can still sign in.
  const restore = () =>
    supabase.from('crosspoint_device_codes').insert({ device_code_hash: codeHash, ...approved });

  if (body?.grant === 'session') {
    const session = await startSession(approved.user_id);
    if (!session) {
      await restore();
      return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }
    return NextResponse.json(session);
  }

  const key = newSecret();
  const { data: device, error: insertError } = await supabase
    .from('crosspoint_devices')
    .insert({ user_id: approved.user_id, key_hash: await hashDeviceKey(key) })
    .select('id')
    .single();
  if (insertError || !device) {
    await restore();
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  // id lets the plugin revoke the key; username labels the reader's KOReader Sync settings.
  return NextResponse.json({
    access_token: key,
    token_type: 'bearer',
    id: device.id,
    username: approved.username,
  });
}
