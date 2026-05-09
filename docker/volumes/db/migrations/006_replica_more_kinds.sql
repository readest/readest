-- Migration 006: Extend the replicas.kind allowlist beyond 'dictionary'.
-- Pre-allows the kinds we plan to ship in upcoming client releases so
-- each adapter only needs a coordinated client + server-validation
-- update, not another DB migration. The DB CHECK is belt-and-
-- suspenders; src/libs/replicaSchemas.ts (KIND_ALLOWLIST) is the
-- actual gate that decides which kinds the server accepts on push.

ALTER TABLE public.replicas
  DROP CONSTRAINT IF EXISTS replicas_kind_allowlist;

ALTER TABLE public.replicas
  ADD CONSTRAINT replicas_kind_allowlist
  CHECK (kind IN ('dictionary', 'font', 'texture'));
