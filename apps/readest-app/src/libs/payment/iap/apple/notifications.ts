import {
  AutoRenewStatus,
  JWSRenewalInfoDecodedPayload,
  JWSTransactionDecodedPayload,
  NotificationSubtype,
  NotificationType,
  TransactionType,
  decodeNotificationPayload,
  decodeRenewalInfo,
  decodeTransaction,
  isDecodedNotificationDataPayload,
} from 'app-store-server-api';
import { PlanType } from '@/types/quota';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { IAPStatus } from '../types';
import { mapProductIdToProductName } from '../utils';
import { markPaymentRefunded } from '../payments';
import { VerifiedPurchase, createOrUpdateSubscription } from './server';

export interface AppleNotificationResult {
  handled: boolean;
  reason?: string;
  notificationType?: string;
  status?: IAPStatus;
}

const statusFromExpiry = (expiresDate?: number): IAPStatus =>
  expiresDate && expiresDate > Date.now() ? 'active' : 'expired';

/**
 * Derive the effective entitlement status of a subscription from the App Store
 * notification type. The signed transaction is the source of truth for dates,
 * but the notification type tells us how to interpret the event (refund,
 * revoke, grace period, ...) which the transaction alone does not.
 */
const deriveSubscriptionStatus = (
  type: NotificationType,
  subtype: NotificationSubtype | undefined,
  transaction: JWSTransactionDecodedPayload,
): IAPStatus => {
  switch (type) {
    case NotificationType.Subscribed:
    case NotificationType.DidRenew:
    case NotificationType.OfferRedeemed:
    case NotificationType.RenewalExtended:
    case NotificationType.RefundReversed:
    case NotificationType.RefundDeclined:
      return 'active';
    case NotificationType.Expired:
    case NotificationType.GracePeriodExpired:
      return 'expired';
    case NotificationType.Refund:
    case NotificationType.Revoke:
      return 'revoked';
    case NotificationType.DidFailToRenew:
      return subtype === NotificationSubtype.GracePeriod
        ? 'in_grace_period'
        : statusFromExpiry(transaction.expiresDate);
    // DID_CHANGE_RENEWAL_STATUS, DID_CHANGE_RENEWAL_PREF, PRICE_INCREASE, ...:
    // entitlement is unchanged, the subscription stays active until it expires.
    default:
      return statusFromExpiry(transaction.expiresDate);
  }
};

export async function handleAppleNotification(
  signedPayload: string,
): Promise<AppleNotificationResult> {
  const payload = await decodeNotificationPayload(signedPayload);

  // Summary payloads (e.g. RENEWAL_EXTENSION SUMMARY) carry aggregate results
  // for a request rather than a single transaction; nothing to update.
  if (!isDecodedNotificationDataPayload(payload)) {
    return { handled: false, reason: 'summary_notification' };
  }

  const expectedBundleId = process.env['APPLE_IAP_BUNDLE_ID'];
  if (expectedBundleId && payload.data.bundleId !== expectedBundleId) {
    throw new Error(`Unexpected bundle id: ${payload.data.bundleId}`);
  }

  const transaction = await decodeTransaction(payload.data.signedTransactionInfo);
  const renewalInfo: JWSRenewalInfoDecodedPayload | undefined = payload.data.signedRenewalInfo
    ? await decodeRenewalInfo(payload.data.signedRenewalInfo)
    : undefined;

  const planType: PlanType =
    transaction.type === TransactionType.NonConsumable ||
    transaction.type === TransactionType.Consumable
      ? 'purchase'
      : 'subscription';

  const supabase = createSupabaseAdminClient();
  const notificationType = payload.notificationType;

  if (planType === 'purchase') {
    // One-time purchases are recorded by the client verification flow; the only
    // webhook events that matter are refunds/revocations.
    if (
      notificationType !== NotificationType.Refund &&
      notificationType !== NotificationType.Revoke
    ) {
      return { handled: false, reason: 'ignored_purchase_event', notificationType };
    }

    const { data: paymentRow } = await supabase
      .from('payments')
      .select('user_id')
      .eq('apple_original_transaction_id', transaction.originalTransactionId)
      .single();

    if (!paymentRow?.user_id) {
      return { handled: false, reason: 'payment_not_found', notificationType };
    }

    await markPaymentRefunded(
      paymentRow.user_id,
      'apple_original_transaction_id',
      transaction.originalTransactionId,
    );
    return { handled: true, status: 'revoked', notificationType };
  }

  const { data: subRow } = await supabase
    .from('apple_iap_subscriptions')
    .select('user_id')
    .eq('original_transaction_id', transaction.originalTransactionId)
    .single();

  if (!subRow?.user_id) {
    return { handled: false, reason: 'subscription_not_found', notificationType };
  }

  const status = deriveSubscriptionStatus(notificationType, payload.subtype, transaction);
  const autoRenewStatus = renewalInfo
    ? renewalInfo.autoRenewStatus === AutoRenewStatus.On
    : undefined;

  const purchase: VerifiedPurchase = {
    platform: 'ios',
    status,
    customerEmail: '',
    orderId: transaction.webOrderLineItemId || transaction.originalTransactionId,
    subscriptionId: transaction.webOrderLineItemId || transaction.originalTransactionId,
    planName: mapProductIdToProductName(transaction.productId),
    planType: 'subscription',
    productId: transaction.productId,
    transactionId: transaction.transactionId,
    originalTransactionId: transaction.originalTransactionId,
    purchaseDate: new Date(transaction.purchaseDate).toISOString(),
    expiresDate: transaction.expiresDate ? new Date(transaction.expiresDate).toISOString() : null,
    quantity: transaction.quantity,
    environment: String(payload.data.environment).toLowerCase(),
    bundleId: payload.data.bundleId,
    webOrderLineItemId: transaction.webOrderLineItemId,
    subscriptionGroupIdentifier: transaction.subscriptionGroupIdentifier,
    type: transaction.type,
    revocationDate: transaction.revocationDate
      ? new Date(transaction.revocationDate).toISOString()
      : null,
    revocationReason: transaction.revocationReason ?? null,
    autoRenewStatus,
  };

  await createOrUpdateSubscription(subRow.user_id, purchase);

  return { handled: true, status, notificationType };
}
