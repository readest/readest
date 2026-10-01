import { NextResponse } from 'next/server';
import { md5 } from 'js-md5';
import { validateUserAndToken } from '@/utils/access';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { hashKosyncKey, newKosyncKey } from '@/libs/kosyncServer';

// POST /api/crosspoint/keys — mint a KOSync key for one CrossPoint device. The
// plugin stores it as the reader's KOReader Sync password; the id lets it
// revoke the key at sign-out.
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const key = newKosyncKey();
  const { data, error } = await createSupabaseAdminClient()
    .from('kosync_keys')
    .insert({ user_id: user.id, key_hash: await hashKosyncKey(md5(key)) })
    .select('id')
    .single();
  if (error || !data) return NextResponse.json({ error: 'Could not create key' }, { status: 500 });

  return NextResponse.json({ id: data.id, username: user.id, key });
}
