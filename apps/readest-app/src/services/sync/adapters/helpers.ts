import type { FieldEnvelope, ReplicaRow } from '@/types/replica';

/**
 * Unwrap a CRDT field envelope back to its raw value. Returns `undefined`
 * when the envelope is missing or malformed (and for cipher envelopes,
 * which only the per-adapter encrypt/decrypt path knows how to handle).
 *
 * Shared across adapters that read scalar fields out of `fields_jsonb` —
 * the dictionary, font, and texture adapters all unwrap the same shape.
 */
export const unwrap = (env: FieldEnvelope | undefined): unknown =>
  env && typeof env === 'object' && 'v' in env ? (env as FieldEnvelope).v : undefined;

/**
 * Pull the single manifest filename for a kind whose binary capability
 * always lists exactly one file (font, texture). Returns `null` when the
 * manifest hasn't been committed yet — the orchestrator skips such rows
 * and re-pulls them on the next cycle once the publishing device's
 * upload completes.
 */
export const singleFileFilenameFromManifest = (row: ReplicaRow): string | null => {
  const f = row.manifest_jsonb?.files[0];
  return f?.filename ?? null;
};

/**
 * `binary.enumerateFiles` for any single-file kind whose record carries
 * a relative `path` (`<bundleDir>/<filename>`) and an optional `byteSize`.
 * Returns one entry; legacy flat-path records (no slash in `path`) work
 * without modification — the filename falls back to the path itself.
 */
export const singleFileBinaryEnumerator = <T extends { path: string; byteSize?: number }>(
  record: T,
): { logical: string; lfp: string; byteSize: number }[] => {
  const filename = record.path.split('/').pop() ?? record.path;
  return [
    {
      logical: filename,
      lfp: record.path,
      byteSize: record.byteSize ?? 0,
    },
  ];
};

/**
 * Default `computeId` for kinds that compute their cross-device identity
 * via a content hash stored in `record.contentId` (set at import time)
 * and fall back to the local `record.id` for legacy entries that
 * predate replica sync.
 */
export const defaultComputeId = async <T extends { contentId?: string; id: string }>(
  record: T,
): Promise<string> => record.contentId ?? record.id;
