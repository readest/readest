-- Migration 008: RPC helpers for the replica_keys table.
-- The bytea salt round-trips as base64 over PostgREST so the client never
-- has to deal with Postgres hex encoding. Both functions run SECURITY
-- INVOKER, so the table's RLS policies (created in migration 003) enforce
-- the auth.uid() = user_id guard.

-- gen_random_bytes() lives in pgcrypto; Supabase enables it by default,
-- but we make the dependency explicit so a fresh self-hosted database
-- works on first apply.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.replica_keys_create(p_alg text)
RETURNS TABLE(salt_id text, alg text, salt_b64 text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_salt_id text := gen_random_uuid()::text;
  v_salt bytea := extensions.gen_random_bytes(32);
BEGIN
  IF p_alg <> 'pbkdf2-600k-sha256' THEN
    RAISE EXCEPTION 'Unsupported alg: %', p_alg USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.replica_keys (user_id, salt_id, alg, salt)
  VALUES (auth.uid(), v_salt_id, p_alg, v_salt);
  RETURN QUERY
    SELECT v_salt_id, p_alg, encode(v_salt, 'base64'), now();
END;
$$;

CREATE OR REPLACE FUNCTION public.replica_keys_list()
RETURNS TABLE(salt_id text, alg text, salt_b64 text, created_at timestamptz)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT salt_id, alg, encode(salt, 'base64') AS salt_b64, created_at
  FROM public.replica_keys
  WHERE user_id = (SELECT auth.uid())
  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.replica_keys_create(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replica_keys_list() TO authenticated;
