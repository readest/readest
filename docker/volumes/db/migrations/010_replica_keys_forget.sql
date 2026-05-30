-- Migration 010: replica_keys_forget RPC.
-- Wipes every encrypted-field envelope from the user's replica rows
-- (any field whose `v` slot contains a cipher envelope, identified by
-- the `alg` key) and deletes every replica_keys row for the user. The
-- next encrypted push from any device will mint a fresh salt + key.
--
-- Plaintext fields are untouched. Local plaintext copies on each
-- device survive — the user just has to re-enter their sync passphrase
-- on each device and the encrypted fields will be re-encrypted under
-- the new key on the next push.
--
-- SECURITY INVOKER: RLS on replicas + replica_keys gates the writes
-- to the calling user's rows.

CREATE OR REPLACE FUNCTION public.replica_keys_forget()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'replica_keys_forget called without an authenticated user';
  END IF;

  -- Strip cipher envelopes from each row's fields_jsonb. A cipher
  -- envelope is the value of a field's `v` slot when that value is an
  -- object containing the `alg` key (per CipherEnvelope shape:
  -- {c, i, s, alg, h}). Plain field envelopes have a non-object `v`.
  UPDATE public.replicas r
  SET fields_jsonb = (
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM jsonb_each(r.fields_jsonb)
    WHERE NOT (
      jsonb_typeof(value -> 'v') = 'object'
      AND value -> 'v' ? 'alg'
    )
  )
  WHERE r.user_id = v_user_id
    AND EXISTS (
      SELECT 1 FROM jsonb_each(r.fields_jsonb) e
      WHERE jsonb_typeof(e.value -> 'v') = 'object'
        AND e.value -> 'v' ? 'alg'
    );

  -- Drop every salt row. The next encrypted push will create a fresh
  -- one via replica_keys_create.
  DELETE FROM public.replica_keys WHERE user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replica_keys_forget() TO authenticated;
