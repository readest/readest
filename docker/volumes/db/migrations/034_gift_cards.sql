-- Migration 034: gift cards (one-year Plus/Pro gifts).
-- Apply this migration to production Supabase BEFORE the gift card code merges:
-- the repo's schema does not hold the production plans/payments tables, so the
-- owner runs it by hand. Self-hosted Docker runs it with the other migrations,
-- so every statement is idempotent.
--
-- One row per card. RLS is on with no policies: only the API (service role)
-- reads and writes. The recipient email is set once; the guard trigger blocks
-- later changes unless support reassigns it through reassign_gift_email().
--
-- A card is claimed when redeemed_at is set. redeemed_by is cleared if the
-- recipient deletes their account (ON DELETE SET NULL), and that must not
-- make the card claimable again, so every claim check keys on redeemed_at.

CREATE TABLE IF NOT EXISTS public.gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  tier text NOT NULL CHECK (tier IN ('plus', 'pro')),
  days integer NOT NULL DEFAULT 365,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'refunded')),
  recipient_name text CHECK (char_length(recipient_name) <= 60),
  sender_name text CHECK (char_length(sender_name) <= 60),
  message text CHECK (char_length(message) <= 300),
  recipient_email text CHECK (recipient_email IS NULL OR recipient_email = lower(btrim(recipient_email))),
  code text NOT NULL UNIQUE,
  -- 'readest' is a card Readest issues itself, with no payment behind it.
  provider text CHECK (provider IN ('stripe', 'apple', 'google', 'readest')),
  stripe_payment_intent_id text UNIQUE,
  apple_original_transaction_id text UNIQUE,
  google_purchase_token text UNIQUE,
  purchased_at timestamp with time zone,
  -- Bought in Apple's sandbox or by a Play license tester, so paid for by no
  -- one: it shows to its buyer but is never claimed, by code or by email.
  test boolean NOT NULL DEFAULT false,
  redeemed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  redeemed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
-- A table made before the column existed (self-hosted runs re-apply this).
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS test boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_gift_cards_buyer_id ON public.gift_cards (buyer_id);
CREATE INDEX IF NOT EXISTS idx_gift_cards_redeemed_by ON public.gift_cards (redeemed_by);
CREATE INDEX IF NOT EXISTS idx_gift_cards_unredeemed_email ON public.gift_cards (recipient_email)
  WHERE redeemed_at IS NULL;

ALTER TABLE public.gift_cards ENABLE ROW LEVEL SECURITY;

-- The email can't change once set, and can't be set after redemption, unless
-- reassign_gift_email() raised its transaction-local flag.
CREATE OR REPLACE FUNCTION public.gift_cards_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.recipient_email IS DISTINCT FROM OLD.recipient_email
     AND coalesce(current_setting('readest.gift_email_reassign', true), '') <> 'on'
     AND (OLD.recipient_email IS NOT NULL OR OLD.redeemed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'gift card recipient email cannot be changed';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gift_cards_guard ON public.gift_cards;
CREATE TRIGGER gift_cards_guard BEFORE UPDATE ON public.gift_cards
  FOR EACH ROW EXECUTE FUNCTION public.gift_cards_guard();

-- Id of the confirmed auth user with this email, for claiming at purchase.
-- Cards hold lowercase emails; accounts made before GoTrue lowercased them
-- may not, so the account side is lowered too.
CREATE OR REPLACE FUNCTION public.gift_user_id_for_email(p_email text) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id FROM auth.users u
  WHERE lower(u.email) = lower(trim(p_email)) AND u.email_confirmed_at IS NOT NULL
  LIMIT 1;
$$;

-- Cron sweep: hand active, unclaimed cards to their confirmed recipients.
CREATE OR REPLACE FUNCTION public.claim_gifts_for_confirmed_emails() RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.gift_cards g
  SET redeemed_by = u.id, redeemed_at = now()
  FROM auth.users u
  WHERE g.status = 'active'
    AND NOT g.test
    AND g.redeemed_at IS NULL
    AND g.recipient_email = lower(u.email)
    AND u.email_confirmed_at IS NOT NULL
  RETURNING g.redeemed_by;
$$;

-- Support-only email change while the card is unclaimed.
CREATE OR REPLACE FUNCTION public.reassign_gift_email(p_card_id uuid, p_email text) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed integer;
BEGIN
  IF coalesce(btrim(p_email), '') = '' THEN
    RETURN false;
  END IF;
  PERFORM set_config('readest.gift_email_reassign', 'on', true);
  UPDATE public.gift_cards
  SET recipient_email = lower(btrim(p_email))
  WHERE id = p_card_id AND redeemed_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM set_config('readest.gift_email_reassign', 'off', true);
  RETURN changed > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.gift_user_id_for_email(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_gifts_for_confirmed_emails() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.reassign_gift_email(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_user_id_for_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_gifts_for_confirmed_emails() TO service_role;
GRANT EXECUTE ON FUNCTION public.reassign_gift_email(uuid, text) TO service_role;
