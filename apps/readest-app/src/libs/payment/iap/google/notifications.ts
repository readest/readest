import { createSupabaseAdminClient } from '@/utils/supabase';
import { IAPStatus } from '../types';
import { mapProductIdToProductName } from '../utils';
import { markPaymentRefunded } from '../payments';
import { VerifyPurchaseParams, getGoogleIAPVerifier } from './verifier';
import { VerifiedPurchase, createOrUpdateSubscription, processPurchaseData } from './server';

// Google Play subscription RTDN notification types.
// https://developer.android.com/google/play/billing/rtdn-reference#sub
const enum SubscriptionNotificationType {
  IN_GRACE_PERIOD = 6,
  ON_HOLD = 5,
  PAUSED = 10,
  REVOKED = 12,
  EXPIRED = 13,
}

// Google Play voided purchase product types.
const VOIDED_PRODUCT_TYPE_SUBSCRIPTION = 1;

interface SubscriptionNotification {
  version?: string;
  notificationType: number;
  purchaseToken: string;
  subscriptionId: string;
}

interface OneTimeProductNotification {
  version?: string;
  notificationType: number;
  purchaseToken: string;
  sku: string;
}

interface VoidedPurchaseNotification {
  purchaseToken: string;
  orderId?: string;
  productType?: number;
  refundType?: number;
}

export interface DeveloperNotification {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  subscriptionNotification?: SubscriptionNotification;
  oneTimeProductNotification?: OneTimeProductNotification;
  voidedPurchaseNotification?: VoidedPurchaseNotification;
  testNotification?: { version?: string };
}

export interface GoogleNotificationResult {
  handled: boolean;
  reason?: string;
  notificationType?: number;
  status?: IAPStatus;
}

interface GoogleSubscriptionRow {
  user_id: string;
  product_id: string;
  order_id: string;
  package_name: string;
}

// The re-verified state is the source of truth for renewals, but terminal/grace
// events must override it: the Play API can still report a subscription as
// active immediately after a revocation, and grace periods surface as a pending
// payment state rather than an entitled one.
const overrideStatus = (status: IAPStatus, notificationType: number): IAPStatus => {
  switch (notificationType) {
    case SubscriptionNotificationType.REVOKED:
      return 'revoked';
    case SubscriptionNotificationType.EXPIRED:
    case SubscriptionNotificationType.ON_HOLD:
    case SubscriptionNotificationType.PAUSED:
      return 'expired';
    case SubscriptionNotificationType.IN_GRACE_PERIOD:
      return 'in_grace_period';
    default:
      return status;
  }
};

const buildFallbackPurchase = (
  row: GoogleSubscriptionRow,
  purchaseToken: string,
  productId: string,
  packageName: string,
  status: IAPStatus,
): VerifiedPurchase => ({
  platform: 'android',
  status,
  customerEmail: '',
  orderId: row.order_id,
  subscriptionId: row.order_id,
  planName: mapProductIdToProductName(productId),
  planType: 'subscription',
  productId,
  purchaseToken,
  expiresDate: null,
  quantity: 1,
  environment: 'production',
  packageName,
  autoRenewing: false,
});

async function handleSubscriptionNotification(
  notification: SubscriptionNotification,
  packageName: string | undefined,
): Promise<GoogleNotificationResult> {
  const { notificationType, purchaseToken, subscriptionId } = notification;
  const supabase = createSupabaseAdminClient();

  const { data: row } = await supabase
    .from('google_iap_subscriptions')
    .select('user_id, product_id, order_id, package_name')
    .eq('purchase_token', purchaseToken)
    .single();

  if (!row?.user_id) {
    return { handled: false, reason: 'subscription_not_found', notificationType };
  }

  const subRow = row as GoogleSubscriptionRow;
  const productId = subscriptionId || subRow.product_id;
  const pkg = packageName || subRow.package_name;
  const verifyParams: VerifyPurchaseParams = {
    orderId: subRow.order_id,
    purchaseToken,
    productId,
    packageName: pkg,
  };

  const verificationResult = await getGoogleIAPVerifier().verifyPurchase(verifyParams);

  if (verificationResult.success) {
    const status = overrideStatus(verificationResult.status!, notificationType);
    verificationResult.status = status;
    await processPurchaseData({ id: subRow.user_id, email: '' }, verifyParams, verificationResult);
    return { handled: true, status, notificationType };
  }

  // Re-verification failed (e.g. a revoked purchase is no longer queryable).
  // Only terminal/grace events may downgrade the user from the stored row; for
  // anything else (renewal, recovery, purchase) a failed verification is a
  // transient or environmental error, so surface it for a Pub/Sub retry
  // instead of downgrading a paying user to free.
  const isDowngradeEvent = [
    SubscriptionNotificationType.REVOKED,
    SubscriptionNotificationType.EXPIRED,
    SubscriptionNotificationType.ON_HOLD,
    SubscriptionNotificationType.PAUSED,
    SubscriptionNotificationType.IN_GRACE_PERIOD,
  ].includes(notificationType);
  if (!isDowngradeEvent) {
    throw new Error(
      `Google re-verification failed for notification type ${notificationType}: ${verificationResult.error}`,
    );
  }
  const status = overrideStatus('expired', notificationType);
  await createOrUpdateSubscription(
    subRow.user_id,
    buildFallbackPurchase(subRow, purchaseToken, productId, pkg, status),
  );
  return { handled: true, status, notificationType };
}

async function handleVoidedPurchase(
  notification: VoidedPurchaseNotification,
): Promise<GoogleNotificationResult> {
  const { purchaseToken, productType } = notification;
  const supabase = createSupabaseAdminClient();

  if (productType === VOIDED_PRODUCT_TYPE_SUBSCRIPTION) {
    const { data: row } = await supabase
      .from('google_iap_subscriptions')
      .select('user_id, product_id, order_id, package_name')
      .eq('purchase_token', purchaseToken)
      .single();

    if (!row?.user_id) {
      return { handled: false, reason: 'subscription_not_found' };
    }

    const subRow = row as GoogleSubscriptionRow;
    await createOrUpdateSubscription(
      subRow.user_id,
      buildFallbackPurchase(
        subRow,
        purchaseToken,
        subRow.product_id,
        subRow.package_name,
        'revoked',
      ),
    );
    return { handled: true, status: 'revoked' };
  }

  const { data: paymentRow } = await supabase
    .from('payments')
    .select('user_id')
    .eq('google_purchase_token', purchaseToken)
    .single();

  if (!paymentRow?.user_id) {
    return { handled: false, reason: 'payment_not_found' };
  }

  await markPaymentRefunded(paymentRow.user_id, 'google_purchase_token', purchaseToken);
  return { handled: true, status: 'revoked' };
}

export async function handleGoogleNotification(
  messageData: string,
): Promise<GoogleNotificationResult> {
  const decoded = Buffer.from(messageData, 'base64').toString('utf-8');
  const notification = JSON.parse(decoded) as DeveloperNotification;

  if (notification.testNotification) {
    return { handled: false, reason: 'test_notification' };
  }

  const expectedPackage = process.env['GOOGLE_IAP_PACKAGE_NAME'];
  if (expectedPackage && notification.packageName && notification.packageName !== expectedPackage) {
    throw new Error(`Unexpected package name: ${notification.packageName}`);
  }

  if (notification.voidedPurchaseNotification) {
    return handleVoidedPurchase(notification.voidedPurchaseNotification);
  }

  if (notification.subscriptionNotification) {
    return handleSubscriptionNotification(
      notification.subscriptionNotification,
      notification.packageName,
    );
  }

  // One-time product purchases are recorded by the client verification flow;
  // their refunds arrive as voided purchase notifications instead.
  if (notification.oneTimeProductNotification) {
    return { handled: false, reason: 'ignored_one_time_event' };
  }

  return { handled: false, reason: 'unknown_notification' };
}
