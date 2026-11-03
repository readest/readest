-- Migration 032: vocabulary builder sync (#789, #6613).
-- Deploy this migration and the /api/sync/vocabulary route before releasing
-- clients that push vocabulary.
--
-- One row per looked-up word. `updated_at` is stamped by the API on every
-- write and is the pull cursor, paged by the (updated_at, id) keyset.
-- created_at / modified_at / deleted_at are the clients' epoch-ms clocks used
-- by the merge (newer modified_at wins state and hint; sentences are unioned).

CREATE TABLE IF NOT EXISTS public.vocabulary (
  user_id uuid NOT NULL,
  id text NOT NULL,
  lang text NOT NULL,
  word_key text NOT NULL,
  word text NOT NULL,
  state text NOT NULL DEFAULT 'none',
  hint text NULL,
  occurrences jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at bigint NOT NULL,
  modified_at bigint NOT NULL,
  deleted_at bigint NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT vocabulary_pkey PRIMARY KEY (user_id, id),
  CONSTRAINT vocabulary_state_check CHECK (state IN ('none', 'learning', 'mastered')),
  CONSTRAINT vocabulary_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vocabulary_user_updated ON public.vocabulary (user_id, updated_at, id);

ALTER TABLE public.vocabulary ENABLE ROW LEVEL SECURITY;

CREATE POLICY vocabulary_select ON public.vocabulary FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY vocabulary_insert ON public.vocabulary FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY vocabulary_update ON public.vocabulary FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY vocabulary_delete ON public.vocabulary FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
