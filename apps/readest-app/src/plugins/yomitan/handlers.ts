import { z } from 'zod';
import type {
  PluginOperationHandlers,
  PluginWorkerOperationContext,
} from '@/services/plugins/workerServer';
import type { DatabaseExecResult, DatabaseRow } from '@/types/database';
import {
  buildYomitanIndex,
  inspectYomitanSource,
  probeYomitanSource,
  readYomitanResource,
  verifyYomitanIndex,
  type YomitanHost,
} from './importer';
import { lookupYomitan } from './lookup';

const statResultSchema = z.strictObject({
  name: z.string(),
  size: z.number().int().nonnegative(),
  type: z.string().optional(),
  lastModified: z.number().optional(),
});

const bytesResultSchema = z.strictObject({ bytes: z.instanceof(Uint8Array) });
const execResultSchema = z.strictObject({
  rowsAffected: z.number(),
  lastInsertId: z.number(),
});
const rowsResultSchema = z.strictObject({
  rows: z.array(z.record(z.string(), z.unknown())),
});
const transactionResultSchema = z.strictObject({
  results: z.array(execResultSchema),
});

const createYomitanHost = (context: PluginWorkerOperationContext): YomitanHost => ({
  signal: context.signal,
  stat: async (handle) => statResultSchema.parse(await context.call('source.stat', { handle })),
  readRange: async (handle, offset, length) =>
    bytesResultSchema.parse(await context.call('source.readRange', { handle, offset, length })),
  execute: async (handle, sql, params = []): Promise<DatabaseExecResult> =>
    execResultSchema.parse(await context.call('sql.execute', { handle, sql, params })),
  select: async (handle, sql, params = [], maxRows = 1_000): Promise<{ rows: DatabaseRow[] }> =>
    rowsResultSchema.parse(await context.call('sql.select', { handle, sql, params, maxRows })),
  transaction: async (handle, statements) =>
    transactionResultSchema.parse(await context.call('sql.transaction', { handle, statements })),
  progress: (stage, completed, total) => context.progress(stage, completed, total),
});

export const yomitanOperationHandlers: PluginOperationHandlers = {
  probe: async (payload, context) => {
    const host = createYomitanHost(context);
    const matches = [];
    for (const source of payload.sources) {
      matches.push(...(await probeYomitanSource(host, source.handle)).matches);
    }
    return { matches };
  },
  inspect: (payload, context) =>
    inspectYomitanSource(createYomitanHost(context), payload.sourceHandle),
  buildIndex: (payload, context) => buildYomitanIndex(createYomitanHost(context), payload),
  verifyIndex: (payload, context) =>
    verifyYomitanIndex(createYomitanHost(context), payload.databaseHandle),
  lookup: (payload, context) => lookupYomitan(createYomitanHost(context), payload),
  readResource: (payload, context) => readYomitanResource(createYomitanHost(context), payload),
};
