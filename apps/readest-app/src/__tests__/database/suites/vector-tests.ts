import { it, expect } from 'vitest';
import { DatabaseService } from '@/types/database';

/**
 * Shared vector search test cases for Turso's built-in vector functions.
 * Call this inside a describe() block after setting up a DatabaseService instance.
 *
 * Vector support is available in both the native (Node.js) and WASM backends.
 *
 * API reference:
 *   - vector32 / vector / vector64 / vector8 / vector1bit — constructors
 *   - vector_distance_cos(a, b) — cosine distance
 *   - vector_distance_l2(a, b)  — Euclidean distance
 *   - vector_distance_dot(a, b) — negative dot product
 *   - vector_extract(blob)      — BLOB → JSON text
 *   - vector_concat(a, b)       — merge vectors
 *   - vector_slice(blob, s, e)  — extract sub-vector
 *
 * Reference: https://docs.turso.tech/sql-reference/functions/vector
 */
export function vectorTests(getDb: () => DatabaseService) {
  // ---------------------------------------------------------------------------
  // Vector creation & storage
  // ---------------------------------------------------------------------------

  it('stores and retrieves vector32 embeddings', async () => {
    const db = getDb();
    await db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, embedding BLOB)');
    await db.execute('INSERT INTO items (embedding) VALUES (vector32(?))', [
      '[1.0, 2.0, 3.0, 4.0]',
    ]);

    const rows = await db.select<{ id: number; json: string }>(
      'SELECT id, vector_extract(embedding) AS json FROM items',
    );
    expect(rows).toHaveLength(1);
    const parsed: number[] = JSON.parse(rows[0]!.json);
    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toBeCloseTo(1.0);
    expect(parsed[3]).toBeCloseTo(4.0);
  });

  it('vector() is an alias for vector32()', async () => {
    const db = getDb();
    const rows = await db.select<{ eq: number }>(
      "SELECT vector_extract(vector('[1,2,3]')) = vector_extract(vector32('[1,2,3]')) AS eq",
    );
    expect(rows[0]!.eq).toBe(1);
  });

  it('stores and retrieves vector64 embeddings', async () => {
    const db = getDb();
    await db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, embedding BLOB)');
    await db.execute('INSERT INTO items (embedding) VALUES (vector64(?))', ['[1.0, 2.0, 3.0]']);

    const rows = await db.select<{ json: string }>(
      'SELECT vector_extract(embedding) AS json FROM items',
    );
    const parsed: number[] = JSON.parse(rows[0]!.json);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toBeCloseTo(1.0);
  });

  // ---------------------------------------------------------------------------
  // Distance functions
  // ---------------------------------------------------------------------------

  it('vector_distance_cos() returns 0 for identical vectors', async () => {
    const db = getDb();
    const rows = await db.select<{ d: number }>(
      "SELECT vector_distance_cos(vector32('[1,2,3]'), vector32('[1,2,3]')) AS d",
    );
    expect(rows[0]!.d).toBeCloseTo(0, 5);
  });

  it('vector_distance_cos() returns higher distance for dissimilar vectors', async () => {
    const db = getDb();
    const rows = await db.select<{ d_similar: number; d_different: number }>(
      `SELECT
        vector_distance_cos(vector32('[1,0,0]'), vector32('[0.9,0.1,0]')) AS d_similar,
        vector_distance_cos(vector32('[1,0,0]'), vector32('[0,0,1]')) AS d_different`,
    );
    expect(rows[0]!.d_similar).toBeLessThan(rows[0]!.d_different);
  });

  it('vector_distance_l2() returns 0 for identical vectors', async () => {
    const db = getDb();
    const rows = await db.select<{ d: number }>(
      "SELECT vector_distance_l2(vector32('[3,4]'), vector32('[3,4]')) AS d",
    );
    expect(rows[0]!.d).toBeCloseTo(0, 5);
  });

  it('vector_distance_l2() computes correct Euclidean distance', async () => {
    const db = getDb();
    // distance between [0,0] and [3,4] should be 5
    const rows = await db.select<{ d: number }>(
      "SELECT vector_distance_l2(vector32('[0,0]'), vector32('[3,4]')) AS d",
    );
    expect(rows[0]!.d).toBeCloseTo(5.0, 4);
  });

  it('vector_distance_dot() returns more negative for similar vectors', async () => {
    const db = getDb();
    const rows = await db.select<{ d_similar: number; d_different: number }>(
      `SELECT
        vector_distance_dot(vector32('[1,1,1]'), vector32('[1,1,1]')) AS d_similar,
        vector_distance_dot(vector32('[1,1,1]'), vector32('[-1,-1,-1]')) AS d_different`,
    );
    // dot returns negative dot product; more negative = more similar
    expect(rows[0]!.d_similar).toBeLessThan(rows[0]!.d_different);
  });

  // ---------------------------------------------------------------------------
  // Similarity search pattern
  // ---------------------------------------------------------------------------

  it('finds nearest neighbors by cosine distance', async () => {
    const db = getDb();
    await db.execute('CREATE TABLE docs (id INTEGER PRIMARY KEY, title TEXT, embedding BLOB)');
    await db.execute("INSERT INTO docs (title, embedding) VALUES (?, vector32('[1,0,0,0]'))", [
      'Doc A',
    ]);
    await db.execute("INSERT INTO docs (title, embedding) VALUES (?, vector32('[0,1,0,0]'))", [
      'Doc B',
    ]);
    await db.execute(
      "INSERT INTO docs (title, embedding) VALUES (?, vector32('[0.95,0.05,0,0]'))",
      ['Doc C'],
    );

    // Query vector is close to [1,0,0,0]
    const rows = await db.select<{ title: string; distance: number }>(
      `SELECT title,
              vector_distance_cos(embedding, vector32('[1,0,0,0]')) AS distance
       FROM docs ORDER BY distance ASC LIMIT 2`,
    );
    expect(rows).toHaveLength(2);
    // Doc A (exact match) and Doc C (very close) should be the nearest
    expect(rows[0]!.title).toBe('Doc A');
    expect(rows[1]!.title).toBe('Doc C');
    expect(rows[0]!.distance).toBeCloseTo(0, 4);
    expect(rows[0]!.distance).toBeLessThan(rows[1]!.distance);
  });

  it('finds nearest neighbors by L2 distance', async () => {
    const db = getDb();
    await db.execute('CREATE TABLE points (id INTEGER PRIMARY KEY, pos BLOB)');
    await db.execute("INSERT INTO points (pos) VALUES (vector32('[0,0]'))");
    await db.execute("INSERT INTO points (pos) VALUES (vector32('[3,4]'))");
    await db.execute("INSERT INTO points (pos) VALUES (vector32('[1,1]'))");

    const rows = await db.select<{ id: number; dist: number }>(
      `SELECT id, vector_distance_l2(pos, vector32('[0,0]')) AS dist
       FROM points ORDER BY dist ASC`,
    );
    expect(rows).toHaveLength(3);
    // Origin first, then [1,1] (dist ~1.41), then [3,4] (dist 5)
    expect(rows[0]!.dist).toBeCloseTo(0, 4);
    expect(rows[1]!.dist).toBeCloseTo(Math.sqrt(2), 4);
    expect(rows[2]!.dist).toBeCloseTo(5, 4);
  });

  // ---------------------------------------------------------------------------
  // vector_extract()
  // ---------------------------------------------------------------------------

  it('vector_extract() converts BLOB back to JSON', async () => {
    const db = getDb();
    const rows = await db.select<{ json: string }>(
      "SELECT vector_extract(vector32('[10.5, 20.5, 30.5]')) AS json",
    );
    const parsed: number[] = JSON.parse(rows[0]!.json);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toBeCloseTo(10.5);
    expect(parsed[2]).toBeCloseTo(30.5);
  });

  // ---------------------------------------------------------------------------
  // vector_slice()
  // ---------------------------------------------------------------------------

  it('vector_slice() extracts a sub-vector', async () => {
    const db = getDb();
    const rows = await db.select<{ json: string }>(
      "SELECT vector_extract(vector_slice(vector32('[10,20,30,40,50]'), 1, 4)) AS json",
    );
    const parsed: number[] = JSON.parse(rows[0]!.json);
    // zero-based: elements at index 1,2,3
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toBeCloseTo(20);
    expect(parsed[1]).toBeCloseTo(30);
    expect(parsed[2]).toBeCloseTo(40);
  });

  // ---------------------------------------------------------------------------
  // vector_concat()
  // ---------------------------------------------------------------------------

  it('vector_concat() merges two vectors', async () => {
    const db = getDb();
    const rows = await db.select<{ json: string }>(
      "SELECT vector_extract(vector_concat(vector32('[1,2]'), vector32('[3,4]'))) AS json",
    );
    const parsed: number[] = JSON.parse(rows[0]!.json);
    expect(parsed).toHaveLength(4);
    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.closeTo(1),
        expect.closeTo(2),
        expect.closeTo(3),
        expect.closeTo(4),
      ]),
    );
  });

  // ---------------------------------------------------------------------------
  // Mixed precision
  // ---------------------------------------------------------------------------

  it('vector_distance_cos() works with vector64', async () => {
    const db = getDb();
    const rows = await db.select<{ d: number }>(
      "SELECT vector_distance_cos(vector64('[1,0,0]'), vector64('[1,0,0]')) AS d",
    );
    expect(rows[0]!.d).toBeCloseTo(0, 5);
  });

  it('vector_distance_l2() works with vector64', async () => {
    const db = getDb();
    const rows = await db.select<{ d: number }>(
      "SELECT vector_distance_l2(vector64('[0,0]'), vector64('[3,4]')) AS d",
    );
    expect(rows[0]!.d).toBeCloseTo(5.0, 4);
  });
}
