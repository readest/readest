-- Migration 012: Send to Readest — inbound capture (email / web / extension).
--
-- Out-of-app channels (email, browser extension) drop a raw payload into
-- `send_inbox`; any Readest client drains it through the normal import
-- pipeline. `send_inbox` state transitions go ONLY through the SECURITY
-- DEFINER RPCs below — clients have SELECT but no write policy, so a client
-- cannot forge `done`/`failed` or reset another device's claim.

-- Per-user inbound email address (the local part of `<address>@send.readest.com`).
CREATE TABLE IF NOT EXISTS public.send_addresses (
  user_id uuid NOT NULL,
  address text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  rotated_at timestamp with time zone NULL,
  CONSTRAINT send_addresses_pkey PRIMARY KEY (user_id),
  CONSTRAINT send_addresses_address_key UNIQUE (address),
  CONSTRAINT send_addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_send_addresses_address ON public.send_addresses (address);

ALTER TABLE public.send_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY send_addresses_select ON public.send_addresses FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY send_addresses_insert ON public.send_addresses FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY send_addresses_update ON public.send_addresses FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY send_addresses_delete ON public.send_addresses FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Approved-sender allowlist. `pending` rows are senders awaiting one-click approval.
CREATE TABLE IF NOT EXISTS public.send_allowed_senders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT send_allowed_senders_pkey PRIMARY KEY (id),
  CONSTRAINT send_allowed_senders_user_email_key UNIQUE (user_id, email),
  CONSTRAINT send_allowed_senders_status_check CHECK (status IN ('approved', 'pending')),
  CONSTRAINT send_allowed_senders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_send_allowed_senders_user ON public.send_allowed_senders (user_id);

ALTER TABLE public.send_allowed_senders ENABLE ROW LEVEL SECURITY;
CREATE POLICY send_allowed_senders_select ON public.send_allowed_senders FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY send_allowed_senders_insert ON public.send_allowed_senders FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY send_allowed_senders_update ON public.send_allowed_senders FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY send_allowed_senders_delete ON public.send_allowed_senders FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- The capture inbox. Rows are kept after `done`/`failed` as the user's
-- "Recent activity" log; the R2 payload is deleted once a row reaches `done`.
CREATE TABLE IF NOT EXISTS public.send_inbox (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  source text NOT NULL,
  payload_key text NULL,
  url text NULL,
  filename text NULL,
  subject_tag text NULL,
  byte_size bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  claimed_by text NULL,
  claimed_at timestamp with time zone NULL,
  attempts integer NOT NULL DEFAULT 0,
  error text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT send_inbox_pkey PRIMARY KEY (id),
  CONSTRAINT send_inbox_kind_check CHECK (kind IN ('file', 'url', 'html')),
  CONSTRAINT send_inbox_source_check CHECK (source IN ('email', 'extension')),
  CONSTRAINT send_inbox_status_check CHECK (status IN ('pending', 'claimed', 'done', 'failed')),
  CONSTRAINT send_inbox_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_send_inbox_user_status ON public.send_inbox (user_id, status, created_at);

ALTER TABLE public.send_inbox ENABLE ROW LEVEL SECURITY;
-- SELECT only: the Recent-activity UI reads rows. Writes go through the RPCs.
CREATE POLICY send_inbox_select ON public.send_inbox FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Claim the oldest drainable row (pending, or a claim whose 15-minute lease
-- expired). FOR UPDATE SKIP LOCKED makes concurrent drainers pick distinct rows.
CREATE OR REPLACE FUNCTION public.claim_inbox_item(p_device text)
RETURNS public.send_inbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.send_inbox;
BEGIN
  UPDATE public.send_inbox
  SET status = 'claimed', claimed_by = p_device, claimed_at = now(), updated_at = now()
  WHERE id = (
    SELECT id FROM public.send_inbox
    WHERE user_id = auth.uid()
      AND (
        status = 'pending'
        OR (status = 'claimed' AND claimed_at < now() - interval '15 minutes')
      )
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Refresh the lease for a long-running job; succeeds only if still owned.
CREATE OR REPLACE FUNCTION public.renew_inbox_claim(p_id uuid, p_device text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.send_inbox
  SET claimed_at = now(), updated_at = now()
  WHERE id = p_id AND user_id = auth.uid()
    AND status = 'claimed' AND claimed_by = p_device;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- Terminal success.
CREATE OR REPLACE FUNCTION public.complete_inbox_item(p_id uuid, p_device text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.send_inbox
  SET status = 'done', error = NULL, updated_at = now()
  WHERE id = p_id AND user_id = auth.uid()
    AND status = 'claimed' AND claimed_by = p_device;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- Failure: increment attempts atomically; back to `pending` for retry, or
-- terminal `failed` after the third attempt.
CREATE OR REPLACE FUNCTION public.fail_inbox_item(p_id uuid, p_device text, p_error text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.send_inbox
  SET attempts = attempts + 1,
      status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END,
      error = p_error,
      claimed_by = NULL,
      claimed_at = NULL,
      updated_at = now()
  WHERE id = p_id AND user_id = auth.uid()
    AND status = 'claimed' AND claimed_by = p_device;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

GRANT ALL ON public.send_addresses TO authenticated;
GRANT ALL ON public.send_allowed_senders TO authenticated;
GRANT SELECT ON public.send_inbox TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_inbox_item(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renew_inbox_claim(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_inbox_item(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_inbox_item(uuid, text, text) TO authenticated;
