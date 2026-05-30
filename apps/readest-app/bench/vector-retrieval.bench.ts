import { connect } from '@tursodatabase/database';
import { avg, randomUnitVectorJson, type Bench, type BenchResult } from './lib.ts';

/**
 * Vector-retrieval brute-force kNN benchmark.
 *
 * Reedy MVP retrieval (see plan §M1.5) issues:
 *
 *   SELECT id, vector_distance_cos(embedding, vector32(?)) AS d
 *     FROM reedy_book_chunk_embeddings
 *    WHERE book_hash = ?
 *    ORDER BY d ASC LIMIT k
 *
 * Why this matters: Turso has no native vector index module
 * (`libsql_vector_idx` / `vector_top_k` don't exist — confirmed against
 * @tursodatabase/database@0.6.0-pre.28 and acknowledged upstream:
 * tursodatabase/turso#832 closed not-planned, #3778 proposed brute-force-first
 * which shipped at commit 1aba105df4f). The brute-force path with
 * SIMD-accelerated `vector_distance_cos` is what we ship; this bench tracks
 * its per-query latency at realistic MVP corpus sizes.
 *
 * Run it after upgrading @tursodatabase/database, after touching
 * BookRetriever's SQL shape, or when evaluating an architecture change
 * (ANN extension, quantization, engine swap).
 */
export default {
  name: 'vector-retrieval',
  description: 'Brute-force per-book kNN over vector32 embeddings filtered by book_hash.',

  async run(): Promise<BenchResult[]> {
    const db = await connect(':memory:', {});
    await db.exec(
      'CREATE TABLE c (id INTEGER PRIMARY KEY, book_hash TEXT NOT NULL, embedding BLOB)',
    );
    await db.exec('CREATE INDEX idx_c_book ON c(book_hash)');

    // (dim, chunks-per-book) matrix. Two books per scenario so the WHERE filter
    // does real work; we measure only the active-book query.
    const scenarios = [
      { dim: 384, chunks: 400 }, // small book, light embedding (e5-small-v2)
      { dim: 768, chunks: 400 }, // typical novel @ nomic-embed-text
      { dim: 768, chunks: 2000 }, // long novel
      { dim: 768, chunks: 10000 }, // multi-volume / textbook
      { dim: 1536, chunks: 400 }, // text-embedding-3-small
    ];

    const results: BenchResult[] = [];

    for (const { dim, chunks } of scenarios) {
      await db.exec('DELETE FROM c');

      const insertA = await db.prepare(
        "INSERT INTO c (book_hash, embedding) VALUES ('book_a', vector32(?))",
      );
      for (let i = 0; i < chunks; i++) await insertA.run(randomUnitVectorJson(dim));

      const insertB = await db.prepare(
        "INSERT INTO c (book_hash, embedding) VALUES ('book_b', vector32(?))",
      );
      for (let i = 0; i < chunks; i++) await insertB.run(randomUnitVectorJson(dim));

      const query = randomUnitVectorJson(dim);
      // Embed the query vector literally so SIMD has the same memory layout
      // every call (mirrors the BookRetriever code path which serializes the
      // query embedding inline at the value-binding position).
      const sql = `
        SELECT id, vector_distance_cos(embedding, vector32('${query}')) AS d
          FROM c
         WHERE book_hash = ?
         ORDER BY d ASC
         LIMIT 5
      `;
      const stmt = await db.prepare(sql);

      const ms = await avg(() => stmt.all('book_a'), 20);
      results.push({
        scenario: `${chunks} chunks × ${dim} dim`,
        unit: 'ms',
        value: ms,
        meta: { chunks, dim, usPerChunk: ((ms * 1000) / chunks).toFixed(2) },
      });
    }

    await db.close();
    return results;
  },
} satisfies Bench;
