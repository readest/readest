-- Migration 017: Add `cover_hash` / `cover_updated_at` to books
--
-- Cover-change sync (issue #4544). Editing a book's cover writes cover.png
-- locally but changes no hash (the cover is keyed by the file hash), so peers
-- had no signal to re-download it. Give the cover its own content-addressed
-- version:
--
--   cover_hash       = partial MD5 of cover.png. A peer re-downloads the cover
--                      iff its synced cover_hash differs from the local one.
--                      Content-addressed ⇒ a byte-identical (re-extracted /
--                      re-imported) cover yields the same hash ⇒ no re-sync
--                      churn (compatible with the metaHash dedupe mechanism).
--   cover_updated_at = field-level last-writer-wins timestamp so a page-turn
--                      that wins whole-row LWW on updated_at cannot clobber a
--                      cover edit — the same hazard the 015
--                      reading_status_updated_at fix addressed for #4634.
--
-- Both additive + nullable; NULL cover_updated_at is treated as epoch 0
-- (oldest) by the merge. Old clients ignore the columns, so they never break.

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS cover_hash       text NULL,
  ADD COLUMN IF NOT EXISTS cover_updated_at timestamp with time zone NULL;
