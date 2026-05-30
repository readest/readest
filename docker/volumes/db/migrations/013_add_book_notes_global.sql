-- Migration 013: Add `global` flag to book_notes
--
-- The `global` flag, when true, indicates that an annotation should be
-- applied to every occurrence of `text` within the same section (chapter
-- / spine item), in addition to the original anchor identified by `cfi`.
-- Defaults to NULL/false, preserving prior single-range semantics for all
-- existing notes.

ALTER TABLE public.book_notes
  ADD COLUMN IF NOT EXISTS global boolean NULL;
