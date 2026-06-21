-- Migration 016: Add a server-assigned `synced_at` cursor to books (issue #4678)
--
-- `books.updated_at` was overloaded as two things with conflicting needs:
--   1. the incremental-pull cursor (GET /api/sync?since=… filters updated_at >
--      since, and each device keeps a single global max(updated_at) watermark);
--   2. the library "date read" sort key (wants the client event time).
--
-- A server-resolved merge (e.g. the reading_status field-level LWW in #4634)
-- has to be written with a timestamp greater than every peer's global cursor to
-- propagate, which forced updated_at = now() and reordered the date-read library
-- by sync-processing time (the #4677 symptom).
--
-- Decouple the two: `synced_at` is a monotonic, server-stamped cursor used ONLY
-- by the incremental pull, while `updated_at` stays pure client event time used
-- ONLY for sorting. A BEFORE INSERT/UPDATE trigger forces synced_at = now() on
-- every server write (clients never send it), so a status merge propagates by
-- bumping synced_at without touching updated_at.
--
-- Backfill synced_at = updated_at so existing devices' updated_at-based cursors
-- hand over seamlessly: `synced_at > since` returns the same rows as before
-- (synced_at == updated_at) plus, going forward, server-resolved merges.

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS synced_at timestamp with time zone NULL;

UPDATE public.books
  SET synced_at = COALESCE(updated_at, created_at, now())
  WHERE synced_at IS NULL;

ALTER TABLE public.books
  ALTER COLUMN synced_at SET DEFAULT now();
ALTER TABLE public.books
  ALTER COLUMN synced_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_books_user_synced ON public.books (user_id, synced_at);

CREATE OR REPLACE FUNCTION public.set_books_synced_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Server-authoritative: ignore any client-supplied value and stamp the
  -- transaction time. transaction_timestamp() (= now()) is stable within a
  -- batch upsert, which is fine — a batch is a single pull delta.
  NEW.synced_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS books_set_synced_at ON public.books;
CREATE TRIGGER books_set_synced_at
  BEFORE INSERT OR UPDATE ON public.books
  FOR EACH ROW
  EXECUTE FUNCTION public.set_books_synced_at();
