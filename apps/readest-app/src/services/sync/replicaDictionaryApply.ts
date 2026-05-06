import type { FieldEnvelope, FieldsObject, Manifest, ReplicaRow } from '@/types/replica';
import type { ImportedDictionary } from '@/services/dictionaries/types';

export interface UnwrappedDictionaryFields {
  name?: string;
  kind?: ImportedDictionary['kind'];
  lang?: string;
  addedAt?: number;
  unsupported?: boolean;
  unsupportedReason?: string;
}

const unwrapEnvelopeValue = (env: FieldEnvelope | undefined): unknown =>
  env && typeof env === 'object' && 'v' in env ? (env as FieldEnvelope).v : undefined;

/**
 * Unpack a fields_jsonb (envelope-wrapped) object into plain values for
 * the dictionary kind. Mirrors dictionaryAdapter.unpack but takes the
 * raw envelope shape so it can also tolerate cipher envelopes (no
 * encrypted fields on dictionary today, but the helper is defensive).
 */
export const unwrapDictionaryFields = (fields: FieldsObject): UnwrappedDictionaryFields => {
  const name = unwrapEnvelopeValue(fields['name']);
  const kind = unwrapEnvelopeValue(fields['kind']);
  const lang = unwrapEnvelopeValue(fields['lang']);
  const addedAt = unwrapEnvelopeValue(fields['addedAt']);
  const unsupported = unwrapEnvelopeValue(fields['unsupported']);
  const unsupportedReason = unwrapEnvelopeValue(fields['unsupportedReason']);

  return {
    name: typeof name === 'string' ? name : undefined,
    kind:
      kind === 'mdict' || kind === 'stardict' || kind === 'dict' || kind === 'slob'
        ? kind
        : undefined,
    lang: typeof lang === 'string' ? lang : undefined,
    addedAt: typeof addedAt === 'number' ? addedAt : undefined,
    unsupported: unsupported === true ? true : undefined,
    unsupportedReason: typeof unsupportedReason === 'string' ? unsupportedReason : undefined,
  };
};

/**
 * Reconstruct ImportedDictionary.files from a manifest. Dispatch by
 * filename extension within the bundle's declared kind. Skips
 * `.idx.offsets` / `.syn.offsets` sidecars — those are device-local
 * indices that don't belong in the synced manifest.
 */
export const filesFromManifest = (
  manifest: Manifest | null,
  kind: ImportedDictionary['kind'],
): ImportedDictionary['files'] => {
  const out: ImportedDictionary['files'] = {};
  if (!manifest) return out;

  const mdd: string[] = [];
  const css: string[] = [];

  for (const f of manifest.files) {
    const lower = f.filename.toLowerCase();
    if (lower.endsWith('.idx.offsets') || lower.endsWith('.syn.offsets')) continue;

    if (kind === 'mdict') {
      if (lower.endsWith('.mdx')) out.mdx = f.filename;
      else if (lower.endsWith('.mdd')) mdd.push(f.filename);
      else if (lower.endsWith('.css')) css.push(f.filename);
    } else if (kind === 'stardict') {
      if (lower.endsWith('.ifo')) out.ifo = f.filename;
      else if (lower.endsWith('.idx')) out.idx = f.filename;
      else if (lower.endsWith('.syn')) out.syn = f.filename;
      else if (lower.endsWith('.dict.dz') || lower.endsWith('.dict')) out.dict = f.filename;
    } else if (kind === 'dict') {
      if (lower.endsWith('.index')) out.index = f.filename;
      else if (lower.endsWith('.dict.dz') || lower.endsWith('.dict')) out.dict = f.filename;
    } else if (kind === 'slob') {
      if (lower.endsWith('.slob')) out.slob = f.filename;
    }
  }

  if (mdd.length > 0) out.mdd = mdd;
  if (css.length > 0) out.css = css;
  return out;
};

/**
 * Build a local ImportedDictionary placeholder from a pulled replica row.
 * The placeholder is marked `unavailable: true` until the binary
 * download completes — at which point a download-completion handler
 * clears the flag.
 *
 * Returns null when the row's fields_jsonb is malformed (missing
 * required name or kind). The pull orchestrator skips null returns.
 */
export const buildLocalDictFromRow = (
  row: ReplicaRow,
  bundleDir: string,
): ImportedDictionary | null => {
  const fields = unwrapDictionaryFields(row.fields_jsonb);
  if (!fields.name || !fields.kind) return null;

  const dict: ImportedDictionary = {
    id: bundleDir,
    contentId: row.replica_id,
    kind: fields.kind,
    name: fields.name,
    bundleDir,
    files: filesFromManifest(row.manifest_jsonb, fields.kind),
    addedAt: fields.addedAt ?? Date.now(),
    unavailable: true,
  };
  if (fields.lang !== undefined) dict.lang = fields.lang;
  if (fields.unsupported) dict.unsupported = true;
  if (fields.unsupportedReason) dict.unsupportedReason = fields.unsupportedReason;
  if (row.reincarnation) dict.reincarnation = row.reincarnation;

  return dict;
};
