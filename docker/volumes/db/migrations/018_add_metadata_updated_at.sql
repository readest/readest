-- Migration 018: Add `metadata_updated_at` to books
--
-- Field-level last-writer-wins for the metadata group (title, author, tags,
-- metadata). The books row's updated_at is dominated by page-turn progress,
-- so whole-row LWW lets a device that read the book after a metadata edit
-- push its stale copy back over the edit (issue #5438 — near-deterministic
-- for RSS feed books, which are read daily on every device). A dedicated
-- per-field timestamp lets the merge resolve the metadata group
-- independently — the same hazard the 015 reading_status_updated_at (#4634)
-- and 017 cover_updated_at (#4544) fixes addressed.
-- Additive + nullable; NULL is treated as epoch 0 (oldest) by the merge, and
-- unstamped-vs-unstamped falls back to whole-row LWW so legacy rows keep
-- their old behavior. Old clients ignore the column, so they never break.

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS metadata_updated_at timestamp with time zone NULL;
