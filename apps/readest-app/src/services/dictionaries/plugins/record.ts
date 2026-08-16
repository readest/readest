import { z } from 'zod';
import type { ImportedDictionary } from '../types';

export const pluginDictionaryMetadataSchema = z.strictObject({
  recordVersion: z.literal(1),
  pluginId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u),
  formatId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u),
  sourceFormatVersion: z.number().int().positive(),
  indexVersion: z.number().int().positive(),
  source: z.strictObject({
    filename: z
      .string()
      .min(1)
      .max(255)
      .refine((name) => !name.includes('/') && !name.includes('\\') && !name.includes('\0')),
    byteSize: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  }),
});

export const parsePluginDictionaryMetadata = (
  value: unknown,
): ImportedDictionary['plugin'] | undefined => {
  const parsed = pluginDictionaryMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};
