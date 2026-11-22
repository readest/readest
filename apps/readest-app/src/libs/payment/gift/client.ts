import { getAPIBaseUrl, getNodeAPIBaseUrl } from '@/services/environment';
import { READEST_WEB_BASE_URL } from '@/services/constants';
import { getAccessToken } from '@/utils/access';
import type { IAPPurchase } from '@/utils/iap';
import type {
  GiftCardPatch,
  GiftCardsResponse,
  GiftDraftInput,
  GiftPrice,
  GiftTier,
  ReceivedGiftCard,
  SentGiftCard,
} from '@/types/gift';
import { fetchIAPProducts } from '../iap/client';
import { GIFT_PRODUCT_IDS, giftTierForProduct } from '../iap/utils';
import { normalizeGiftCode } from './code';

const giftRequest = async <T>(path: string, method: string, body?: unknown): Promise<T> => {
  const token = await getAccessToken();
  const response = await fetch(`${getAPIBaseUrl()}/gift/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'gift_request_failed');
  return data as T;
};

export const fetchGiftCards = (): Promise<GiftCardsResponse> => giftRequest('cards', 'GET');

export const createGiftDraft = async (input: GiftDraftInput): Promise<string> =>
  (await giftRequest<{ id: string }>('draft', 'POST', input)).id;

export const updateGiftCard = async (id: string, patch: GiftCardPatch): Promise<SentGiftCard> =>
  (await giftRequest<{ card: SentGiftCard }>('cards', 'PATCH', { id, ...patch })).card;

export const redeemGiftCode = async (code: string): Promise<ReceivedGiftCard | null> =>
  (await giftRequest<{ card: ReceivedGiftCard | null }>('redeem', 'POST', { code })).card;

export const claimGiftCards = async (): Promise<number> =>
  (await giftRequest<{ claimed: number }>('claim', 'POST', {})).claimed;

export const fetchGiftPrices = async (useIAP: boolean): Promise<GiftPrice[]> => {
  if (!useIAP) {
    const response = await fetch(`${getAPIBaseUrl()}/gift/prices`);
    const data = await response.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  }
  const products = await fetchIAPProducts(Object.values(GIFT_PRODUCT_IDS));
  return products.flatMap((product) => {
    const tier: GiftTier | null = giftTierForProduct(product.id);
    if (!tier) return [];
    return [
      {
        tier,
        productId: product.id,
        price: product.priceAmountMicros / 10000,
        currency: product.priceCurrencyCode || 'USD',
      },
    ];
  });
};

export const verifyGiftIAPPurchase = async (
  purchase: IAPPurchase,
  giftCardId: string,
): Promise<void> => {
  const token = await getAccessToken();
  const isApple = purchase.platform === 'ios';
  const response = await fetch(
    `${getNodeAPIBaseUrl()}/${isApple ? 'apple' : 'google'}/iap-verify`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(
        isApple
          ? {
              transactionId: purchase.transactionId || purchase.originalTransactionId,
              originalTransactionId: purchase.originalTransactionId,
              giftCardId,
            }
          : {
              packageName: purchase.packageName,
              productId: purchase.productId,
              orderId: purchase.orderId,
              purchaseToken: purchase.purchaseToken,
              giftCardId,
            },
      ),
    },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || 'gift_verify_failed');
  }
};

export const getGiftRedeemLink = (code: string): string =>
  `${READEST_WEB_BASE_URL}/user?gift=${normalizeGiftCode(code)}`;
