export type GiftTier = 'plus' | 'pro';
export type GiftCardStatus = 'pending' | 'active' | 'refunded';
export type GiftPaymentColumn =
  | 'stripe_payment_intent_id'
  | 'apple_original_transaction_id'
  | 'google_purchase_token';

export const GIFT_MESSAGE_MAX = 300;
export const GIFT_NAME_MAX = 60;
export const GIFT_DAYS = 365;

export interface GiftCardRow {
  id: string;
  buyer_id: string | null;
  tier: GiftTier;
  days: number;
  status: GiftCardStatus;
  recipient_name: string | null;
  sender_name: string | null;
  message: string | null;
  recipient_email: string | null;
  code: string;
  provider: 'stripe' | 'apple' | 'google' | 'readest' | null;
  stripe_payment_intent_id: string | null;
  apple_original_transaction_id: string | null;
  google_purchase_token: string | null;
  purchased_at: string | null;
  test: boolean;
  redeemed_by: string | null;
  redeemed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GiftCardFace {
  tier: GiftTier;
  recipientName: string;
  senderName: string;
  message: string;
}

export type SentGiftStatus = 'unredeemed' | 'waiting' | 'redeemed' | 'refunded';

export interface SentGiftCard extends GiftCardFace {
  id: string;
  status: SentGiftStatus;
  /** Bought in a store's sandbox: shown, never claimed. */
  test: boolean;
  recipientEmail: string | null;
  code: string | null;
  purchasedAt: string;
  redeemedAt: string | null;
}

export interface ReceivedGiftCard extends GiftCardFace {
  id: string;
  startsAt: string;
  endsAt: string;
}

export interface GiftCardsResponse {
  sent: SentGiftCard[];
  received: ReceivedGiftCard[];
  giftPlan: 'free' | GiftTier;
  giftActiveUntil: string | null;
  giftOnly: boolean;
}

export interface GiftDraftInput {
  tier: GiftTier;
  recipientName: string;
  senderName: string;
  message: string;
  recipientEmail: string | null;
}

export type GiftCardPatch = Partial<Omit<GiftDraftInput, 'tier'>>;

export interface GiftPrice {
  tier: GiftTier;
  productId: string;
  price: number;
  currency: string;
}
