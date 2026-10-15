-- Migration 028: Add `page_count` to books
--
-- The page total the reader lays out for a book, counted from the file at
-- import (#6662) so an unopened book can show, sort and filter by length. The
-- importing device already did the work; syncing it lets every other device
-- have the count too, including ones that only hold the book in the cloud and
-- so cannot count it themselves. Once a book is opened, progress[1] carries the
-- same total, so this only matters for books nobody has opened yet.
--
-- Additive + nullable. The merge keeps the row winner's value and falls back
-- to the other side's when the winner has none, so a push without a count —
-- old clients, the KOReader and Calibre plugins, a device that never counted
-- the book — never erases it. Old clients ignore the column, so they never
-- break. Not backfilled: only a client holding the file can count it.

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS page_count integer NULL;
