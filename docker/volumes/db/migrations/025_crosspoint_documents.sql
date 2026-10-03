-- Copies of Readest books on CrossPoint readers that hash differently from the
-- book: CrossPoint's "Optimize EPUB" upload rewrites the file, so the KOSync
-- document id (the file's partial MD5) matches no book_hash. The first progress
-- upload links the copy to the library book by title and author; later syncs
-- follow the link. Only the service role reads or writes it.
CREATE TABLE IF NOT EXISTS public.crosspoint_documents (
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  document    text NOT NULL,  -- partial MD5 of the file on the reader
  book_hash   text NOT NULL,  -- the library book it is a copy of
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document)
);

ALTER TABLE public.crosspoint_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crosspoint_documents FROM PUBLIC, anon, authenticated;
