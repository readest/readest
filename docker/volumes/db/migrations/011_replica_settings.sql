-- Migration 011: Extend the replicas.kind allowlist with 'settings'.
-- Per tenet 8 of the replica-sync plan, scalar settings sync via a
-- single bundled row keyed by ('settings', 'singleton') instead of N
-- per-kind adapters. The DB CHECK is belt-and-suspenders;
-- src/libs/replicaSchemas.ts (KIND_ALLOWLIST) is the actual gate.

ALTER TABLE public.replicas
  DROP CONSTRAINT IF EXISTS replicas_kind_allowlist;

ALTER TABLE public.replicas
  ADD CONSTRAINT replicas_kind_allowlist
  CHECK (kind IN ('dictionary', 'font', 'texture', 'opds_catalog', 'settings'));
