-- Migration 024: add words_read column to public.stat_pages and update upsert_stat_pages RPCs
ALTER TABLE public.stat_pages ADD COLUMN IF NOT EXISTS words_read integer DEFAULT 0;

CREATE OR REPLACE FUNCTION public.upsert_stat_pages(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.stat_pages
    (user_id, book_hash, page, start_time, duration, total_pages, words_read, ext, updated_at, deleted_at)
  SELECT DISTINCT ON (r.book_hash, r.page, r.start_time)
    auth.uid(), r.book_hash, r.page, r.start_time,
    coalesce(r.duration, 0), coalesce(r.total_pages, 0), coalesce(r.words_read, 0), r.ext, now(), r.deleted_at
  FROM jsonb_to_recordset(p_rows) AS r(
    book_hash text, page integer, start_time bigint, duration integer,
    total_pages integer, words_read integer, ext jsonb, deleted_at timestamptz)
  ORDER BY r.book_hash, r.page, r.start_time, r.duration DESC NULLS LAST
  ON CONFLICT (user_id, book_hash, page, start_time) DO UPDATE
    SET duration = EXCLUDED.duration,
        total_pages = EXCLUDED.total_pages,
        words_read = EXCLUDED.words_read,
        ext = EXCLUDED.ext,
        updated_at = EXCLUDED.updated_at,
        deleted_at = EXCLUDED.deleted_at
    WHERE EXCLUDED.duration > stat_pages.duration;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_stat_pages(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_stat_pages(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_stat_pages_as(p_user uuid, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.stat_pages
    (user_id, book_hash, page, start_time, duration, total_pages, words_read, ext, updated_at, deleted_at)
  SELECT DISTINCT ON (r.book_hash, r.page, r.start_time)
    p_user, r.book_hash, r.page, r.start_time,
    coalesce(r.duration, 0), coalesce(r.total_pages, 0), coalesce(r.words_read, 0), r.ext, now(), r.deleted_at
  FROM jsonb_to_recordset(p_rows) AS r(
    book_hash text, page integer, start_time bigint, duration integer,
    total_pages integer, words_read integer, ext jsonb, deleted_at timestamptz)
  ORDER BY r.book_hash, r.page, r.start_time, r.duration DESC NULLS LAST
  ON CONFLICT (user_id, book_hash, page, start_time) DO UPDATE
    SET duration = EXCLUDED.duration,
        total_pages = EXCLUDED.total_pages,
        words_read = EXCLUDED.words_read,
        ext = EXCLUDED.ext,
        updated_at = EXCLUDED.updated_at,
        deleted_at = EXCLUDED.deleted_at
    WHERE EXCLUDED.duration > stat_pages.duration;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_stat_pages_as(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_stat_pages_as(uuid, jsonb) TO service_role;
