import { google, androidpublisher_v3 } from 'googleapis';
import { GoogleAuth, GoogleAuthOptions } from 'google-auth-library';
import { IAPStatus } from '../types';

export interface VerifyPurchaseParams {
  orderId: string;
  purchaseToken: string;
  productId: string;
  packageName: string;
}

export interface SubscriptionPurchase {
  kind?: string | null;
  startTimeMillis?: string | null;
  expiryTimeMillis?: string | null;
  autoRenewing?: boolean | null;
  priceCurrencyCode?: string | null;
  priceAmountMicros?: string | null;
  countryCode?: string | null;
  developerPayload?: string | null;
  paymentState?: number | null;
  cancelReason?: number | null;
  userCancellationTimeMillis?: string | null;
  orderId?: string | null;
  linkedPurchaseToken?: string | null;
  purchaseType?: number | null;
  acknowledgementState?: number | null;
  purchaseState?: number | null;
  quantity?: number | null;
  obfuscatedExternalAccountId?: string | null;
  obfuscatedExternalProfileId?: string | null;
}

export interface ProductPurchase {
  kind?: string | null;
  purchaseTimeMillis?: string | null;
  purchaseState?: number | null;
  consumptionState?: number | null;
  developerPayload?: string | null;
  orderId?: string | null;
  purchaseType?: number | null;
  acknowledgementState?: number | null;
  purchaseToken?: string | null;
  productId?: string | null;
  quantity?: number | null;
  obfuscatedExternalAccountId?: string | null;
  obfuscatedExternalProfileId?: string | null;
  regionCode?: string | null;
}

type PurchaseType = 'subscription' | 'product';

export interface VerificationResult {
  success: boolean;
  error?: string;
  status?: IAPStatus;
  purchaseDate?: Date;
  expiresDate?: Date | null;
  revocationDate?: Date | null;
  revocationReason?: number | null;
  purchaseData?: SubscriptionPurchase | ProductPurchase;
  purchaseType?: PurchaseType;
}

export class GoogleIAPVerifier {
  private auth: GoogleAuth;
  private androidPublisher: androidpublisher_v3.Androidpublisher;

  constructor() {
    const authOptions: GoogleAuthOptions = {
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    };

    if (process.env['GOOGLE_IAP_SERVICE_ACCOUNT_KEY']) {
      try {
        authOptions.credentials = JSON.parse(process.env['GOOGLE_IAP_SERVICE_ACCOUNT_KEY']);
      } catch (e) {
        console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:', e);
        throw new Error('Invalid Google service account credentials');
      }
    } else {
      console.warn('Using Application Default Credentials');
    }

    this.auth = new GoogleAuth(authOptions);

    this.androidPublisher = google.androidpublisher({
      version: 'v3',
      auth: this.auth,
    });
  }

  async verifyPurchase(params: VerifyPurchaseParams): Promise<VerificationResult> {
    try {
      // First, try to verify as a subscription
      const subscriptionResult = await this.verifySubscription(params);
      if (subscriptionResult.success) {
        return subscriptionResult;
      }

      // If subscription verification fails, try as a one-time product purchase
      const productResult = await this.verifyProduct(params);
      if (productResult.success) {
        return productResult;
      }

      return {
        success: false,
        error: 'Unable to verify purchase as subscription or product',
      };
    } catch (error) {
      console.error('Google Play verification error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown verification error',
      };
    }
  }

  private async verifySubscription(params: VerifyPurchaseParams): Promise<VerificationResult> {
    const { purchaseToken, productId, packageName } = params;

    try {
      const response = await this.androidPublisher.purchases.subscriptions.get({
        packageName,
        subscriptionId: productId,
        token: purchaseToken,
      });

      const purchase: SubscriptionPurchase = response.data;

      // Check if the subscription is valid
      const now = Date.now();
      const expiryTime = purchase.expiryTimeMillis ? parseInt(purchase.expiryTimeMillis) : 0;
      const startTime = purchase.startTimeMillis ? parseInt(purchase.startTimeMillis) : 0;

      let status: IAPStatus = 'expired';
      if (purchase.paymentState === 1 && expiryTime > now) {
        status = 'active';
      } else if (purchase.paymentState === 0) {
        status = 'pending';
      } else if (purchase.userCancellationTimeMillis) {
        status = 'cancelled';
      }

      return {
        success: true,
        status,
        purchaseDate: startTime ? new Date(startTime) : undefined,
        expiresDate: expiryTime ? new Date(expiryTime) : null,
        revocationDate: purchase.userCancellationTimeMillis
          ? new Date(parseInt(purchase.userCancellationTimeMillis))
          : null,
        revocationReason: purchase.cancelReason || null,
        purchaseData: purchase,
        purchaseType: 'subscription',
      };
    } catch {
      return {
        success: false,
        error: 'Not a subscription purchase',
      };
    }
  }

  private async verifyProduct(params: VerifyPurchaseParams): Promise<VerificationResult> {
    const { purchaseToken, productId, packageName } = params;

    try {
      const response = await this.androidPublisher.purchases.products.get({
        packageName,
        productId,
        token: purchaseToken,
      });

      const purchase: ProductPurchase = response.data;

      // Check purchase state (0 = purchased, 1 = cancelled)
      const status = purchase.purchaseState === 0 ? 'active' : 'cancelled';
      const purchaseTime = purchase.purchaseTimeMillis ? parseInt(purchase.purchaseTimeMillis) : 0;

      return {
        success: true,
        status,
        purchaseDate: purchaseTime ? new Date(purchaseTime) : undefined,
        expiresDate: null, // One-time purchases don't expire
        revocationDate: null,
        revocationReason: null,
        purchaseData: purchase,
        purchaseType: 'product',
      };
    } catch {
      return {
        success: false,
        error: 'Purchase not found',
      };
    }
  }

  async acknowledgePurchase(params: VerifyPurchaseParams): Promise<void> {
    const { purchaseToken, productId, packageName } = params;

    try {
      // Try to acknowledge as subscription first
      await this.androidPublisher.purchases.subscriptions.acknowledge({
        packageName,
        subscriptionId: productId,
        token: purchaseToken,
      });
    } catch {
      try {
        await this.androidPublisher.purchases.products.acknowledge({
          packageName,
          productId,
          token: purchaseToken,
        });
      } catch (productError) {
        console.error('Failed to acknowledge product purchase:', productError);
        throw productError;
      }
    }
  }

  async cancelSubscription(params: VerifyPurchaseParams): Promise<void> {
    const { purchaseToken, productId, packageName } = params;

    try {
      await this.androidPublisher.purchases.subscriptions.cancel({
        packageName,
        subscriptionId: productId,
        token: purchaseToken,
      });
    } catch (error) {
      console.error('Failed to cancel subscription:', error);
      throw error;
    }
  }

  async refundSubscription(params: VerifyPurchaseParams): Promise<void> {
    const { purchaseToken, productId, packageName } = params;

    try {
      await this.androidPublisher.purchases.subscriptions.refund({
        packageName,
        subscriptionId: productId,
        token: purchaseToken,
      });
    } catch (error) {
      console.error('Failed to refund subscription:', error);
      throw error;
    }
  }

  async deferSubscription(
    params: VerifyPurchaseParams & {
      desiredExpiryTimeMillis: string;
    },
  ): Promise<void> {
    const { purchaseToken, productId, packageName, desiredExpiryTimeMillis } = params;

    try {
      await this.androidPublisher.purchases.subscriptions.defer({
        packageName,
        subscriptionId: productId,
        token: purchaseToken,
        requestBody: {
          deferralInfo: {
            desiredExpiryTimeMillis,
          },
        },
      });
    } catch (error) {
      console.error('Failed to defer subscription:', error);
      throw error;
    }
  }
}

// Singleton instance
let verifierInstance: GoogleIAPVerifier | null = null;

export function getGoogleIAPVerifier(): GoogleIAPVerifier {
  if (!verifierInstance) {
    verifierInstance = new GoogleIAPVerifier();
  }
  return verifierInstance;
}
