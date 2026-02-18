ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;

CREATE TABLE public.books (
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  meta_hash text NULL,
  format text NULL,
  title text NULL,
  source_title text NULL,
  author text NULL,
  "group" text NULL,
  tags text[] NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  uploaded_at timestamp with time zone NULL,
  progress integer[] NULL,
  reading_status text NULL,
  group_id text NULL,
  group_name text NULL,
  metadata json NULL,
  CONSTRAINT books_pkey PRIMARY KEY (user_id, book_hash),
  CONSTRAINT books_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_books ON public.books FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY insert_books ON public.books FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY update_books ON public.books FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY delete_books ON public.books FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE TABLE public.book_configs (
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  meta_hash text NULL,
  location text NULL,
  xpointer text NULL,
  progress jsonb NULL,
  search_config jsonb NULL,
  view_settings jsonb NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  CONSTRAINT book_configs_pkey PRIMARY KEY (user_id, book_hash),
  CONSTRAINT book_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.book_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_book_configs ON public.book_configs FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY insert_book_configs ON public.book_configs FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY update_book_configs ON public.book_configs FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY delete_book_configs ON public.book_configs FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE TABLE public.book_notes (
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  meta_hash text NULL,
  id text NOT NULL,
  type text NULL,
  cfi text NULL,
  text text NULL,
  style text NULL,
  color text NULL,
  note text NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  CONSTRAINT book_notes_pkey PRIMARY KEY (user_id, book_hash, id),
  CONSTRAINT book_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.book_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_book_notes ON public.book_notes FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY insert_book_notes ON public.book_notes FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY update_book_notes ON public.book_notes FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY delete_book_notes ON public.book_notes FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE TABLE public.files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  book_hash text NULL,
  file_key text NOT NULL,
  file_size bigint NOT NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  CONSTRAINT files_pkey PRIMARY KEY (id),
  CONSTRAINT files_file_key_key UNIQUE (file_key),
  CONSTRAINT files_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX idx_files_user_id_deleted_at ON public.files (user_id, deleted_at);
CREATE INDEX idx_files_file_key ON public.files (file_key);
CREATE INDEX idx_files_file_key_deleted_at ON public.files (file_key, deleted_at);

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
CREATE POLICY files_insert ON public.files FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY files_select ON public.files FOR SELECT USING (auth.uid() = user_id AND deleted_at IS NULL);
CREATE POLICY files_update ON public.files FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (deleted_at IS NULL OR deleted_at > now());
CREATE POLICY files_delete ON public.files FOR DELETE USING (auth.uid() = user_id);

GRANT ALL ON public.books TO authenticated;
GRANT ALL ON public.book_configs TO authenticated;
GRANT ALL ON public.book_notes TO authenticated;
GRANT ALL ON public.files TO authenticated;