import { IAPError } from '@/types/error';
import {
  AppStoreServerAPI,
  Environment,
  JWSTransactionDecodedPayload,
  decodeTransaction,
} from 'app-store-server-api';

export interface AppleIAPConfig {
  keyId: string;
  issuerId: string;
  bundleId: string;
  privateKey: string;
  environment: 'sandbox' | 'production';
}

export interface VerificationResult {
  success: boolean;
  verified?: boolean;
  status?: string;
  transaction?: JWSTransactionDecodedPayload;
  environment?: string;
  bundleId?: string;
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  purchaseDate?: Date;
  expiresDate?: Date | null;
  quantity?: number;
  type?: string;
  revocationDate?: Date | null;
  revocationReason?: number;
  webOrderLineItemId?: string;
  subscriptionGroupIdentifier?: string;
  error?: string;
}

export class AppleIAPVerifier {
  private client: AppStoreServerAPI;
  private bundleId: string;
  private environment: 'sandbox' | 'production';

  constructor(config: AppleIAPConfig) {
    this.bundleId = config.bundleId;
    this.environment = config.environment;
    this.client = new AppStoreServerAPI(
      config.privateKey,
      config.keyId,
      config.issuerId,
      config.bundleId,
      config.environment === 'sandbox' ? Environment.Sandbox : Environment.Production,
    );
  }

  async verifyTransaction(originalTransactionId: string): Promise<VerificationResult> {
    let response;
    try {
      response = await this.client.getSubscriptionStatuses(originalTransactionId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : IAPError.UNKNOWN_ERROR,
      };
    }
    if (response.data && response.data.length > 0) {
      const transaction = response.data[0]!;
      const lastTransaction = transaction.lastTransactions.find(
        (item) => item.originalTransactionId === originalTransactionId,
      );
      if (!lastTransaction) {
        return {
          success: false,
          error: IAPError.TRANSACTION_NOT_FOUND,
        };
      }
      const decodedTransaction = await decodeTransaction(lastTransaction.signedTransactionInfo);

      const status = lastTransaction.status;
      const expiresDate = decodedTransaction.expiresDate
        ? new Date(decodedTransaction.expiresDate)
        : undefined;
      const now = new Date();

      // Status 1 = Active subscription
      const isActive = status === 1 && (!expiresDate || expiresDate > now);

      return {
        success: true,
        verified: true,
        status: isActive ? 'active' : 'expired',
        transaction: decodedTransaction,
        environment: this.environment,
        bundleId: this.bundleId,
        productId: decodedTransaction.productId,
        transactionId: decodedTransaction.transactionId,
        originalTransactionId: decodedTransaction.originalTransactionId,
        purchaseDate: new Date(decodedTransaction.purchaseDate),
        expiresDate: decodedTransaction.expiresDate
          ? new Date(decodedTransaction.expiresDate)
          : null,
        quantity: decodedTransaction.quantity,
        type: decodedTransaction.type,
        revocationDate: decodedTransaction.revocationDate
          ? new Date(decodedTransaction.revocationDate)
          : null,
        revocationReason: decodedTransaction.revocationReason,
        webOrderLineItemId: decodedTransaction.webOrderLineItemId,
        subscriptionGroupIdentifier: decodedTransaction.subscriptionGroupIdentifier,
      };
    } else {
      return {
        success: false,
        error: IAPError.TRANSACTION_NOT_FOUND,
      };
    }
  }
}

export const createAppleIAPVerifier = (config: AppleIAPConfig) => new AppleIAPVerifier(config);

let defaultIAPVerifier: AppleIAPVerifier | undefined;
export const getAppleIAPVerifier = () => {
  if (!defaultIAPVerifier) {
    defaultIAPVerifier = createAppleIAPVerifier({
      keyId: process.env['APPLE_IAP_KEY_ID']!,
      issuerId: process.env['APPLE_IAP_ISSUER_ID']!,
      bundleId: process.env['APPLE_IAP_BUNDLE_ID']!,
      privateKey: Buffer.from(
        process.env['APPLE_IAP_PRIVATE_KEY_BASE64']! || '',
        'base64',
      ).toString('utf-8'),
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
    });
  }
  return defaultIAPVerifier;
};
