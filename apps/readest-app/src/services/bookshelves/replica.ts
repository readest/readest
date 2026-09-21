import { z } from 'zod';
import type { Hlc, ReplicaRow } from '@/types/replica';
import { bookshelfIdSchema, bookshelfSchema, isBuiltinBookshelf } from './definitions';

const timestamp = z
  .string()
  .regex(/^[0-9a-f]{13}-[0-9a-f]{8}-.+$/)
  .transform((value) => value as Hlc);
const envelope = z.object({ t: timestamp, s: z.string().min(1), v: z.unknown() });
export const bookshelfFieldsSchema = z
  .object({
    definition: envelope.extend({ v: bookshelfSchema }).optional(),
    position: envelope.extend({ v: z.number().finite() }).optional(),
  })
  .strict();
export const bookshelfReplicaSchema: z.ZodType<ReplicaRow> = z
  .object({
    user_id: z.string(),
    kind: z.literal('bookshelf'),
    replica_id: bookshelfIdSchema,
    fields_jsonb: bookshelfFieldsSchema,
    manifest_jsonb: z.null(),
    reincarnation: z.null(),
    deleted_at_ts: timestamp.nullable(),
    updated_at_ts: timestamp,
    schema_version: z.literal(1),
  })
  .refine((row) => !row.deleted_at_ts || !isBuiltinBookshelf(row.replica_id))
  .refine(
    (row) => !row.fields_jsonb.definition || row.fields_jsonb.definition.v.id === row.replica_id,
  );
