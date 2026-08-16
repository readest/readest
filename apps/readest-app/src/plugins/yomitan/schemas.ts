import { z } from 'zod';

const yomitanIndexSchema = z.object({
  title: z.string().min(1).max(1_024),
  revision: z.union([z.string(), z.number()]).optional(),
  format: z.number().int().optional(),
  version: z.number().int().optional(),
  sequenced: z.boolean().optional(),
  tagMeta: z.record(z.string(), z.unknown()).optional(),
});

export interface YomitanIndex {
  title: string;
  revision?: string;
  sourceFormatVersion: 1 | 2 | 3;
  sequenced?: boolean;
  tagMeta?: Record<string, unknown>;
}

export const parseYomitanIndex = (value: unknown): YomitanIndex => {
  const parsed = yomitanIndexSchema.parse(value);
  const version = parsed.format ?? parsed.version;
  if (version !== 1 && version !== 2 && version !== 3) {
    throw new Error(`Unsupported Yomitan dictionary format: ${String(version)}`);
  }
  return {
    title: parsed.title,
    sourceFormatVersion: version,
    ...(parsed.revision === undefined ? {} : { revision: String(parsed.revision) }),
    ...(parsed.sequenced === undefined ? {} : { sequenced: parsed.sequenced }),
    ...(parsed.tagMeta === undefined ? {} : { tagMeta: parsed.tagMeta }),
  };
};

const glossaryItemSchema = z.union([
  z.string().max(100_000),
  z.record(z.string(), z.unknown()),
  z.tuple([z.string().max(100_000), z.array(z.string().max(256)).max(32)]),
]);

export const yomitanTermBankSchema = z
  .array(
    z.tuple([
      z.string().min(1).max(512),
      z.string().max(512),
      z.union([z.string().max(4_000), z.null()]),
      z.string().max(4_000),
      z.number().finite(),
      z.array(glossaryItemSchema).max(2_000),
      z.number().int(),
      z.string().max(4_000),
    ]),
  )
  .max(100_000);

export type YomitanTermTuple = z.infer<typeof yomitanTermBankSchema>[number];

export const yomitanTagBankSchema = z
  .array(
    z.tuple([
      z.string().min(1).max(256),
      z.string().max(256),
      z.number().finite(),
      z.string().max(4_000),
      z.number().finite(),
    ]),
  )
  .max(100_000);

export type YomitanTagTuple = z.infer<typeof yomitanTagBankSchema>[number];

const frequencyValueSchema = z.union([
  z.string().max(512),
  z.number().finite(),
  z.strictObject({
    value: z.number().finite(),
    displayValue: z.string().max(512).optional(),
  }),
]);

const frequencyPayloadSchema = z.union([
  frequencyValueSchema,
  z.strictObject({
    reading: z.string().max(512),
    frequency: frequencyValueSchema,
  }),
]);

const pitchPositionSchema = z.union([z.number().int().nonnegative(), z.string().regex(/^[HL]+$/u)]);

const positionsSchema = z.union([
  z.number().int().nonnegative(),
  z.array(z.number().int().nonnegative()).max(128),
]);

const pitchPayloadSchema = z.strictObject({
  reading: z.string().max(512),
  pitches: z
    .array(
      z.strictObject({
        position: pitchPositionSchema,
        nasal: positionsSchema.optional(),
        devoice: positionsSchema.optional(),
        tags: z.array(z.string().max(256)).max(64).optional(),
      }),
    )
    .max(128),
});

const ipaPayloadSchema = z.strictObject({
  reading: z.string().max(512),
  transcriptions: z
    .array(
      z.strictObject({
        ipa: z.string().min(1).max(2_000),
        tags: z.array(z.string().max(256)).max(64).optional(),
      }),
    )
    .max(128),
});

export const yomitanTermMetaBankSchema = z
  .array(
    z.union([
      z.tuple([z.string().min(1).max(512), z.literal('freq'), frequencyPayloadSchema]),
      z.tuple([z.string().min(1).max(512), z.literal('pitch'), pitchPayloadSchema]),
      z.tuple([z.string().min(1).max(512), z.literal('ipa'), ipaPayloadSchema]),
    ]),
  )
  .max(100_000);

export type YomitanTermMetaTuple = z.infer<typeof yomitanTermMetaBankSchema>[number];

export const splitYomitanTags = (value: string | null): string[] =>
  value?.trim() ? value.trim().split(/\s+/u) : [];
