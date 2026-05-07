import { computeFontContentId } from '@/services/fontService';
import type { CustomFont } from '@/styles/fonts';
import type { ReplicaAdapter } from '@/services/sync/replicaRegistry';
import type { FieldsObject, ReplicaRow } from '@/types/replica';
import {
  defaultComputeId,
  singleFileBinaryEnumerator,
  singleFileFilenameFromManifest,
  unwrap,
} from './helpers';

export const FONT_KIND = 'font';
export const FONT_SCHEMA_VERSION = 1;

interface UnwrappedFontFields {
  name?: string;
  family?: string;
  style?: string;
  weight?: number;
  variable?: boolean;
  byteSize?: number;
  downloadedAt?: number;
}

const unwrapFontFields = (fields: FieldsObject): UnwrappedFontFields => {
  const name = unwrap(fields['name']);
  const family = unwrap(fields['family']);
  const style = unwrap(fields['style']);
  const weight = unwrap(fields['weight']);
  const variable = unwrap(fields['variable']);
  const byteSize = unwrap(fields['byteSize']);
  const downloadedAt = unwrap(fields['downloadedAt']);
  return {
    name: typeof name === 'string' ? name : undefined,
    family: typeof family === 'string' ? family : undefined,
    style: typeof style === 'string' ? style : undefined,
    weight: typeof weight === 'number' ? weight : undefined,
    variable: variable === true ? true : undefined,
    byteSize: typeof byteSize === 'number' ? byteSize : undefined,
    downloadedAt: typeof downloadedAt === 'number' ? downloadedAt : undefined,
  };
};

export { computeFontContentId };

export const fontAdapter: ReplicaAdapter<CustomFont> = {
  kind: FONT_KIND,
  schemaVersion: FONT_SCHEMA_VERSION,

  pack(font: CustomFont): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      name: font.name,
      downloadedAt: font.downloadedAt ?? Date.now(),
    };
    if (font.family !== undefined) fields['family'] = font.family;
    if (font.style !== undefined) fields['style'] = font.style;
    if (font.weight !== undefined) fields['weight'] = font.weight;
    if (font.variable !== undefined) fields['variable'] = font.variable;
    if (font.byteSize !== undefined) fields['byteSize'] = font.byteSize;
    return fields;
  },

  unpack(fields: Record<string, unknown>): CustomFont {
    return {
      id: '',
      name: String(fields['name'] ?? ''),
      path: '',
      family: fields['family'] !== undefined ? String(fields['family']) : undefined,
      style: fields['style'] !== undefined ? String(fields['style']) : undefined,
      weight: fields['weight'] !== undefined ? Number(fields['weight']) : undefined,
      variable: fields['variable'] === true ? true : undefined,
      byteSize: fields['byteSize'] !== undefined ? Number(fields['byteSize']) : undefined,
      downloadedAt:
        fields['downloadedAt'] !== undefined ? Number(fields['downloadedAt']) : undefined,
    };
  },

  computeId: defaultComputeId,

  unpackRow(row: ReplicaRow, bundleDir: string): CustomFont | null {
    const fields = unwrapFontFields(row.fields_jsonb);
    if (!fields.name) return null;
    const filename = singleFileFilenameFromManifest(row);
    if (!filename) {
      // No manifest yet — placeholder with empty path; the manifest
      // commit on the publishing device will fill this in on the next
      // pull. Returning null skips the row for now (orchestrator
      // tolerates re-pulling the same row later).
      return null;
    }
    const font: CustomFont = {
      id: bundleDir,
      contentId: row.replica_id,
      name: fields.name,
      bundleDir,
      path: `${bundleDir}/${filename}`,
      unavailable: true,
    };
    if (fields.family !== undefined) font.family = fields.family;
    if (fields.style !== undefined) font.style = fields.style;
    if (fields.weight !== undefined) font.weight = fields.weight;
    if (fields.variable !== undefined) font.variable = fields.variable;
    if (fields.byteSize !== undefined) font.byteSize = fields.byteSize;
    if (fields.downloadedAt !== undefined) font.downloadedAt = fields.downloadedAt;
    if (row.reincarnation) font.reincarnation = row.reincarnation;
    return font;
  },

  binary: {
    localBaseDir: 'Fonts',
    enumerateFiles: singleFileBinaryEnumerator,
  },
};
