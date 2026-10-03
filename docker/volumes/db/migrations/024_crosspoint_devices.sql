-- Migration 024: CrossPoint e-readers linked to a Readest account (the
-- CrossPoint SD plugin). A reader signs in with a device code its owner
-- approves on the Readest web app, then authenticates every request (library,
-- downloads, reading sessions, KOReader Sync progress) with its own key. Only
-- the /api/crosspoint routes touch these tables, as the service role.

CREATE TABLE IF NOT EXISTS public.crosspoint_devices (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- sha256 hex of the key's md5 hex (what KOSync clients send as x-auth-key);
  -- the key itself is never stored.
  key_hash    text NOT NULL UNIQUE,
  created_at  timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crosspoint_devices_user ON public.crosspoint_devices (user_id);

-- Pending sign-ins. The reader shows user_code and polls with its device code
-- until the owner approves (user_id set); the first poll after that claims the
-- row and mints the device key.
CREATE TABLE IF NOT EXISTS public.crosspoint_device_codes (
  device_code_hash  text PRIMARY KEY,  -- sha256 hex
  user_code         text NOT NULL UNIQUE,
  user_id           uuid NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  username          text NULL,         -- the approver's email, a label for the reader
  expires_at        timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crosspoint_device_codes_expires
  ON public.crosspoint_device_codes (expires_at);

-- Service-role only: RLS with no policies denies every other role, and the
-- REVOKE keeps PostgREST from exposing them through default table privileges.
ALTER TABLE public.crosspoint_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crosspoint_device_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crosspoint_devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crosspoint_device_codes FROM PUBLIC, anon, authenticated;
