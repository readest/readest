-- Migration 026: Add `ink` strokes to book_notes
--
-- Handwriting annotations (type = 'ink') carry their strokes as a JSON array:
--   [{ id, color, width, tool?, anchor?, shape?, page?, points: [[x, y, p?], ...] }]
-- Points are page- or anchor-normalized and stored to four decimals.
--
-- Additive and nullable: every other note type leaves it NULL, and clients
-- that predate it never send the key, so their upserts leave stored strokes
-- untouched. Ink notes are pushed without xpointers, which keeps every
-- KOReader plugin version from importing a drawing as a highlight.

ALTER TABLE public.book_notes
  ADD COLUMN IF NOT EXISTS ink jsonb NULL;
