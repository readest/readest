-- Migration 029: atomic storage quota reservation for uploads.
--
-- /api/storage/upload used to read the user's usage, compare it with the
-- quota, and insert the `files` row in separate round trips. Concurrent
-- requests all measured themselves against the same usage, so together they
-- could overshoot the quota. This function does the check and the insert in
-- one transaction, holding a per-user advisory lock so a user's reservations
-- run one at a time and each one sees the rows committed before it.
--
-- Usage is the sum of the user's live `files` rows (the same figure
-- /api/storage/stats reports), so the check does not depend on any counter
-- being maintained elsewhere.
--
-- A key that already has a row (a re-upload) is not inserted again; the caller
-- signs it with the recorded size, as before. p_quota already includes the
-- grace allowance. Only the API server (service_role) may call it; service_role
-- bypasses RLS, so SECURITY INVOKER is enough.

CREATE OR REPLACE FUNCTION public.reserve_storage_upload(
  p_user_id uuid,
  p_file_key text,
  p_file_size bigint,
  p_quota bigint,
  p_book_hash text DEFAULT NULL,
  p_replica_kind text DEFAULT NULL,
  p_replica_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_usage bigint;
  v_existing_size bigint;
  v_file_id uuid;
BEGIN
  IF p_file_size IS NULL OR p_file_size <= 0 THEN
    RAISE EXCEPTION 'invalid file size';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('storage_upload:' || p_user_id::text, 0));

  SELECT coalesce(sum(file_size), 0) INTO v_usage
  FROM public.files
  WHERE user_id = p_user_id AND deleted_at IS NULL;

  IF v_usage + p_file_size > p_quota THEN
    RETURN jsonb_build_object('allowed', false, 'usage', v_usage);
  END IF;

  SELECT file_size INTO v_existing_size
  FROM public.files
  WHERE user_id = p_user_id AND file_key = p_file_key
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'allowed', true, 'usage', v_usage, 'file_size', v_existing_size, 'inserted', false);
  END IF;

  INSERT INTO public.files (user_id, book_hash, replica_kind, replica_id, file_key, file_size)
  VALUES (p_user_id, p_book_hash, p_replica_kind, p_replica_id, p_file_key, p_file_size)
  RETURNING id INTO v_file_id;

  RETURN jsonb_build_object(
    'allowed', true, 'usage', v_usage, 'file_size', p_file_size,
    'inserted', true, 'file_id', v_file_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_storage_upload(uuid, text, bigint, bigint, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_storage_upload(uuid, text, bigint, bigint, text, text, text)
  TO service_role;
