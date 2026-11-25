import { NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { claimGiftCardByCode, isTestGiftCode } from '@/libs/payment/gift/claim';
import { listGiftCards } from '@/libs/payment/gift/server';

export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  // Invalid, refunded and used codes share one answer so a code can't be probed.
  const invalid = () => NextResponse.json({ error: 'invalid_or_used' }, { status: 404 });
  if (typeof body?.code !== 'string') return invalid();
  try {
    const claimed = await claimGiftCardByCode(body.code, user.id);
    if (!claimed) {
      if (await isTestGiftCode(body.code)) {
        return NextResponse.json({ error: 'test_card' }, { status: 404 });
      }
      return invalid();
    }
    // The claim is committed. If the listing fails (a gift holder's listing
    // calls Stripe), answer success without the card: an error would make the
    // retry say "invalid or already used".
    try {
      const { received } = await listGiftCards(user.id);
      const card = received.find((c) => c.id === claimed.id);
      if (card) return NextResponse.json({ card });
      console.error('gift redeem: claimed card missing from the listing', claimed.id);
    } catch (error) {
      console.error('gift redeem: listing after a committed claim failed:', error);
    }
    return NextResponse.json({ card: null });
  } catch (error) {
    console.error('gift redeem failed:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
