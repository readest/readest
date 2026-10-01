import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { authenticateKosync } from '@/libs/kosyncServer';

// GET /api/crosspoint/users/auth — KOSync credential check.
export async function GET(request: Request) {
  const userId = await authenticateKosync(request, createSupabaseAdminClient());
  if (!userId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ authorized: 'OK' });
}
