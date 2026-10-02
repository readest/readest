import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { newSecret, sha256Hex } from '@/libs/crosspoint';

const EXPIRES_IN_SECONDS = 600;
const POLL_INTERVAL_SECONDS = 5;
// Consonants only (RFC 8628): codes spell no words and survive misreading.
const USER_CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';

const newUserCode = () => {
  const letters = Array.from(
    crypto.getRandomValues(new Uint32Array(8)),
    (n) => USER_CODE_LETTERS[n % USER_CODE_LETTERS.length],
  ).join('');
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
};

// POST /api/crosspoint/device/code — start a reader sign-in (an OAuth device
// authorization grant). The Readest card on the reader's web Settings page
// shows the code and the link, then polls /device/token while its owner
// approves the code on the web app.
export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient();
  const now = Date.now();
  // Nothing claims an expired sign-in, so clear them here.
  await supabase
    .from('crosspoint_device_codes')
    .delete()
    .lt('expires_at', new Date(now).toISOString());

  const deviceCode = newSecret();
  const userCode = newUserCode();
  const { error } = await supabase.from('crosspoint_device_codes').insert({
    device_code_hash: await sha256Hex(deviceCode),
    user_code: userCode,
    expires_at: new Date(now + EXPIRES_IN_SECONDS * 1000).toISOString(),
  });
  if (error) return NextResponse.json({ error: 'server_error' }, { status: 500 });

  const link = `${new URL(request.url).origin}/link`;
  return NextResponse.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: link,
    verification_uri_complete: `${link}?code=${userCode}`,
    expires_in: EXPIRES_IN_SECONDS,
    interval: POLL_INTERVAL_SECONDS,
  });
}
