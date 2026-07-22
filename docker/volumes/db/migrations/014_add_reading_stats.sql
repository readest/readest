-- Migration 014: reading statistics sync (KOReader-compatible page events)

CREATE TABLE IF NOT EXISTS public.stat_books (
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  title text NOT NULL DEFAULT '',
  authors text NOT NULL DEFAULT '',
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  CONSTRAINT stat_books_pkey PRIMARY KEY (user_id, book_hash),
  CONSTRAINT stat_books_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_stat_books_user_updated ON public.stat_books (user_id, updated_at);

CREATE TABLE IF NOT EXISTS public.stat_pages (
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  page integer NOT NULL,
  start_time bigint NOT NULL,
  duration integer NOT NULL DEFAULT 0,
  total_pages integer NOT NULL DEFAULT 0,
  ext jsonb NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  CONSTRAINT stat_pages_pkey PRIMARY KEY (user_id, book_hash, page, start_time),
  CONSTRAINT stat_pages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_stat_pages_user_updated ON public.stat_pages (user_id, updated_at);

ALTER TABLE public.stat_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stat_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY stat_books_select ON public.stat_books FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_books_insert ON public.stat_books FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_books_update ON public.stat_books FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_books_delete ON public.stat_books FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY stat_pages_select ON public.stat_pages FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_pages_insert ON public.stat_pages FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_pages_update ON public.stat_pages FOR UPDATE to authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_pages_delete ON public.stat_pages FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
