-- Migration 035: list and sign out a user's devices (their Supabase sessions).
-- Apply this migration to production Supabase BEFORE the code merges, by hand
-- like 034. Until it is applied, /api/auth/sessions answers 500 and sign-in
-- skips the device check. Self-hosted Docker runs it with the other
-- migrations, so every statement is idempotent.
--
-- The auth schema is not exposed through PostgREST, so the API reads sessions
-- through these functions. Only the service role may call them: either one
-- would let anyone else see or end another account's sessions.

-- On a fresh self-hosted database this runs before GoTrue has created
-- auth.sessions, so the bodies are checked when first called instead.
SET check_function_bodies = false;

-- A user's live sessions. last_active_at is the last token refresh, which
-- GoTrue records in UTC without a time zone.
CREATE OR REPLACE FUNCTION public.list_user_sessions(p_user_id uuid)
RETURNS TABLE (id uuid, user_agent text, created_at timestamptz, last_active_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id, s.user_agent, s.created_at,
    coalesce(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at, s.created_at)
  FROM auth.sessions s
  WHERE s.user_id = p_user_id AND (s.not_after IS NULL OR s.not_after > now());
$$;

-- Ends sessions of this user. Their refresh tokens go with them (ON DELETE
-- CASCADE), so each device is signed out at its next token refresh.
CREATE OR REPLACE FUNCTION public.delete_user_sessions(p_user_id uuid, p_session_ids uuid[])
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH deleted AS (
    DELETE FROM auth.sessions
    WHERE user_id = p_user_id AND id = ANY (p_session_ids)
    RETURNING 1
  )
  SELECT count(*)::integer FROM deleted;
$$;

REVOKE ALL ON FUNCTION public.list_user_sessions(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_user_sessions(uuid, uuid[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_user_sessions(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_user_sessions(uuid, uuid[]) TO service_role;
