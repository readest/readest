-- Migration 009: Extend the replicas.kind allowlist with 'opds_catalog'.
-- The DB CHECK is belt-and-suspenders; src/libs/replicaSchemas.ts
-- (KIND_ALLOWLIST) is the actual gate that decides which kinds the
-- server accepts on push.

ALTER TABLE public.replicas
  DROP CONSTRAINT IF EXISTS replicas_kind_allowlist;

ALTER TABLE public.replicas
  ADD CONSTRAINT replicas_kind_allowlist
  CHECK (kind IN ('dictionary', 'font', 'texture', 'opds_catalog'));
