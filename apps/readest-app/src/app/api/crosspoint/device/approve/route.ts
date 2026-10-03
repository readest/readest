import { NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { createSupabaseAdminClient } from '@/utils/supabase';

// A code as typed: any case, spacing or dash around its 8 letters.
const normalizeUserCode = (value: unknown) => {
  const letters = typeof value === 'string' ? value.toUpperCase().replace(/[\s-]/g, '') : '';
  return /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/.test(letters)
    ? `${letters.slice(0, 4)}-${letters.slice(4)}`
    : null;
};

// POST /api/crosspoint/device/approve {user_code} — the signed-in owner approves
// the code a reader shows, from the web app's /link page.
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const userCode = normalizeUserCode((body as { user_code?: unknown } | null)?.user_code);
  if (!userCode) return NextResponse.json({ error: 'Invalid code' }, { status: 400 });

  const { data, error } = await createSupabaseAdminClient()
    .from('crosspoint_device_codes')
    .update({ user_id: user.id, username: user.email ?? user.id })
    .eq('user_code', userCode)
    .is('user_id', null)
    .gt('expires_at', new Date().toISOString())
    .select('user_code');
  if (error) return NextResponse.json({ error: 'Could not approve the code' }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: 'Code not found or expired' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
