-- Migration 015: Add `reading_status_updated_at` to books
--
-- Field-level last-writer-wins for reading_status. The books row carries
-- both reading_status (rare, intentional) and a denormalized progress
-- (every page turn) under one updated_at, so whole-row LWW lets progress
-- updates clobber a status change across devices (issue #4634). A dedicated
-- per-field timestamp lets the merge resolve reading_status independently.
-- Additive + nullable; NULL is treated as epoch 0 (oldest) by the merge.

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS reading_status_updated_at timestamp with time zone NULL;
