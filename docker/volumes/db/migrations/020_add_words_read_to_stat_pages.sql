-- Migration 020: add words_read column to public.stat_pages
ALTER TABLE public.stat_pages ADD COLUMN IF NOT EXISTS words_read integer DEFAULT 0;
