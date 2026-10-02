-- Per-device keys for the CrossPoint plugin. At sign-in the plugin mints one
-- and points the reader's built-in KOReader Sync client at the KOSync-compatible
-- routes under /api/crosspoint, so reading progress syncs with Readest without
-- configuring a sync server. Only those routes touch the table, as the service
-- role.
CREATE TABLE IF NOT EXISTS public.kosync_keys (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- sha256 hex of the key's md5 hex (what KOSync clients send as x-auth-key);
  -- the key itself is never stored. The key alone authenticates a device.
  key_hash    text NOT NULL UNIQUE,
  created_at  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kosync_keys_user ON public.kosync_keys (user_id);

-- No policies: clients can neither read nor write keys directly.
ALTER TABLE public.kosync_keys ENABLE ROW LEVEL SECURITY;
