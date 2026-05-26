import { z } from 'zod';
import type { ReedyTool } from '../types';
import type { BookRetriever, RetrieverStatus } from '@/services/reedy/retrieval/BookRetriever';
import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';

/**
 * Phase 2.4 ReedyTool wrapper around BookRetriever.search().
 *
 * Distinct from the MVP `src/services/reedy/tools/lookupPassage.ts` —
 * that one is a Vercel `ai`-SDK Tool factory with baked-in turn-state
 * (dedupe, budget, parallel serialization, size clamp, trust marker).
 * This one is a thinner ReedyTool that exposes a single search call to
 * the M2.6 AgentRuntime. The runtime adds turn-state policies through
 * the ToolRegistry + PromptContextBuilder layers instead of baking them
 * into the tool body. Both lookupPassage paths can coexist while we
 * compare them against the measurement-plan targets.
 */

const inputSchema = z.object({
  query: z.string().min(1).max(500),
  topK: z.number().int().min(1).max(5).default(5),
  spoilerBoundPosition: z.number().int().nonnegative().optional(),
});

export interface LookupPassageDeps {
  bookHash: string;
  retriever: BookRetriever;
  activeEmbeddingModel: EmbeddingModel;
}

export interface LookupPassageResult {
  passages: Array<{
    cfi: string;
    endCfi: string;
    chapter: string | null;
    text: string;
    score: number;
  }>;
  status: RetrieverStatus;
  reason?: string;
}

export function createLookupPassageTool(
  deps: LookupPassageDeps,
): ReedyTool<z.input<typeof inputSchema>, LookupPassageResult> {
  return {
    name: 'lookupPassage',
    description:
      "Search the user's currently open book for passages relevant to a query. Returns up to topK passages with CFI anchors the user can navigate to. Use this whenever the user asks about book content.",
    permission: 'read',
    parallelSafe: true,
    inputSchema,
    async run(args) {
      const parsed = inputSchema.parse(args);
      const res = await deps.retriever.search({
        bookHash: deps.bookHash,
        query: parsed.query,
        k: parsed.topK,
        spoilerBoundPosition: parsed.spoilerBoundPosition,
        activeEmbeddingModel: deps.activeEmbeddingModel,
      });
      return {
        passages: res.passages.map((p) => ({
          cfi: p.cfi,
          endCfi: p.endCfi,
          chapter: p.chapterTitle,
          text: p.text,
          score: p.score,
        })),
        status: res.status,
        reason: res.reason,
      };
    },
  };
}
