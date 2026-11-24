-- Migration 029: only the API server writes `files`.
--
-- `files` rows are the storage quota: their sizes add up to a user's usage.
-- Granting writes to `authenticated` let any signed-in user call the REST API
-- directly to insert a row with a negative size, edit a row's size, or delete
-- a row while keeping its object, and so get past the quota. Every write goes
-- through the API routes with the service role, so clients keep read access
-- only. The size check stops a negative row whoever writes it.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.files FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.files'::regclass AND conname = 'files_file_size_nonnegative'
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_file_size_nonnegative CHECK (file_size >= 0);
  END IF;
END $$;
