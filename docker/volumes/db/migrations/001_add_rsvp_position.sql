-- Migration 001: Add rsvp_position column to book_configs

ALTER TABLE public.book_configs
  ADD COLUMN IF NOT EXISTS rsvp_position text NULL;
