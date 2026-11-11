-- Migration 033: Add the `crosspoint` anchor to book_notes
--
-- Where a CrossPoint reader anchors a highlight, the way xpointer0/xpointer1
-- are KOReader's: { spine, start_offset, end_offset } (a [start, end) range of
-- code points in the section's text), plus the firmware's own layout hints
-- on a clipping a reader synced through /api/crosspoint/api/v1/clippings.
--
-- Additive and nullable: clients that predate it never send the key, so their
-- upserts leave a stored anchor untouched. Apply before the web deploy that
-- ships the clippings route.

ALTER TABLE public.book_notes
  ADD COLUMN IF NOT EXISTS crosspoint jsonb NULL;
