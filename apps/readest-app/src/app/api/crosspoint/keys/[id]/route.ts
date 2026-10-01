import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { isUuid } from '@/libs/kosyncServer';

// DELETE /api/crosspoint/keys/:id — revoke a device key. The random id is the
// capability: the plugin keeps it outside its secret files so sign-out can
// revoke the key, and it grants nothing beyond revoking that one key.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid key id' }, { status: 400 });

  const { error } = await createSupabaseAdminClient().from('kosync_keys').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Could not revoke key' }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
