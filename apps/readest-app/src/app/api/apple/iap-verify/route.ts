import { z } from 'zod';
import { NextResponse } from 'next/server';
import { IAPError } from '@/libs/payment/iap/types';
import { validateUserAndToken } from '@/utils/access';
import { getAppleIAPVerifier } from '@/libs/payment/iap/apple/verifier';
import { processPurchaseData, VerifiedPurchase } from '@/libs/payment/iap/apple/server';

const iapVerificationSchema = z.object({
  transactionId: z.string().min(1, 'Transaction ID is required'),
  originalTransactionId: z.string().min(1, 'Original Transaction ID is required'),
});

export async function POST(request: Request) {
  const body = await request.json();
  let validatedInput;
  try {
    validatedInput = iapVerificationSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid input data',
          purchase: null,
        },
        { status: 400 },
      );
    }
  }
  const { originalTransactionId } = validatedInput!;

  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: IAPError.NOT_AUTHENTICATED }, { status: 403 });
  }

  try {
    const defaultIAPVerifier = getAppleIAPVerifier();
    const verificationResult = await defaultIAPVerifier.verifyTransaction(originalTransactionId);
    if (!verificationResult.success) {
      console.error('Apple verification failed:', verificationResult.error);
      return NextResponse.json(
        {
          error: verificationResult.error || IAPError.TRANSACTION_CANNOT_BE_VERIFIED,
          purchase: null,
        },
        { status: 400 },
      );
    }

    const transaction = verificationResult.transaction!;
    console.log('Apple verification successful:', {
      transactionId: transaction.transactionId,
      productId: transaction.productId,
      environment: transaction.environment,
    });

    try {
      const purchase: VerifiedPurchase = await processPurchaseData(user, verificationResult);
      return NextResponse.json({
        purchase,
        error: null,
      });
    } catch (dbError) {
      console.error('Database update failed:', dbError);
      return NextResponse.json(
        {
          error: IAPError.TRANSACTION_SERVICE_UNAVAILABLE,
          purchase: null,
        },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error('IAP verification error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : IAPError.UNKNOWN_ERROR },
      { status: 500 },
    );
  }
}
