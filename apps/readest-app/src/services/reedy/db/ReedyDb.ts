import type { DatabaseService } from '@/types/database';
import type {
  BookMeta,
  ChunkRow,
  EmbeddingRow,
  IndexingStatus,
  MemoryRow,
  MemoryScope,
  MemorySearchArgs,
  MemoryWriteArgs,
  ScoredChunk,
  ScoredMemoryRow,
} from './types';

/**
 * Typed wrapper around a Turso DatabaseService opened against reedy.db.
 *
 * MVP scope: single embedding model locked per database lifetime, single
 * global `reedy_book_chunk_embeddings` table created lazily by the first
 * `ensureEmbeddingsTable(dim)` call. Multi-model routing lives only in
 * Appendix A of the plan.
 *
 * Multi-row writes go through DatabaseService.batch() per plan §M1.2. Because
 * batch() takes raw SQL strings (no parameter binding), text values are
 * inline-quoted via {@link sqlQuote}; this is safe for SQLite which only
 * honours `''` as an escape sequence inside single-quoted strings.
 */
export class ReedyDb {
  /**
   * Serializes every DB-mutating call that goes through `batch()` because the
   * underlying Turso connection only allows one BEGIN/COMMIT at a time. This
   * lets BookIndexer run embedding requests in parallel across books while
   * the writes themselves still go through one at a time.
   */
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: DatabaseService) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn, fn);
    // Swallow the value on the queue so a failure in one write doesn't
    // poison every subsequent write, while still letting the caller see it.
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  // ---------------------------------------------------------------------------
  // book meta
  // ---------------------------------------------------------------------------

  async upsertBookMeta(meta: BookMeta): Promise<void> {
    await this.enqueue(() =>
      this.db.execute(
        `INSERT INTO reedy_book_meta
         (book_hash, indexing_status, chunk_count, embedding_model, embedding_dim, indexed_at, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(book_hash) DO UPDATE SET
         indexing_status = excluded.indexing_status,
         chunk_count     = excluded.chunk_count,
         embedding_model = excluded.embedding_model,
         embedding_dim   = excluded.embedding_dim,
         indexed_at      = excluded.indexed_at,
         error           = excluded.error`,
        [
          meta.bookHash,
          meta.indexingStatus,
          meta.chunkCount,
          meta.embeddingModel,
          meta.embeddingDim,
          meta.indexedAt,
          meta.error,
        ],
      ),
    );
  }

  async getBookMeta(bookHash: string): Promise<BookMeta | null> {
    const rows = await this.db.select<{
      book_hash: string;
      indexing_status: string;
      chunk_count: number;
      embedding_model: string;
      embedding_dim: number;
      indexed_at: number | null;
      error: string | null;
    }>('SELECT * FROM reedy_book_meta WHERE book_hash = ?', [bookHash]);
    const row = rows[0];
    if (!row) return null;
    return {
      bookHash: row.book_hash,
      indexingStatus: row.indexing_status as IndexingStatus,
      chunkCount: row.chunk_count,
      embeddingModel: row.embedding_model,
      embeddingDim: row.embedding_dim,
      indexedAt: row.indexed_at,
      error: row.error,
    };
  }

  async setIndexingStatus(
    bookHash: string,
    status: IndexingStatus,
    partial?: Partial<Pick<BookMeta, 'chunkCount' | 'indexedAt' | 'error'>>,
  ): Promise<void> {
    const sets: string[] = ['indexing_status = ?'];
    const params: unknown[] = [status];
    if (partial?.chunkCount !== undefined) {
      sets.push('chunk_count = ?');
      params.push(partial.chunkCount);
    }
    if (partial?.indexedAt !== undefined) {
      sets.push('indexed_at = ?');
      params.push(partial.indexedAt);
    }
    if ('error' in (partial ?? {})) {
      sets.push('error = ?');
      params.push(partial!.error ?? null);
    }
    params.push(bookHash);
    await this.enqueue(() =>
      this.db.execute(`UPDATE reedy_book_meta SET ${sets.join(', ')} WHERE book_hash = ?`, params),
    );
  }

  // ---------------------------------------------------------------------------
  // embeddings table lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Idempotently create the embeddings table with `vector32(<dim>)`. If the
   * table exists with a different dim, throws — the MVP locks one embedding
   * model per database, so a dim mismatch signals a misuse (e.g. the active
   * model changed but `wipeAllData` wasn't called).
   */
  async ensureEmbeddingsTable(dim: number): Promise<void> {
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error(`ensureEmbeddingsTable: dim must be a positive integer, got ${dim}`);
    }
    // Enqueue the whole check-then-create so concurrent indexers don't race
    // between the SELECT and the CREATE.
    await this.enqueue(async () => {
      const existing = await this.db.select<{ sql: string | null }>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='reedy_book_chunk_embeddings'",
      );
      if (existing.length === 0) {
        // Inline `dim` is a validated positive integer above — safe to interpolate.
        await this.db.batch([
          `CREATE TABLE reedy_book_chunk_embeddings (
             chunk_id TEXT PRIMARY KEY REFERENCES reedy_book_chunks(id) ON DELETE CASCADE,
             book_hash TEXT NOT NULL,
             embedding vector32(${dim})
           )`,
          'CREATE INDEX idx_embeddings_book ON reedy_book_chunk_embeddings(book_hash)',
        ]);
        return;
      }
      const m = existing[0]!.sql?.match(/vector32\s*\(\s*(\d+)\s*\)/i);
      const existingDim = m ? parseInt(m[1]!, 10) : NaN;
      if (existingDim !== dim) {
        throw new Error(
          `ensureEmbeddingsTable: dim mismatch — existing table is vector32(${existingDim}), requested vector32(${dim}). ` +
            `Switching embedding models requires wipeAllData() first.`,
        );
      }
    });
  }

  // ---------------------------------------------------------------------------
  // bulk writes
  // ---------------------------------------------------------------------------

  async insertChunks(chunks: ChunkRow[]): Promise<void> {
    if (chunks.length === 0) return;
    const stmts = chunks.map(
      (c) =>
        `INSERT INTO reedy_book_chunks
           (id, book_hash, section_index, chapter_title, start_cfi, end_cfi, position_index, text, token_count)
         VALUES (${sqlQuote(c.id)}, ${sqlQuote(c.bookHash)}, ${c.sectionIndex}, ${sqlQuoteNullable(c.chapterTitle)}, ${sqlQuote(c.startCfi)}, ${sqlQuote(c.endCfi)}, ${c.positionIndex}, ${sqlQuote(c.text)}, ${c.tokenCount})`,
    );
    await this.enqueue(() => this.db.batch(stmts));
  }

  /**
   * Insert embedding rows. Asserts every row's vector matches the existing
   * table's dim (queried once from sqlite_master) before issuing SQL.
   */
  async insertEmbeddings(rows: EmbeddingRow[]): Promise<void> {
    if (rows.length === 0) return;
    const dimRows = await this.db.select<{ sql: string | null }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='reedy_book_chunk_embeddings'",
    );
    const sql = dimRows[0]?.sql;
    const m = sql?.match(/vector32\s*\(\s*(\d+)\s*\)/i);
    if (!m) {
      throw new Error(
        'insertEmbeddings: reedy_book_chunk_embeddings does not exist — call ensureEmbeddingsTable(dim) first.',
      );
    }
    const dim = parseInt(m[1]!, 10);
    for (const r of rows) {
      if (r.embedding.length !== dim) {
        throw new Error(
          `insertEmbeddings: embedding for chunk ${r.chunkId} has length ${r.embedding.length}, expected dim ${dim}`,
        );
      }
    }
    const stmts = rows.map(
      (r) =>
        `INSERT INTO reedy_book_chunk_embeddings (chunk_id, book_hash, embedding)
         VALUES (${sqlQuote(r.chunkId)}, ${sqlQuote(r.bookHash)}, vector32(${sqlQuote(serializeVector(r.embedding))}))`,
    );
    await this.enqueue(() => this.db.batch(stmts));
  }

  // ---------------------------------------------------------------------------
  // data lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Clear a single book's chunks and embeddings but leave the meta row alone.
   * Used by BookIndexer when re-indexing — the meta row has just been set to
   * 'indexing' and must be preserved.
   */
  async clearBookChunks(bookHash: string): Promise<void> {
    await this.enqueue(async () => {
      // Embeddings reference chunks via ON DELETE CASCADE, but the embeddings
      // table may not exist yet on first index — guard with sqlite_master.
      const has = await this.db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='reedy_book_chunk_embeddings'",
      );
      if (has.length > 0) {
        await this.db.execute('DELETE FROM reedy_book_chunk_embeddings WHERE book_hash = ?', [
          bookHash,
        ]);
      }
      await this.db.execute('DELETE FROM reedy_book_chunks WHERE book_hash = ?', [bookHash]);
    });
  }

  async dropBookData(bookHash: string): Promise<void> {
    await this.enqueue(async () => {
      await this.db.execute('DELETE FROM reedy_book_chunk_embeddings WHERE book_hash = ?', [
        bookHash,
      ]);
      await this.db.execute('DELETE FROM reedy_book_chunks WHERE book_hash = ?', [bookHash]);
      await this.db.execute('DELETE FROM reedy_book_meta WHERE book_hash = ?', [bookHash]);
    });
  }

  /**
   * Wipe every Reedy-managed row across the database. Used when the user
   * switches embedding models — the lazy embeddings table keeps its
   * existing vector32(<old-dim>) shape until something writes to it again,
   * but the next ensureEmbeddingsTable(<new-dim>) call will succeed
   * because we DROP the table here as well.
   */
  async wipeAllData(): Promise<void> {
    await this.enqueue(async () => {
      await this.db.execute('DELETE FROM reedy_book_meta');
      // Drop embeddings tables so a future ensure*EmbeddingsTable(newDim)
      // is free to recreate them with a different vector32 width.
      await this.db.execute('DROP TABLE IF EXISTS reedy_book_chunk_embeddings');
      await this.db.execute('DROP TABLE IF EXISTS reedy_memory_embeddings');
      await this.db.execute('DELETE FROM reedy_book_chunks');
      await this.db.execute('DELETE FROM reedy_memory');
    });
  }

  // ---------------------------------------------------------------------------
  // memory (Phase 3.1)
  // ---------------------------------------------------------------------------

  /**
   * Lazy-create reedy_memory_embeddings the same way the chunk embeddings
   * table is created — vector32(<dim>) lives on a sibling row keyed on
   * memory_id, with ON DELETE CASCADE so deleting a memory row also drops
   * its vector. Same dim-mismatch contract as ensureEmbeddingsTable.
   */
  async ensureMemoryEmbeddingsTable(dim: number): Promise<void> {
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error(`ensureMemoryEmbeddingsTable: dim must be a positive integer, got ${dim}`);
    }
    await this.enqueue(async () => {
      const existing = await this.db.select<{ sql: string | null }>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='reedy_memory_embeddings'",
      );
      if (existing.length === 0) {
        await this.db.batch([
          `CREATE TABLE reedy_memory_embeddings (
             memory_id TEXT PRIMARY KEY REFERENCES reedy_memory(id) ON DELETE CASCADE,
             embedding vector32(${dim})
           )`,
        ]);
        return;
      }
      const m = existing[0]!.sql?.match(/vector32\s*\(\s*(\d+)\s*\)/i);
      const existingDim = m ? parseInt(m[1]!, 10) : NaN;
      if (existingDim !== dim) {
        throw new Error(
          `ensureMemoryEmbeddingsTable: dim mismatch — existing table is vector32(${existingDim}), requested vector32(${dim}). ` +
            `Switching embedding models requires wipeAllData() first.`,
        );
      }
    });
  }

  /**
   * Upsert one memory row by (scope, scope_key, key). Re-writing the same
   * key replaces the prior summary and bumps updated_at. When
   * `args.embedding` is provided, the matching reedy_memory_embeddings row
   * is also upserted — caller must have called ensureMemoryEmbeddingsTable
   * with the same dim already.
   */
  async upsertMemory(args: MemoryWriteArgs): Promise<MemoryRow> {
    const id = await this.upsertMemoryRow(args);
    if (args.embedding != null) {
      if (args.embedding.length === 0) {
        throw new Error('upsertMemory: empty embedding array');
      }
      await this.upsertMemoryEmbedding(id, args.embedding);
    }
    const row = await this.getMemoryById(id);
    if (!row) throw new Error(`upsertMemory: row vanished after write (id=${id})`);
    return row;
  }

  private async upsertMemoryRow(args: MemoryWriteArgs): Promise<string> {
    const now = Date.now();
    return this.enqueue(async () => {
      const existing = await this.db.select<{ id: string }>(
        'SELECT id FROM reedy_memory WHERE scope = ? AND scope_key = ? AND key = ?',
        [args.scope, args.scopeKey, args.key],
      );
      if (existing[0]) {
        const id = existing[0].id;
        await this.db.execute(
          `UPDATE reedy_memory SET summary = ?, source_message_id = ?, updated_at = ?
             WHERE id = ?`,
          [args.summary, args.sourceMessageId ?? null, now, id],
        );
        return id;
      }
      const id = randomMemoryId();
      await this.db.execute(
        `INSERT INTO reedy_memory (id, scope, scope_key, key, summary, source_message_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, args.scope, args.scopeKey, args.key, args.summary, args.sourceMessageId ?? null, now],
      );
      return id;
    });
  }

  private async upsertMemoryEmbedding(memoryId: string, embedding: number[]): Promise<void> {
    await this.enqueue(() =>
      this.db.batch([
        `INSERT INTO reedy_memory_embeddings (memory_id, embedding)
           VALUES (${sqlQuote(memoryId)}, vector32(${sqlQuote(serializeVector(embedding))}))
         ON CONFLICT(memory_id) DO UPDATE SET embedding = excluded.embedding`,
      ]),
    );
  }

  async getMemory(scope: MemoryScope, scopeKey: string, key: string): Promise<MemoryRow | null> {
    const rows = await this.db.select<MemoryRowSql>(
      'SELECT * FROM reedy_memory WHERE scope = ? AND scope_key = ? AND key = ?',
      [scope, scopeKey, key],
    );
    return rows[0] ? toMemoryRow(rows[0]) : null;
  }

  async deleteMemory(scope: MemoryScope, scopeKey: string, key: string): Promise<boolean> {
    return this.enqueue(async () => {
      const matched = await this.db.select<{ id: string }>(
        'SELECT id FROM reedy_memory WHERE scope = ? AND scope_key = ? AND key = ?',
        [scope, scopeKey, key],
      );
      if (matched.length === 0) return false;
      const id = matched[0]!.id;
      // We can't rely on PRAGMA foreign_keys = ON in callers' connections,
      // so explicitly drop the embedding row first when the table exists.
      const hasEmbTable = await this.db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='reedy_memory_embeddings'",
      );
      if (hasEmbTable.length > 0) {
        await this.db.execute('DELETE FROM reedy_memory_embeddings WHERE memory_id = ?', [id]);
      }
      await this.db.execute('DELETE FROM reedy_memory WHERE id = ?', [id]);
      return true;
    });
  }

  async listMemories(scope: MemoryScope, scopeKey: string, limit: number): Promise<MemoryRow[]> {
    if (limit <= 0) return [];
    const rows = await this.db.select<MemoryRowSql>(
      `SELECT * FROM reedy_memory
        WHERE scope = ? AND scope_key = ?
        ORDER BY updated_at DESC
        LIMIT ?`,
      [scope, scopeKey, limit],
    );
    return rows.map(toMemoryRow);
  }

  /**
   * Hybrid memory search — vector cosine + recency. When the caller
   * provides a queryEmbedding, score = vectorDistance + recencyWeight *
   * normalizedAge; otherwise rows are returned by recency only. Both
   * components are positive distance-like terms so a lower score wins.
   */
  async searchMemories(args: MemorySearchArgs): Promise<ScoredMemoryRow[]> {
    const limit = Math.max(0, args.limit);
    if (limit === 0) return [];
    const recencyWeight = args.recencyWeight ?? 0.1;
    const now = Date.now();

    if (args.queryEmbedding && args.queryEmbedding.length > 0) {
      // Pull a slightly wider pool than `limit` so the JS-side fusion has
      // candidates to work with even if the top-K-by-distance and
      // top-K-by-recency disagree.
      const fetchK = Math.max(limit, limit * 3);
      const rows = await this.db.select<MemoryRowSql & { vector_distance: number }>(
        `SELECT m.*, vector_distance_cos(e.embedding, vector32(?)) AS vector_distance
           FROM reedy_memory m
           JOIN reedy_memory_embeddings e ON e.memory_id = m.id
          WHERE m.scope = ? AND m.scope_key = ?
          ORDER BY vector_distance ASC
          LIMIT ?`,
        [serializeVector(args.queryEmbedding), args.scope, args.scopeKey, fetchK],
      );
      const maxAge = Math.max(1, ...rows.map((r) => Math.max(0, now - r.updated_at)));
      const scored = rows.map((r) => {
        const distance = Number.isFinite(r.vector_distance) ? r.vector_distance : 1;
        const ageNorm = (now - r.updated_at) / maxAge; // 0 = newest, 1 = oldest in pool
        return {
          ...toMemoryRow(r),
          score: distance + recencyWeight * ageNorm,
          vectorDistance: distance,
        } as ScoredMemoryRow;
      });
      return scored.sort((a, b) => a.score - b.score).slice(0, limit);
    }

    const rows = await this.db.select<MemoryRowSql>(
      `SELECT * FROM reedy_memory
        WHERE scope = ? AND scope_key = ?
        ORDER BY updated_at DESC
        LIMIT ?`,
      [args.scope, args.scopeKey, limit],
    );
    return rows.map(
      (r): ScoredMemoryRow => ({
        ...toMemoryRow(r),
        // Recency-only score: 0 for the newest, growing with age.
        score: Math.max(0, (now - r.updated_at) / 1000),
        vectorDistance: null,
      }),
    );
  }

  private async getMemoryById(id: string): Promise<MemoryRow | null> {
    const rows = await this.db.select<MemoryRowSql>('SELECT * FROM reedy_memory WHERE id = ?', [
      id,
    ]);
    return rows[0] ? toMemoryRow(rows[0]) : null;
  }

  // ---------------------------------------------------------------------------
  // hybrid search (brute-force cosine + Tantivy FTS + RRF)
  // ---------------------------------------------------------------------------

  async hybridSearch(args: {
    bookHash: string;
    queryText: string;
    queryEmbedding: number[];
    k: number;
    spoilerBoundPosition?: number;
  }): Promise<ScoredChunk[]> {
    const { bookHash, queryText, queryEmbedding, k, spoilerBoundPosition } = args;
    if (k <= 0) return [];

    const spoilerClause = spoilerBoundPosition !== undefined ? ' AND c.position_index <= ?' : '';
    const spoilerParam: unknown[] =
      spoilerBoundPosition !== undefined ? [spoilerBoundPosition] : [];

    // Over-fetch from each path so a chunk surfaced by one path still has a
    // chance to gain RRF mass from the other. Standard hybrid-search pattern.
    const fetchK = Math.max(k, k * RRF_FETCH_MULTIPLIER);

    // Vector path — brute-force cosine. Turso has no native vector index
    // module so this is O(n) per book; sub-ms at MVP corpus sizes (see
    // bench/vector-retrieval.bench.ts).
    const vectorRows = await this.db.select<ScoredChunkRowSql>(
      `SELECT c.id, c.book_hash, c.section_index, c.chapter_title,
              c.start_cfi, c.end_cfi, c.position_index, c.text, c.token_count,
              vector_distance_cos(e.embedding, vector32(?)) AS metric
         FROM reedy_book_chunk_embeddings e
         JOIN reedy_book_chunks c ON c.id = e.chunk_id
        WHERE e.book_hash = ?${spoilerClause}
        ORDER BY metric ASC
        LIMIT ?`,
      [serializeVector(queryEmbedding), bookHash, ...spoilerParam, fetchK],
    );

    // FTS path — Tantivy BM25 over the chunks.text column.
    let ftsRows: ScoredChunkRowSql[] = [];
    if (queryText.trim().length > 0) {
      try {
        ftsRows = await this.db.select<ScoredChunkRowSql>(
          `SELECT c.id, c.book_hash, c.section_index, c.chapter_title,
                  c.start_cfi, c.end_cfi, c.position_index, c.text, c.token_count,
                  fts_score(c.text, ?) AS metric
             FROM reedy_book_chunks c
            WHERE fts_match(c.text, ?) AND c.book_hash = ?${spoilerClause}
            ORDER BY metric DESC
            LIMIT ?`,
          [queryText, queryText, bookHash, ...spoilerParam, fetchK],
        );
      } catch {
        // FTS index may legitimately be empty (no chunks yet) or the query
        // may be malformed for Tantivy. The vector path is the primary
        // signal; FTS is purely a lexical booster.
        ftsRows = [];
      }
    }

    return reciprocalRankFusion(vectorRows, ftsRows, k);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface ScoredChunkRowSql {
  id: string;
  book_hash: string;
  section_index: number;
  chapter_title: string | null;
  start_cfi: string;
  end_cfi: string;
  position_index: number;
  text: string;
  token_count: number;
  metric: number;
  [key: string]: unknown;
}

function rowToChunk(row: ScoredChunkRowSql): Omit<ScoredChunk, 'score' | 'vectorRank' | 'ftsRank'> {
  return {
    id: row.id,
    bookHash: row.book_hash,
    sectionIndex: row.section_index,
    chapterTitle: row.chapter_title,
    startCfi: row.start_cfi,
    endCfi: row.end_cfi,
    positionIndex: row.position_index,
    text: row.text,
    tokenCount: row.token_count,
  };
}

// RRF constant per the Cormack/Clarke/Buettcher paper; dampens single-path
// dominance so a chunk surfaced by both lists outranks a chunk near the top
// of only one list.
const RRF_K = 60;
// Per-path over-fetch multiplier so a chunk that won on FTS but tied on
// vector (or vice-versa) still gets a vector rank contributing to its
// RRF score. Standard 3-5× hybrid-search rule of thumb.
const RRF_FETCH_MULTIPLIER = 3;

function reciprocalRankFusion(
  vectorRows: ScoredChunkRowSql[],
  ftsRows: ScoredChunkRowSql[],
  topK: number,
): ScoredChunk[] {
  const merged = new Map<string, ScoredChunk>();
  for (let i = 0; i < vectorRows.length; i++) {
    const row = vectorRows[i]!;
    const rank = i + 1;
    merged.set(row.id, {
      ...rowToChunk(row),
      score: 1 / (RRF_K + rank),
      vectorRank: rank,
      ftsRank: null,
    });
  }
  for (let i = 0; i < ftsRows.length; i++) {
    const row = ftsRows[i]!;
    const rank = i + 1;
    const existing = merged.get(row.id);
    if (existing) {
      existing.score += 1 / (RRF_K + rank);
      existing.ftsRank = rank;
    } else {
      merged.set(row.id, {
        ...rowToChunk(row),
        score: 1 / (RRF_K + rank),
        vectorRank: null,
        ftsRank: rank,
      });
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}

function serializeVector(v: number[]): string {
  return JSON.stringify(v);
}

function sqlQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function sqlQuoteNullable(s: string | null): string {
  return s === null ? 'NULL' : sqlQuote(s);
}

// ---------------------------------------------------------------------------
// memory helpers
// ---------------------------------------------------------------------------

interface MemoryRowSql {
  id: string;
  scope: string;
  scope_key: string;
  key: string;
  summary: string;
  source_message_id: string | null;
  updated_at: number;
  [key: string]: unknown;
}

function toMemoryRow(row: MemoryRowSql): MemoryRow {
  return {
    id: row.id,
    scope: row.scope as MemoryScope,
    scopeKey: row.scope_key,
    key: row.key,
    summary: row.summary,
    sourceMessageId: row.source_message_id,
    updatedAt: row.updated_at,
  };
}

function randomMemoryId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `mem-${crypto.randomUUID()}`;
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
