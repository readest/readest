import { QuotaFeature, UserPlan } from './quota';

export type PaymentProvider = 'stripe' | 'apple' | 'google';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'cancelled';

export const COMPLETED_PAYMENT_STATUSES: PaymentStatus[] = ['completed', 'succeeded'];

export interface StripeProductMetadata {
  plan: UserPlan;
  feature?: QuotaFeature;
  storageGB?: string;
  translationChars?: string;
  tokensM?: string;
  customization?: string;
}

export interface BasePaymentData {
  user_id: string;
  provider: PaymentProvider;
  amount?: number; // in cents
  currency?: string;
  status: PaymentStatus;
  payment_method?: string | null;
  product_id?: string;
  storage_gb?: number;
  metadata?: Record<string, number | string | boolean>;
}

export interface StripePaymentData extends BasePaymentData {
  provider: 'stripe';
  stripe_customer_id: string;
  stripe_checkout_id: string;
  stripe_payment_intent_id: string;
}

export interface ApplePaymentData extends BasePaymentData {
  provider: 'apple';
  apple_transaction_id: string;
  apple_original_transaction_id: string;
}

export interface GooglePaymentData extends BasePaymentData {
  provider: 'google';
  google_order_id: string;
  google_purchase_token: string;
}

export type PaymentData = StripePaymentData | ApplePaymentData | GooglePaymentData;
