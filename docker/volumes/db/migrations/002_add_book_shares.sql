-- Migration 002: Add book_shares table for time-limited share links

CREATE TABLE IF NOT EXISTS public.book_shares (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  -- token_hash is the lookup key (sha256(token)). It is unique-indexed so
  -- public landing-page reads and downloads are O(1). The plaintext token
  -- is also stored so the owner can copy links after the create dialog
  -- closes. RLS prevents anyone but the owner from reading the plaintext.
  -- Public endpoints look up by hash only and never select the token column.
  token_hash text NOT NULL,
  token text NOT NULL,
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  book_title text NOT NULL,
  book_author text NULL,
  book_format text NOT NULL,
  book_size bigint NOT NULL,
  cfi text NULL,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone NULL,
  download_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT book_shares_pkey PRIMARY KEY (id),
  CONSTRAINT book_shares_token_hash_key UNIQUE (token_hash),
  CONSTRAINT book_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_book_shares_user_id ON public.book_shares (user_id);
CREATE INDEX IF NOT EXISTS idx_book_shares_user_id_book_hash ON public.book_shares (user_id, book_hash);

ALTER TABLE public.book_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY book_shares_select ON public.book_shares
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY book_shares_insert ON public.book_shares
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY book_shares_update ON public.book_shares
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY book_shares_delete ON public.book_shares
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Atomic download_count increment used by the public /download/confirm beacon.
-- Runs as SECURITY DEFINER so unauthenticated callers can bump the counter
-- (the route gate is "the share is active"; the function enforces that).
-- Only increments rows that are active right now — bypasses revoked/expired
-- so late-firing analytics pings don't pollute the count.
CREATE OR REPLACE FUNCTION public.increment_book_share_download(
  p_token_hash text,
  p_now timestamp with time zone
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.book_shares
  SET download_count = download_count + 1
  WHERE token_hash = p_token_hash
    AND revoked_at IS NULL
    AND expires_at > p_now;
$$;

GRANT EXECUTE ON FUNCTION public.increment_book_share_download(text, timestamp with time zone)
  TO anon, authenticated, service_role;
