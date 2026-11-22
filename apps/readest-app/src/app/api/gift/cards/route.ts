import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateUserAndToken } from '@/utils/access';
import { listGiftCards, updateSentGiftCard } from '@/libs/payment/gift/server';
import { sanitizeGiftPatch } from '@/libs/payment/gift/validate';

export async function GET(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }
  try {
    return NextResponse.json(await listGiftCards(user.id));
  } catch (error) {
    console.error('gift list failed:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const id = z.string().uuid().safeParse(body?.id);
  const patch = sanitizeGiftPatch(body);
  if (!id.success || !patch) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const result = await updateSentGiftCard(user.id, id.data, patch);
    if (result === 'not_found' || result === 'email_locked') {
      return NextResponse.json({ error: result }, { status: result === 'not_found' ? 404 : 409 });
    }
    return NextResponse.json({ card: result });
  } catch (error) {
    console.error('gift update failed:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
