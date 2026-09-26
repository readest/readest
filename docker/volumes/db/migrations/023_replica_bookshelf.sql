-- Deploy this migration and the bookshelf API validator before releasing clients.
-- Definitions are one atomic LWW field; display positions are separate fields.
ALTER TABLE public.replicas
  DROP CONSTRAINT IF EXISTS replicas_kind_allowlist,
  ADD CONSTRAINT replicas_kind_allowlist
    CHECK (kind IN ('dictionary', 'font', 'texture', 'opds_catalog', 'abs_server', 'settings', 'bookshelf')) NOT VALID;

-- The migration runner commits the metadata change above before this scan,
-- allowing normal reads and writes while existing rows are validated.
ALTER TABLE public.replicas VALIDATE CONSTRAINT replicas_kind_allowlist;
