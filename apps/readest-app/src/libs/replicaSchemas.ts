import { z } from 'zod';
import type { ReplicaRow } from '@/types/replica';
import type { SyncErrorCode } from '@/libs/errors';

export const MAX_JSON_BYTES = 64 * 1024;
export const MAX_FIELD_COUNT = 64;
export const MAX_FILENAME_LEN = 255;

const fieldEnvelopeSchema = z.object({
  v: z.unknown(),
  t: z.string(),
  s: z.string(),
});

const cipherEnvelopeSchema = z.object({
  c: z.string(),
  i: z.string(),
  s: z.string(),
  alg: z.string(),
  h: z.string(),
});

const fieldEnvelopeWithCipher = z.union([fieldEnvelopeSchema, cipherEnvelopeSchema]);

const fieldsObjectSchema = z.record(z.string(), fieldEnvelopeWithCipher);

const dictionaryFieldsSchema = z
  .object({
    name: fieldEnvelopeSchema.optional(),
    enabled: fieldEnvelopeSchema.optional(),
    lang: fieldEnvelopeSchema.optional(),
  })
  .catchall(fieldEnvelopeWithCipher);

const fontFieldsSchema = z
  .object({
    name: fieldEnvelopeSchema.optional(),
    family: fieldEnvelopeSchema.optional(),
    style: fieldEnvelopeSchema.optional(),
    weight: fieldEnvelopeSchema.optional(),
    variable: fieldEnvelopeSchema.optional(),
    byteSize: fieldEnvelopeSchema.optional(),
    downloadedAt: fieldEnvelopeSchema.optional(),
  })
  .catchall(fieldEnvelopeWithCipher);

interface KindSpec {
  minSchemaVersion: number;
  maxSchemaVersion: number;
  maxRowsPerUser: number;
  fields: z.ZodTypeAny;
  binary: boolean;
}

export const KIND_ALLOWLIST: Record<string, KindSpec> = {
  dictionary: {
    minSchemaVersion: 1,
    maxSchemaVersion: 1,
    maxRowsPerUser: 200,
    fields: dictionaryFieldsSchema,
    binary: true,
  },
  font: {
    minSchemaVersion: 1,
    maxSchemaVersion: 1,
    maxRowsPerUser: 500,
    fields: fontFieldsSchema,
    binary: true,
  },
};

export const isAllowedKind = (kind: string): boolean => Object.hasOwn(KIND_ALLOWLIST, kind);

export interface FilenameOk {
  ok: true;
}
export interface FilenameError {
  ok: false;
  reason: string;
}

export const validateFilename = (name: string): FilenameOk | FilenameError => {
  if (name.length === 0) return { ok: false, reason: 'empty' };
  if (name.length > MAX_FILENAME_LEN) return { ok: false, reason: 'too long' };
  if (name === '.' || name === '..') return { ok: false, reason: 'dot path' };
  if (name.includes('/') || name.includes('\\')) return { ok: false, reason: 'path separator' };
  if (name.includes('..')) return { ok: false, reason: 'path traversal' };
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return { ok: false, reason: 'control character' };
    }
  }
  return { ok: true };
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: SyncErrorCode; message: string; cause?: unknown };

const measureJsonBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).length;

const manifestFileSchema = z.object({
  filename: z.string(),
  byteSize: z.number().int().nonnegative(),
  partialMd5: z.string(),
  mtime: z.number().optional(),
});

const manifestSchema = z.object({
  files: z.array(manifestFileSchema),
  schemaVersion: z.number().int(),
});

export const validateRow = (row: ReplicaRow): ValidationResult => {
  if (!isAllowedKind(row.kind)) {
    return { ok: false, code: 'UNKNOWN_KIND', message: `Unknown kind: ${row.kind}` };
  }
  const spec = KIND_ALLOWLIST[row.kind]!;

  if (row.schema_version < spec.minSchemaVersion || row.schema_version > spec.maxSchemaVersion) {
    return {
      ok: false,
      code: 'SCHEMA_TOO_NEW',
      message: `schemaVersion ${row.schema_version} out of bounds [${spec.minSchemaVersion}, ${spec.maxSchemaVersion}] for kind ${row.kind}`,
    };
  }

  const fieldKeys = Object.keys(row.fields_jsonb);
  if (fieldKeys.length > MAX_FIELD_COUNT) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: `field count ${fieldKeys.length} exceeds MAX_FIELD_COUNT=${MAX_FIELD_COUNT}`,
    };
  }

  const fieldsBytes = measureJsonBytes(row.fields_jsonb);
  if (fieldsBytes > MAX_JSON_BYTES) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: `fields_jsonb size ${fieldsBytes}B exceeds MAX_JSON_BYTES=${MAX_JSON_BYTES}`,
    };
  }

  const fieldsParse = fieldsObjectSchema.safeParse(row.fields_jsonb);
  if (!fieldsParse.success) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'malformed field envelope',
      cause: fieldsParse.error,
    };
  }

  const kindParse = spec.fields.safeParse(row.fields_jsonb);
  if (!kindParse.success) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: `kind=${row.kind} fields validation failed`,
      cause: kindParse.error,
    };
  }

  if (row.manifest_jsonb !== null) {
    const manifestParse = manifestSchema.safeParse(row.manifest_jsonb);
    if (!manifestParse.success) {
      return {
        ok: false,
        code: 'VALIDATION',
        message: 'malformed manifest_jsonb',
        cause: manifestParse.error,
      };
    }
    for (const file of row.manifest_jsonb.files) {
      const fnCheck = validateFilename(file.filename);
      if (!fnCheck.ok) {
        return {
          ok: false,
          code: 'VALIDATION',
          message: `manifest filename invalid: ${file.filename} (${fnCheck.reason})`,
        };
      }
    }
  }

  return { ok: true };
};
