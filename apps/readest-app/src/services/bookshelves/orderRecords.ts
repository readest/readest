import { z } from 'zod';
import { v5 as uuidv5 } from 'uuid';
import type { Hlc, ReplicaRow } from '@/types/replica';
import { bookshelfIdSchema } from './definitions';
import { hlcParse } from '@/libs/crdt';

// Even the longest supported IDs fit below the existing 64 KiB replica cap.
const CHUNK_SIZE = 256;
export const bookshelfOrderModeSchema = z
  .object({
    shelfId: bookshelfIdSchema,
    active: z.boolean(),
    definitionStamp: z
      .string()
      .regex(/^[0-9a-f]{13}-[0-9a-f]{8}-.+$/)
      .nullable(),
  })
  .strict();

export const createBookshelfOrderModeRow = (
  shelfId: string,
  active: boolean,
  definitionStamp: string | null,
  clock: { userId: string; deviceId: string; next: () => Hlc },
): ReplicaRow => {
  const t = clock.next();
  return {
    user_id: clock.userId,
    kind: 'bookshelf',
    replica_id: uuidv5(JSON.stringify(['item-order-mode', shelfId]), uuidv5.URL),
    fields_jsonb: {
      itemOrderMode: {
        v: bookshelfOrderModeSchema.parse({ shelfId, active, definitionStamp }),
        t,
        s: clock.deviceId,
      },
    },
    updated_at_ts: t,
    deleted_at_ts: null,
    reincarnation: null,
    manifest_jsonb: null,
    schema_version: 1,
  };
};

export const readBookshelfOrderModes = (rows: ReplicaRow[]) => {
  const modes = new Map<string, z.infer<typeof bookshelfOrderModeSchema>>();
  for (const row of rows) {
    if (row.deleted_at_ts) continue;
    const parsed = bookshelfOrderModeSchema.safeParse(row.fields_jsonb['itemOrderMode']?.v);
    if (
      parsed.success &&
      row.replica_id ===
        uuidv5(JSON.stringify(['item-order-mode', parsed.data.shelfId]), uuidv5.URL)
    )
      modes.set(parsed.data.shelfId, parsed.data);
  }
  return modes;
};

export const bookshelfItemOrderSchema = z
  .object({
    shelfId: bookshelfIdSchema,
    scope: z
      .string()
      .max(4000)
      .regex(/^(none|group|series|author|tag|subject|status):/),
    chunk: z.number().int().nonnegative().max(1000000),
    chunks: z.number().int().positive().max(1000000),
    ids: z.array(z.string().max(200)).max(CHUNK_SIZE),
    orderedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict()
  .refine((value) => value.chunk < value.chunks);

export const createBookshelfOrderRows = (
  shelfId: string,
  scope: string,
  ids: string[],
  clock: { userId: string; deviceId: string; next: () => Hlc },
  orderedAt?: number,
): ReplicaRow[] => {
  const t = clock.next();
  const updatedAt = orderedAt ?? hlcParse(t).physicalMs;
  const chunks = Math.max(1, Math.ceil(ids.length / CHUNK_SIZE));
  return Array.from({ length: chunks }, (_, chunk) => ({
    user_id: clock.userId,
    kind: 'bookshelf',
    replica_id: uuidv5(JSON.stringify(['item-order', shelfId, scope, chunk]), uuidv5.URL),
    fields_jsonb: {
      itemOrder: {
        v: bookshelfItemOrderSchema.parse({
          shelfId,
          scope,
          chunk,
          chunks,
          ids: ids.slice(chunk * CHUNK_SIZE, (chunk + 1) * CHUNK_SIZE),
          orderedAt: updatedAt,
        }),
        t,
        s: clock.deviceId,
      },
    },
    updated_at_ts: t,
    deleted_at_ts: null,
    reincarnation: null,
    manifest_jsonb: null,
    schema_version: 1,
  }));
};

/** Only complete revisions become visible, including when sync batches arrive out of order. */
export const readBookshelfItemOrders = (rows: ReplicaRow[]) => {
  const revisions = new Map<
    string,
    {
      shelfId: string;
      scope: string;
      stamp: string;
      orderedAt: number;
      count: number;
      chunks: Map<number, string[]>;
    }
  >();
  for (const row of rows) {
    if (row.deleted_at_ts) continue;
    const field = row.fields_jsonb['itemOrder'];
    const parsed = bookshelfItemOrderSchema.safeParse(field?.v);
    if (!parsed.success || !field) continue;
    const { shelfId, scope, chunk, chunks, ids } = parsed.data;
    const orderedAt = parsed.data.orderedAt ?? hlcParse(field.t).physicalMs;
    if (
      row.replica_id !== uuidv5(JSON.stringify(['item-order', shelfId, scope, chunk]), uuidv5.URL)
    )
      continue;
    const key = JSON.stringify([shelfId, scope, field.t]);
    const revision = revisions.get(key) ?? {
      shelfId,
      scope,
      stamp: field.t,
      orderedAt,
      count: chunks,
      chunks: new Map(),
    };
    if (revision.count !== chunks || revision.orderedAt !== orderedAt) continue;
    revision.chunks.set(chunk, ids);
    revisions.set(key, revision);
  }
  const result: Record<string, Record<string, string[]>> = {};
  const updatedAt: Record<string, Record<string, number>> = {};
  const newest = new Map<string, string>();
  for (const revision of revisions.values()) {
    const { shelfId, scope, stamp, orderedAt, count, chunks } = revision;
    const key = JSON.stringify([shelfId, scope]);
    if (chunks.size !== count || (newest.get(key) ?? '') >= stamp) continue;
    newest.set(key, stamp);
    const shelf = result[shelfId] ?? {};
    shelf[scope] = [...chunks].sort(([a], [b]) => a - b).flatMap(([, ids]) => ids);
    result[shelfId] = shelf;
    (updatedAt[shelfId] ??= {})[scope] = orderedAt;
  }
  return { orders: result, updatedAt };
};
