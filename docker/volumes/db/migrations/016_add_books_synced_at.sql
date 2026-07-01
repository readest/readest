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
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ RUN ONLINE, NOT INSIDE A TRANSACTION.                                      │
-- │                                                                            │
-- │ Apply with psql against a live, large `books` table (millions of rows):   │
-- │     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 016_add_books_synced_at.sql │
-- │                                                                            │
-- │ Do NOT paste it into a wrapping BEGIN/COMMIT or the Supabase dashboard SQL │
-- │ editor: it uses CREATE INDEX CONCURRENTLY and a CALL into a procedure that │
-- │ COMMITs each backfill batch — both are rejected inside a transaction.      │
-- │                                                                            │
-- │ A single bulk `UPDATE … WHERE synced_at IS NULL` deadlocks against the     │
-- │ live /api/sync upserts (both lock books rows, in opposite orders). The     │
-- │ backfill below instead walks the table in small autocommitted batches and │
-- │ uses FOR UPDATE SKIP LOCKED so it never waits on a row the app holds.      │
-- └───────────────────────────────────────────────────────────────────────────┘

-- 1. Add the column (nullable, no default → metadata-only, instant) and set the
--    default up front so rows INSERTed during the backfill already get now().
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS synced_at timestamp with time zone NULL;
ALTER TABLE public.books
  ALTER COLUMN synced_at SET DEFAULT now();

-- 2. Backfill in small, individually-committed batches. SKIP LOCKED steps over
--    rows currently locked by a concurrent push (they fall to a later pass), so
--    the backfill never deadlocks with live traffic. The trigger is installed
--    only AFTER this completes, so it can't clobber the updated_at backfill.
CREATE OR REPLACE PROCEDURE public.backfill_books_synced_at(batch_size int DEFAULT 10000)
LANGUAGE plpgsql
AS $$
DECLARE
  n int;
BEGIN
  LOOP
    WITH todo AS (
      SELECT ctid
      FROM public.books
      WHERE synced_at IS NULL
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.books b
      SET synced_at = COALESCE(b.updated_at, b.created_at, now())
      FROM todo
      WHERE b.ctid = todo.ctid;

    GET DIAGNOSTICS n = ROW_COUNT;
    COMMIT;

    IF n = 0 THEN
      -- A pass updated nothing: either we're done, or the only rows left are
      -- momentarily app-locked. Stop when truly none remain, else briefly wait.
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.books WHERE synced_at IS NULL);
      PERFORM pg_sleep(0.1);
    END IF;
  END LOOP;
END;
$$;

CALL public.backfill_books_synced_at(10000);
DROP PROCEDURE public.backfill_books_synced_at(int);

-- 3. Index the cursor without blocking writes (CONCURRENTLY → no SHARE lock).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_books_user_synced
  ON public.books (user_id, synced_at);

-- 4. Install the trigger LAST, so from here every write is server-stamped.
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

-- 5. (Optional) Enforce NOT NULL without the full-table ACCESS EXCLUSIVE scan
--    that `ALTER COLUMN … SET NOT NULL` takes. A NOT VALID check skips existing
--    rows; VALIDATE then scans under a lighter SHARE UPDATE EXCLUSIVE lock that
--    still allows concurrent reads and writes. Safe to omit — the default, the
--    trigger and the backfill already keep the column populated, and the client
--    falls back to updated_at when synced_at is absent.
-- ALTER TABLE public.books
--   ADD CONSTRAINT books_synced_at_not_null CHECK (synced_at IS NOT NULL) NOT VALID;
-- ALTER TABLE public.books
--   VALIDATE CONSTRAINT books_synced_at_not_null;
