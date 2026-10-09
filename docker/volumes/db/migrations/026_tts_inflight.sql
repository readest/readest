-- Migration 026: per-user in-flight windows for Readest Voice (premium TTS).
--
-- One RunPod endpoint serves both listening and chapter downloads, so the web
-- route admits at most one window per user per lane:
--   listen:   a new window supersedes the old one (a seek or voice change made
--             it stale); the caller cancels the returned job.
--   download: a second concurrent window is refused (the route answers BUSY).
-- expires_at bounds every slot by the route's window deadline, so a crashed
-- isolate never locks a user out. The route treats any RPC error as "admitted"
-- (fail open, like the usage counters); RunPod max workers and the account
-- spend limit stay the hard cost ceiling.
--
-- All functions run as service_role (the web route) and are SECURITY INVOKER
-- with a fixed search_path; EXECUTE is revoked from every other role.

CREATE TABLE IF NOT EXISTS public.tts_inflight (
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  lane        text NOT NULL CHECK (lane IN ('listen', 'download')),
  token       uuid NOT NULL,                -- the admitting request
  job_id      text,                         -- RunPod job, set once started
  expires_at  timestamp with time zone NOT NULL,
  CONSTRAINT tts_inflight_pkey PRIMARY KEY (user_id, lane)
);
ALTER TABLE public.tts_inflight ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tts_inflight FROM PUBLIC, anon, authenticated;

-- Admit a window. Returns whether it was admitted and, for a superseded live
-- listen window, the job id the caller must cancel.
CREATE OR REPLACE FUNCTION public.tts_acquire_slot(
  p_user_id uuid, p_lane text, p_token uuid, p_ttl_seconds integer)
RETURNS TABLE (acquired boolean, previous_job_id text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_live boolean := false;
  v_prev text;
BEGIN
  -- Serialize per (user, lane): FOR UPDATE alone cannot lock a missing row.
  PERFORM pg_advisory_xact_lock(hashtext('tts_inflight:' || p_user_id::text || ':' || p_lane));
  SELECT expires_at > now(), job_id INTO v_live, v_prev
    FROM public.tts_inflight WHERE user_id = p_user_id AND lane = p_lane;
  v_live := coalesce(v_live, false);
  IF v_live AND p_lane = 'download' THEN
    RETURN QUERY SELECT false, NULL::text;
    RETURN;
  END IF;
  INSERT INTO public.tts_inflight (user_id, lane, token, job_id, expires_at)
    VALUES (p_user_id, p_lane, p_token, NULL, now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (user_id, lane) DO UPDATE
    SET token = excluded.token, job_id = NULL, expires_at = excluded.expires_at;
  RETURN QUERY SELECT true, CASE WHEN v_live THEN v_prev END;
END;
$$;

-- Record the started job. False when another request took the slot meanwhile:
-- the caller then cancels its own job.
CREATE OR REPLACE FUNCTION public.tts_set_slot_job(
  p_user_id uuid, p_lane text, p_token uuid, p_job_id text)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH updated AS (
    UPDATE public.tts_inflight SET job_id = p_job_id
     WHERE user_id = p_user_id AND lane = p_lane AND token = p_token
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$$;

-- Free the slot, only if this request still owns it.
CREATE OR REPLACE FUNCTION public.tts_release_slot(p_user_id uuid, p_lane text, p_token uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  DELETE FROM public.tts_inflight
   WHERE user_id = p_user_id AND lane = p_lane AND token = p_token;
$$;

REVOKE EXECUTE ON FUNCTION public.tts_acquire_slot(uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tts_set_slot_job(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tts_release_slot(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
