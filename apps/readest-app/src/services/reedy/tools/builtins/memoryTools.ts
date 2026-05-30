import { z } from 'zod';
import type { ReedyTool } from '../types';
import type { MemoryService } from '../../memory/MemoryService';
import type { MemoryScope } from '../../db/types';

/**
 * Memory tools (Phase 2.4 families 3, 4, 5 — shipped now that Phase 3.1
 * has MemoryService). Five tools:
 *
 *   - searchUserMemory  (user scope, read)
 *   - writeUserMemory   (user scope, read — internal scratchpad, not a
 *     navigate/write operation; key is allowlisted against injection)
 *   - searchBookMemory  (book scope, read)
 *   - writeBookMemory   (book scope, read; allowlisted key)
 *   - searchSessionMemory (session scope, read; no write — sessions
 *     re-derive from the message log per plan §3.1)
 *
 * `permission: 'read'` for writes because memory writes don't mutate
 * anything external — they're the agent's own scratchpad. The
 * /system|policy|prompt|injection|override/i key blocklist (plan D8)
 * keeps the model from sneaking new policy into the system prompt via
 * memory.
 */

const MEMORY_KEY_BLOCKLIST = /system|policy|prompt|injection|override/i;
const MEMORY_KEY_PATTERN = /^[a-z0-9][a-z0-9_\-:.]{0,127}$/i;

const writeInputSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(MEMORY_KEY_PATTERN, 'key must match [a-zA-Z0-9_\\-:.]')
    .refine((k) => !MEMORY_KEY_BLOCKLIST.test(k), {
      message: 'key matches the policy-injection blocklist',
    }),
  summary: z.string().min(1).max(2_000),
});

const searchInputSchema = z.object({
  /** When omitted the tool returns the most recent N memories. */
  query: z.string().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

export interface SearchMemoryResult {
  memories: Array<{
    key: string;
    summary: string;
    updatedAt: number;
    score: number;
  }>;
}

export interface WriteMemoryResult {
  ok: true;
  key: string;
}

export interface WriteMemoryToolDeps {
  service: MemoryService;
  /** Resolves the scope_key for this turn (userId / bookHash / sessionId). */
  scopeKey: () => string;
  /** Optional source message id wired up by the runtime. */
  sourceMessageId?: () => string | undefined;
}

export interface SearchMemoryToolDeps {
  service: MemoryService;
  scopeKey: () => string;
}

function createSearchTool(
  name: string,
  description: string,
  scope: MemoryScope,
  deps: SearchMemoryToolDeps,
): ReedyTool<z.input<typeof searchInputSchema>, SearchMemoryResult> {
  return {
    name,
    description,
    permission: 'read',
    parallelSafe: true,
    inputSchema: searchInputSchema,
    async run(args) {
      const parsed = searchInputSchema.parse(args);
      const memories = await deps.service.search({
        scope,
        scopeKey: deps.scopeKey(),
        query: parsed.query,
        limit: parsed.limit,
      });
      return {
        memories: memories.map((m) => ({
          key: m.key,
          summary: m.summary,
          updatedAt: m.updatedAt,
          score: m.score,
        })),
      };
    },
  };
}

function createWriteTool(
  name: string,
  description: string,
  scope: MemoryScope,
  deps: WriteMemoryToolDeps,
): ReedyTool<z.input<typeof writeInputSchema>, WriteMemoryResult> {
  return {
    name,
    description,
    permission: 'read', // writes touch only the agent's own scratchpad
    parallelSafe: false, // memory writes serialize per-scope to avoid
    // racing on the same key inside one turn
    inputSchema: writeInputSchema,
    async run(args) {
      await deps.service.write({
        scope,
        scopeKey: deps.scopeKey(),
        key: args.key,
        summary: args.summary,
        sourceMessageId: deps.sourceMessageId?.(),
      });
      return { ok: true, key: args.key };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

export function createSearchUserMemoryTool(deps: SearchMemoryToolDeps) {
  return createSearchTool(
    'searchUserMemory',
    "Search the agent's stable memory about THIS USER (preferences, taste, what topics they care about). Returns the top-K matches by semantic + recency hybrid. Omit `query` to list the most recent.",
    'user',
    deps,
  );
}

export function createWriteUserMemoryTool(deps: WriteMemoryToolDeps) {
  return createWriteTool(
    'writeUserMemory',
    "Save a stable fact about THIS USER (preferences, taste, prior conversations). Re-writing the same `key` replaces the prior summary. Don't store policy / system instructions — those keys are blocked.",
    'user',
    deps,
  );
}

export function createSearchBookMemoryTool(deps: SearchMemoryToolDeps) {
  return createSearchTool(
    'searchBookMemory',
    "Search the agent's memory about THIS BOOK (character arcs, themes, prior summaries). Returns the top-K matches. Omit `query` to list the most recent.",
    'book',
    deps,
  );
}

export function createWriteBookMemoryTool(deps: WriteMemoryToolDeps) {
  return createWriteTool(
    'writeBookMemory',
    "Save a stable fact about THIS BOOK (character notes, themes, plot summaries). Re-writing the same `key` replaces the prior summary. Don't store policy / system instructions — those keys are blocked.",
    'book',
    deps,
  );
}

export function createSearchSessionMemoryTool(deps: SearchMemoryToolDeps) {
  return createSearchTool(
    'searchSessionMemory',
    "Search the agent's memory specific to THIS CONVERSATION SESSION. Read-only — the session's full transcript already lives in the message log.",
    'session',
    deps,
  );
}
