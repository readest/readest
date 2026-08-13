import { AvailablePlan } from '@/types/quota';
import { getNodeAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { IAPService, IAPPurchase, IAPProduct } from '@/utils/iap';
import { isPurchaseProduct, mapProductIdToInterval, mapProductIdToUserPlan } from './utils';

const SUBSCRIPTION_SUCCESS_PATH = '/user/subscription/success';

export const getPurchaseVerifyParams = (purchase: IAPPurchase) => {
  return new URLSearchParams({
    payment: 'iap',
    platform: purchase.platform,
    product_id: purchase.productId,
    transaction_id: purchase.transactionId || '',
    original_transaction_id: purchase.originalTransactionId || '',
    package_name: purchase.packageName || '',
    order_id: purchase.orderId || '',
    purchase_token: purchase.purchaseToken || '',
  });
};

export const isIAPAvailable = async () => {
  const available = await IAPService.isAvailable();
  return available;
};

export const purchaseIAPProduct = async (productId: string) => {
  const iapService = new IAPService();
  const purchase = await iapService.purchaseProduct(productId);
  return purchase;
};

export const restoreIAPPurchases = async () => {
  const iapService = new IAPService();
  const purchases = await iapService.restorePurchases();
  return purchases;
};

// One-time products (storage add-ons) restored from Google Play may still be
// unconsumed — e.g. bought before the server learned to consume them — which
// blocks repurchasing the same SKU. Re-verifying them lets the server record
// and consume each one; replays are deduped by purchase token server-side.
export const verifyGooglePurchaseProducts = async (purchases: IAPPurchase[]) => {
  const products = purchases.filter(
    (p) => p.platform === 'android' && isPurchaseProduct(p.productId) && p.purchaseToken,
  );
  if (products.length === 0) return;

  try {
    const token = await getAccessToken();
    if (!token) return;

    await Promise.allSettled(
      products.map((purchase) =>
        fetch(`${getNodeAPIBaseUrl()}/google/iap-verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            packageName: purchase.packageName,
            productId: purchase.productId,
            orderId: purchase.orderId,
            purchaseToken: purchase.purchaseToken,
          }),
        }),
      ),
    );
  } catch (error) {
    console.error('Failed to verify restored purchase products:', error);
  }
};

// An iOS storage purchase whose one-shot client verification never reached the
// server (network failure, app closed mid-flow) is recorded nowhere: the App
// Store webhook deliberately ignores one-time purchase events. Restore is the
// only flow that sees the transaction again, so re-verify each restored
// one-time iOS purchase; replays are deduped by original transaction id
// server-side.
export const verifyApplePurchaseProducts = async (purchases: IAPPurchase[]) => {
  const products = purchases.filter(
    (p) => p.platform === 'ios' && isPurchaseProduct(p.productId) && p.originalTransactionId,
  );
  if (products.length === 0) return;

  try {
    const token = await getAccessToken();
    if (!token) return;

    await Promise.allSettled(
      products.map((purchase) =>
        fetch(`${getNodeAPIBaseUrl()}/apple/iap-verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            transactionId: purchase.transactionId || purchase.originalTransactionId,
            originalTransactionId: purchase.originalTransactionId,
          }),
        }),
      ),
    );
  } catch (error) {
    console.error('Failed to verify restored purchase products:', error);
  }
};

export const initializeIAP = async () => {
  const iapService = new IAPService();
  await iapService.initialize();
  return iapService;
};

export const fetchIAPProducts = async (productIds: string[]) => {
  const iapService = new IAPService();
  await iapService.initialize();
  const products = await iapService.fetchProducts(productIds);
  return products;
};

export const transformIAPProductToAvailablePlan = (product: IAPProduct): AvailablePlan => {
  return {
    plan: mapProductIdToUserPlan(product.id),
    productId: product.id,
    price: product.priceAmountMicros / 10000,
    currency: product.priceCurrencyCode || 'USD',
    interval: mapProductIdToInterval(product.id),
    productName: product.title,
  };
};

export const fetchAndTransformIAPPlans = async (productIds: string[]): Promise<AvailablePlan[]> => {
  const products = await fetchIAPProducts(productIds);
  return products.map(transformIAPProductToAvailablePlan);
};

export const getSubscriptionSuccessUrl = (purchase: IAPPurchase) => {
  const params = getPurchaseVerifyParams(purchase);
  return `${SUBSCRIPTION_SUCCESS_PATH}?${params.toString()}`;
};
