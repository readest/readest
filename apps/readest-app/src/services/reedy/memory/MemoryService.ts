import type { ReedyDb } from '../db/ReedyDb';
import type { MemoryRow, MemoryScope, ScoredMemoryRow } from '../db/types';
import type { EmbeddingModel } from '../models/EmbeddingModel';

/**
 * Phase 3.1 — one MemoryService class wrapping ReedyDb's memory primitives
 * for a fixed scope. The plan's original separate UserMemory /
 * BookMemory / SessionMemory services collapse to one type: the only
 * thing that differs is the scope label, and tests + tools are cleaner
 * when we don't have three near-identical classes.
 *
 * Reads embed the query string through the active embedding model and
 * call the underlying searchMemories(); writes embed the summary so the
 * row participates in subsequent semantic search.
 *
 * Session memory is search-only by convention (the plan's §3.1) — full
 * transcript already lives in the messages table, so explicit
 * session-scope writes are redundant. The class still allows write() at
 * any scope; callers (tools) enforce the convention.
 */
export class MemoryService {
  constructor(
    private readonly reedy: ReedyDb,
    private readonly model: EmbeddingModel | null,
  ) {}

  async write(args: {
    scope: MemoryScope;
    scopeKey: string;
    key: string;
    summary: string;
    sourceMessageId?: string;
  }): Promise<MemoryRow> {
    if (this.model) {
      // Embed first so we can lazy-create the embeddings table at the
      // right dim before we issue the insert.
      const [embedding] = await this.model.embed([args.summary]);
      await this.reedy.ensureMemoryEmbeddingsTable(this.model.dim);
      return this.reedy.upsertMemory({
        scope: args.scope,
        scopeKey: args.scopeKey,
        key: args.key,
        summary: args.summary,
        sourceMessageId: args.sourceMessageId,
        embedding,
      });
    }
    return this.reedy.upsertMemory({
      scope: args.scope,
      scopeKey: args.scopeKey,
      key: args.key,
      summary: args.summary,
      sourceMessageId: args.sourceMessageId,
    });
  }

  async search(args: {
    scope: MemoryScope;
    scopeKey: string;
    query?: string;
    limit: number;
    recencyWeight?: number;
  }): Promise<ScoredMemoryRow[]> {
    if (args.query && args.query.trim().length > 0 && this.model) {
      const [queryEmbedding] = await this.model.embed([args.query]);
      return this.reedy.searchMemories({
        scope: args.scope,
        scopeKey: args.scopeKey,
        queryEmbedding,
        limit: args.limit,
        recencyWeight: args.recencyWeight,
      });
    }
    return this.reedy.searchMemories({
      scope: args.scope,
      scopeKey: args.scopeKey,
      limit: args.limit,
      recencyWeight: args.recencyWeight,
    });
  }

  list(scope: MemoryScope, scopeKey: string, limit: number): Promise<MemoryRow[]> {
    return this.reedy.listMemories(scope, scopeKey, limit);
  }

  get(scope: MemoryScope, scopeKey: string, key: string): Promise<MemoryRow | null> {
    return this.reedy.getMemory(scope, scopeKey, key);
  }

  delete(scope: MemoryScope, scopeKey: string, key: string): Promise<boolean> {
    return this.reedy.deleteMemory(scope, scopeKey, key);
  }
}
