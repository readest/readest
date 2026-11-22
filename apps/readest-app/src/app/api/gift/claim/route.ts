import { NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { claimGiftCardsForEmail } from '@/libs/payment/gift/claim';

export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }
  try {
    // The token claims don't say whether the address is confirmed; only a
    // confirmed address proves the user owns the mailbox.
    const { data } = await createSupabaseAdminClient().auth.admin.getUserById(user.id);
    const { email, email_confirmed_at } = data?.user ?? {};
    if (!email || !email_confirmed_at) return NextResponse.json({ claimed: 0 });
    return NextResponse.json({ claimed: await claimGiftCardsForEmail(user.id, email) });
  } catch (error) {
    console.error('gift claim failed:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
