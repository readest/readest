import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { authenticateDevice } from '@/libs/crosspoint';

// GET /api/crosspoint/users/auth — KOSync credential check.
export async function GET(request: Request) {
  const userId = await authenticateDevice(request, createSupabaseAdminClient());
  if (typeof userId !== 'string') return userId;
  return NextResponse.json({ authorized: 'OK' });
}
