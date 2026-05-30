-- Migration 007: Per-replica grouping for binaries in `files`.
--
-- Replica-kind binaries (custom dictionary mdx/mdd, font ttf/woff, ...)
-- have no book_hash, so without these columns Storage Manager would
-- lump every replica binary into one "no-book" bucket. Per-replica
-- grouping needs the row to carry the replica's identity alongside
-- file_key/size.

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS replica_kind text NULL,
  ADD COLUMN IF NOT EXISTS replica_id text NULL;

-- Composite filter index for "list / count files by replica row".
CREATE INDEX IF NOT EXISTS idx_files_replica_lookup
  ON public.files (user_id, replica_kind, replica_id);
