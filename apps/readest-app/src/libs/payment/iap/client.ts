import { AvailablePlan } from '@/types/quota';
import { IAPService, IAPPurchase, IAPProduct } from '@/utils/iap';
import { mapProductIdToInterval, mapProductIdToUserPlan } from './utils';

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
