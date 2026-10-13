import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { hashDeviceKey, newSecret, sha256Hex } from '@/libs/crosspoint';

// POST /api/crosspoint/device/token {device_code} — poll a reader sign-in.
// Answers like an OAuth device access token request: 400 authorization_pending
// until the owner approves the code, then the reader's own key, once.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const deviceCode = (body as { device_code?: unknown } | null)?.device_code;
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

  const key = newSecret();
  const { data: device, error: insertError } = await supabase
    .from('crosspoint_devices')
    .insert({ user_id: approved.user_id, key_hash: await hashDeviceKey(key) })
    .select('id')
    .single();
  if (insertError || !device) {
    // Put the approval back, so the reader's next poll can still get a key.
    await supabase
      .from('crosspoint_device_codes')
      .insert({ device_code_hash: codeHash, ...approved });
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
