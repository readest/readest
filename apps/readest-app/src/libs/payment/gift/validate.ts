import { GIFT_MESSAGE_MAX, GIFT_NAME_MAX, GiftCardPatch, GiftDraftInput } from '@/types/gift';

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : null;
};

// An empty email means "no email"; a non-empty one must look like an address.
const email = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeEmail(value);
  if (!normalized) return null;
  return EMAIL_RE.test(normalized) ? normalized : undefined;
};

const FIELDS = {
  recipientName: (v: unknown) => text(v, GIFT_NAME_MAX),
  senderName: (v: unknown) => text(v, GIFT_NAME_MAX),
  message: (v: unknown) => text(v, GIFT_MESSAGE_MAX),
  recipientEmail: email,
};

export const sanitizeGiftPatch = (input: unknown): GiftCardPatch | null => {
  if (typeof input !== 'object' || input === null) return null;
  const source = input as Record<string, unknown>;
  const patch: Record<string, string | null> = {};
  for (const key of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) {
    if (!(key in source)) continue;
    const value = FIELDS[key](source[key]);
    if (value === undefined || (value === null && key !== 'recipientEmail')) return null;
    patch[key] = value;
  }
  return patch as GiftCardPatch;
};

export const sanitizeGiftDraft = (input: unknown): GiftDraftInput | null => {
  if (typeof input !== 'object' || input === null) return null;
  const tier = (input as Record<string, unknown>)['tier'];
  if (tier !== 'plus' && tier !== 'pro') return null;
  const patch = sanitizeGiftPatch(input);
  if (!patch) return null;
  return {
    tier,
    recipientName: patch.recipientName ?? '',
    senderName: patch.senderName ?? '',
    message: patch.message ?? '',
    recipientEmail: patch.recipientEmail ?? null,
  };
};
