import { NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { createGiftDraft } from '@/libs/payment/gift/server';
import { sanitizeGiftDraft } from '@/libs/payment/gift/validate';

export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }
  const input = sanitizeGiftDraft(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    return NextResponse.json(await createGiftDraft(user.id, input));
  } catch (error) {
    console.error('gift draft failed:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
