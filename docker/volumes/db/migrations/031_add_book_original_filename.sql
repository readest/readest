-- Migration 031: Add `original_filename` to books
--
-- Preserve the original import basename, including its extension, across
-- cloud sync. Nullable for books imported before the filename was recorded.
-- Apply BEFORE deploying clients or servers that write the new column.

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS original_filename text NULL;
