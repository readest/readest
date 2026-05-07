import { describe, expect, test } from 'vitest';
import {
  KIND_ALLOWLIST,
  isAllowedKind,
  validateFilename,
  validateRow,
  MAX_JSON_BYTES,
  MAX_FIELD_COUNT,
} from '@/libs/replicaSchemas';
import type { ReplicaRow, Hlc } from '@/types/replica';

const HLC_A = '0000000000064-00000000-dev-a' as Hlc;

const baseRow = (overrides: Partial<ReplicaRow> = {}): ReplicaRow => ({
  user_id: 'u1',
  kind: 'dictionary',
  replica_id: 'r1',
  fields_jsonb: {
    name: { v: 'Webster', t: HLC_A, s: 'dev-a' },
    enabled: { v: true, t: HLC_A, s: 'dev-a' },
  },
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: HLC_A,
  schema_version: 1,
  ...overrides,
});

describe('isAllowedKind', () => {
  test('current allowlist contains dictionary + font + texture', () => {
    expect(isAllowedKind('dictionary')).toBe(true);
    expect(isAllowedKind('font')).toBe(true);
    expect(isAllowedKind('texture')).toBe(true);
    expect(isAllowedKind('opds_catalog')).toBe(false);
  });

  test('rejects arbitrary strings', () => {
    expect(isAllowedKind('arbitrary')).toBe(false);
    expect(isAllowedKind('')).toBe(false);
    expect(isAllowedKind('../etc/passwd')).toBe(false);
  });

  test('KIND_ALLOWLIST keys match isAllowedKind', () => {
    for (const k of Object.keys(KIND_ALLOWLIST)) {
      expect(isAllowedKind(k)).toBe(true);
    }
  });
});

describe('validateFilename', () => {
  test('accepts plain filenames', () => {
    expect(validateFilename('webster.mdx').ok).toBe(true);
    expect(validateFilename('webster.mdd').ok).toBe(true);
    expect(validateFilename('manifest.json').ok).toBe(true);
    expect(validateFilename('foo-bar_baz.css').ok).toBe(true);
  });

  test('rejects path traversal', () => {
    expect(validateFilename('../etc/passwd').ok).toBe(false);
    expect(validateFilename('..').ok).toBe(false);
    expect(validateFilename('foo/../bar').ok).toBe(false);
  });

  test('rejects path separators', () => {
    expect(validateFilename('foo/bar').ok).toBe(false);
    expect(validateFilename('foo\\bar').ok).toBe(false);
  });

  test('rejects empty / too-long names', () => {
    expect(validateFilename('').ok).toBe(false);
    expect(validateFilename('a'.repeat(256)).ok).toBe(false);
  });

  test('accepts up to 255 chars', () => {
    expect(validateFilename('a'.repeat(255)).ok).toBe(true);
  });

  test('rejects null bytes', () => {
    expect(validateFilename('foo\u0000bar').ok).toBe(false);
  });

  test('rejects control characters', () => {
    expect(validateFilename('foo\u0001bar').ok).toBe(false);
    expect(validateFilename('foo\u001fbar').ok).toBe(false);
    expect(validateFilename('foo\u007fbar').ok).toBe(false);
  });

  test('accepts unicode (utf-8 dictionary names common in CJK locales)', () => {
    expect(validateFilename('韦氏高阶英汉双解词典.mdx').ok).toBe(true);
  });
});

describe('validateRow', () => {
  test('accepts a valid dictionary row', () => {
    const result = validateRow(baseRow());
    expect(result.ok).toBe(true);
  });

  test('rejects unknown kind', () => {
    const result = validateRow(baseRow({ kind: 'arbitrary' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN_KIND');
  });

  test('rejects fields_jsonb beyond MAX_JSON_BYTES (64 KiB)', () => {
    const huge = { ...baseRow().fields_jsonb };
    huge['blob'] = { v: 'x'.repeat(MAX_JSON_BYTES), t: HLC_A, s: 'dev-a' };
    const result = validateRow(baseRow({ fields_jsonb: huge }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VALIDATION');
  });

  test('rejects fields_jsonb with too many fields (> 64)', () => {
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < MAX_FIELD_COUNT + 1; i++) {
      fields[`field${i}`] = { v: i, t: HLC_A, s: 'dev-a' };
    }
    const result = validateRow(baseRow({ fields_jsonb: fields as never }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VALIDATION');
  });

  test('rejects schemaVersion below minSupported', () => {
    const result = validateRow(baseRow({ schema_version: 0 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SCHEMA_TOO_NEW');
  });

  test('rejects schemaVersion above maxKnown', () => {
    const result = validateRow(baseRow({ schema_version: 999 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SCHEMA_TOO_NEW');
  });

  test('rejects manifest with invalid filename', () => {
    const result = validateRow(
      baseRow({
        manifest_jsonb: {
          schemaVersion: 1,
          files: [{ filename: '../etc/passwd', byteSize: 1, partialMd5: 'abc' }],
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VALIDATION');
  });

  test('accepts manifest with valid filenames', () => {
    const result = validateRow(
      baseRow({
        manifest_jsonb: {
          schemaVersion: 1,
          files: [
            { filename: 'webster.mdx', byteSize: 1024, partialMd5: 'abcdef' },
            { filename: 'webster.mdd', byteSize: 2048, partialMd5: 'abcdef' },
          ],
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  test('preserves unknown fields (forwards-compat)', () => {
    const row = baseRow();
    row.fields_jsonb['future_field'] = { v: 'unknown', t: HLC_A, s: 'dev-a' };
    const result = validateRow(row);
    expect(result.ok).toBe(true);
  });

  test('rejects fields with malformed envelope (missing v/t/s)', () => {
    const row = baseRow();
    row.fields_jsonb['broken'] = { v: 'x' } as never;
    const result = validateRow(row);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VALIDATION');
  });
});
