-- Migration 030: Add `tts_packs` to book_configs
--
-- The downloaded read-aloud packs each sync destination holds for a book
-- (BookConfig.ttsPacks), by destination id. A device reads it with the
-- config it already fetches when opening a book, so it lists a destination
-- for audio only when there is something to pull or push; a book without
-- audio makes no request at all.
--
-- Additive + nullable. The server merges it as a union, whichever row wins
-- on updated_at, and never bumps updated_at for it, so recording audio cannot
-- override reading progress. Old clients ignore the column.
--
-- Apply BEFORE deploying a server that writes it: the sync route writes the
-- column for any book with Read Aloud history.

ALTER TABLE public.book_configs
  ADD COLUMN IF NOT EXISTS tts_packs jsonb NULL;
