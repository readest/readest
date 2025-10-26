import { describe, it, expect, beforeAll } from 'vitest';
import { AppleIAPVerifier, createAppleIAPVerifier } from '@/libs/payment/iap/apple/verifier';

const SKIP_IAP_API_TESTS = !process.env['ENABLE_IAP_API_TESTS'];
const REAL_TEST_DATA = {
  validSubscription: {
    transactionId: '2000000976418990',
    originalTransactionId: '2000000968585424',
    productId: 'com.bilingify.readest.monthly.plus',
  },

  expiredSubscription: {
    transactionId: '2000000969189989',
    originalTransactionId: '2000000969189989',
    productId: 'com.bilingify.readest.monthly.plus',
  },

  refundedTransaction: {
    transactionId: '1000000555666777',
    originalTransactionId: '1000000555666777',
    productId: 'com.bilingify.readest.monthly.plus',
  },
};

describe.skipIf(SKIP_IAP_API_TESTS)('Apple IAP Integration Tests', () => {
  let verifier: AppleIAPVerifier;

  beforeAll(() => {
    verifier = createAppleIAPVerifier({
      keyId: process.env['APPLE_IAP_KEY_ID']!,
      issuerId: process.env['APPLE_IAP_ISSUER_ID']!,
      bundleId: process.env['APPLE_IAP_BUNDLE_ID']!,
      privateKey: atob(process.env['APPLE_IAP_PRIVATE_KEY_BASE64']!),
      environment: 'sandbox',
    });
  });

  describe('Transaction Verification', () => {
    it('should verify a real valid transaction', async () => {
      const { transactionId, originalTransactionId } = REAL_TEST_DATA.validSubscription;

      const result = await verifier.verifyTransaction(originalTransactionId);

      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.status).toBe('expired');
      expect(result.transactionId).toBe(transactionId);
      expect(result.originalTransactionId).toBe(originalTransactionId);
      expect(result.bundleId).toBe(process.env['APPLE_IAP_BUNDLE_ID']);
      expect(result.productId).toBeTruthy();
      expect(result.purchaseDate).toBeInstanceOf(Date);
    }, 10000);

    it('should handle expired subscription correctly', async () => {
      const { originalTransactionId } = REAL_TEST_DATA.expiredSubscription;

      const result = await verifier.verifyTransaction(originalTransactionId);

      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.status).toBe('expired');
    }, 10000);

    it('should reject invalid transaction IDs', async () => {
      const result = await verifier.verifyTransaction('invalid_transaction_id');

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    }, 10000);
  });
});
