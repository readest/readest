import { computeTextureContentId } from '@/services/imageService';
import type { CustomTexture } from '@/styles/textures';
import type { ReplicaAdapter } from '@/services/sync/replicaRegistry';
import type { FieldEnvelope, FieldsObject, ReplicaRow } from '@/types/replica';

export const TEXTURE_KIND = 'texture';
export const TEXTURE_SCHEMA_VERSION = 1;

const unwrap = (env: FieldEnvelope | undefined): unknown =>
  env && typeof env === 'object' && 'v' in env ? (env as FieldEnvelope).v : undefined;

interface UnwrappedTextureFields {
  name?: string;
  byteSize?: number;
  downloadedAt?: number;
}

const unwrapTextureFields = (fields: FieldsObject): UnwrappedTextureFields => {
  const name = unwrap(fields['name']);
  const byteSize = unwrap(fields['byteSize']);
  const downloadedAt = unwrap(fields['downloadedAt']);
  return {
    name: typeof name === 'string' ? name : undefined,
    byteSize: typeof byteSize === 'number' ? byteSize : undefined,
    downloadedAt: typeof downloadedAt === 'number' ? downloadedAt : undefined,
  };
};

const filenameFromManifest = (row: ReplicaRow): string | null => {
  // Texture kind is single-file; the manifest carries exactly one entry.
  const f = row.manifest_jsonb?.files[0];
  return f?.filename ?? null;
};

export { computeTextureContentId };

export const textureAdapter: ReplicaAdapter<CustomTexture> = {
  kind: TEXTURE_KIND,
  schemaVersion: TEXTURE_SCHEMA_VERSION,

  pack(texture: CustomTexture): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      name: texture.name,
      downloadedAt: texture.downloadedAt ?? Date.now(),
    };
    if (texture.byteSize !== undefined) fields['byteSize'] = texture.byteSize;
    return fields;
  },

  unpack(fields: Record<string, unknown>): CustomTexture {
    return {
      id: '',
      name: String(fields['name'] ?? ''),
      path: '',
      byteSize: fields['byteSize'] !== undefined ? Number(fields['byteSize']) : undefined,
      downloadedAt:
        fields['downloadedAt'] !== undefined ? Number(fields['downloadedAt']) : undefined,
    };
  },

  async computeId(t: CustomTexture): Promise<string> {
    return t.contentId ?? t.id;
  },

  unpackRow(row: ReplicaRow, bundleDir: string): CustomTexture | null {
    const fields = unwrapTextureFields(row.fields_jsonb);
    if (!fields.name) return null;
    const filename = filenameFromManifest(row);
    if (!filename) {
      // No manifest yet — placeholder with empty path; the manifest
      // commit on the publishing device will fill this in on the next
      // pull. Returning null skips the row for now (orchestrator
      // tolerates re-pulling the same row later).
      return null;
    }
    const texture: CustomTexture = {
      id: bundleDir,
      contentId: row.replica_id,
      name: fields.name,
      bundleDir,
      path: `${bundleDir}/${filename}`,
      unavailable: true,
    };
    if (fields.byteSize !== undefined) texture.byteSize = fields.byteSize;
    if (fields.downloadedAt !== undefined) texture.downloadedAt = fields.downloadedAt;
    if (row.reincarnation) texture.reincarnation = row.reincarnation;
    return texture;
  },

  binary: {
    localBaseDir: 'Images',
    enumerateFiles: (texture: CustomTexture) => {
      // Textures are single-file. The texture's `path` is the lfp,
      // relative to the Images base dir.
      const filename = texture.path.split('/').pop() ?? texture.path;
      return [
        {
          logical: filename,
          lfp: texture.path,
          byteSize: texture.byteSize ?? 0,
        },
      ];
    },
  },
};
