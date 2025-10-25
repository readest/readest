import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/libs/payment/stripe/server';
import { validateUserAndToken } from '@/utils/access';
import { createSupabaseAdminClient } from '@/utils/supabase';

export async function POST(request: NextRequest) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: customerData } = await supabase
      .from('customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (!customerData?.stripe_customer_id) {
      throw new Error('Customer not found');
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerData.stripe_customer_id,
      return_url: `${request.headers.get('origin')}/user`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Error creating portal session' }, { status: 500 });
  }
}
