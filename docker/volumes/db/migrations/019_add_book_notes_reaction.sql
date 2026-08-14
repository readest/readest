-- Migration 019: Add reaction column to book_notes
--
-- Restores database support for the custom emoji reactions feature,
-- allowing highlights/notes to store reaction emojis.

ALTER TABLE public.book_notes
  ADD COLUMN IF NOT EXISTS reaction text NULL;
