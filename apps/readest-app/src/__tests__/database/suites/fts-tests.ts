import { it, expect } from 'vitest';
import { DatabaseService } from '@/types/database';

/**
 * Shared full-text search test cases for Turso's native FTS (Tantivy-based).
 * Call this inside a describe() block after setting up a DatabaseService instance
 * opened with { experimental: ['index_method'] }.
 *
 * API reference (turso v0.5):
 *   - CREATE INDEX ... USING fts (columns) [WITH (tokenizer=..., weights=...)]
 *   - fts_match(col1, col2, ..., query)  — boolean filter
 *   - fts_score(col1, col2, ..., query)  — BM25 relevance score
 *   - fts_highlight(col, open, close, query) — wrap matched terms
 *   - OPTIMIZE INDEX idx_name
 *
 * Reference: https://turso.tech/blog/beyond-fts5
 */
export function ftsTests(getDb: () => DatabaseService) {
  let ftsProbed = false;
  let ftsSupported = false;

  /**
   * Wrapper around it() that probes FTS support on first run (lazily,
   * after beforeEach has created the db) and skips when unavailable.
   */
  function ftsIt(name: string, fn: () => Promise<void>) {
    it(name, async ({ skip }) => {
      if (!ftsProbed) {
        ftsProbed = true;
        const db = getDb();
        try {
          await db.execute('CREATE TABLE _fts_probe (id INTEGER PRIMARY KEY, t TEXT)');
          await db.execute('CREATE INDEX _fts_probe_idx ON _fts_probe USING fts (t)');
          await db.execute('DROP INDEX _fts_probe_idx');
          await db.execute('DROP TABLE _fts_probe');
          ftsSupported = true;
        } catch {
          try {
            await db.execute('DROP TABLE IF EXISTS _fts_probe');
          } catch {
            /* ignore cleanup errors */
          }
        }
      }
      if (!ftsSupported) {
        skip();
        return;
      }
      await fn();
    });
  }

  async function seedArticles(db: DatabaseService) {
    await db.execute('CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, body TEXT)');
    await db.execute('INSERT INTO articles (title, body) VALUES (?, ?)', [
      'Introduction to SQLite',
      'SQLite is a lightweight relational database engine widely used in embedded systems.',
    ]);
    await db.execute('INSERT INTO articles (title, body) VALUES (?, ?)', [
      'Understanding WAL Mode',
      'Write-Ahead Logging improves concurrency in SQLite database operations.',
    ]);
    await db.execute('INSERT INTO articles (title, body) VALUES (?, ?)', [
      'Full-Text Search Basics',
      'Full-text search allows efficient querying of large text datasets.',
    ]);
    await db.execute('INSERT INTO articles (title, body) VALUES (?, ?)', [
      'Rust and WebAssembly',
      'Rust compiles to WebAssembly for high-performance browser applications.',
    ]);
    await db.execute('CREATE INDEX idx_articles_fts ON articles USING fts (title, body)');
  }

  // ---------------------------------------------------------------------------
  // FTS index creation
  // ---------------------------------------------------------------------------

  ftsIt('creates an FTS index on a table', async () => {
    const db = getDb();
    await db.execute('CREATE TABLE docs (id INTEGER PRIMARY KEY, content TEXT)');
    await db.execute('CREATE INDEX idx_docs_fts ON docs USING fts (content)');
    await db.execute('INSERT INTO docs (content) VALUES (?)', ['hello world']);
    const rows = await db.select<{ id: number; content: string }>(
      "SELECT * FROM docs WHERE fts_match(content, 'hello')",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe('hello world');
  });

  // ---------------------------------------------------------------------------
  // fts_match() — full-text filtering
  // ---------------------------------------------------------------------------

  ftsIt('fts_match() returns relevant rows', async () => {
    const db = getDb();
    await seedArticles(db);

    const rows = await db.select<{ id: number; title: string }>(
      "SELECT id, title FROM articles WHERE fts_match(title, body, 'SQLite')",
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const titles = rows.map((r) => r.title);
    expect(titles).toContain('Introduction to SQLite');
  });

  ftsIt('fts_match() returns empty result for non-matching query', async () => {
    const db = getDb();
    await seedArticles(db);

    const rows = await db.select<{ id: number }>(
      "SELECT id FROM articles WHERE fts_match(title, body, 'blockchain')",
    );
    expect(rows).toHaveLength(0);
  });

  ftsIt('fts_match() works with parameterized queries', async () => {
    const db = getDb();
    await seedArticles(db);

    const rows = await db.select<{ id: number; title: string }>(
      'SELECT id, title FROM articles WHERE fts_match(title, body, ?)',
      ['WebAssembly'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Rust and WebAssembly');
  });

  ftsIt('fts_match() on single indexed column', async () => {
    const db = getDb();
    await db.execute('CREATE TABLE tags (id INTEGER PRIMARY KEY, label TEXT)');
    await db.execute('INSERT INTO tags (label) VALUES (?)', ['typescript']);
    await db.execute('INSERT INTO tags (label) VALUES (?)', ['javascript']);
    await db.execute('INSERT INTO tags (label) VALUES (?)', ['python']);
    await db.execute('CREATE INDEX idx_tags_fts ON tags USING fts (label)');

    const rows = await db.select<{ id: number; label: string }>(
      "SELECT id, label FROM tags WHERE fts_match(label, 'typescript')",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe('typescript');
  });

  // ---------------------------------------------------------------------------
  // fts_score() — BM25 ranking
  // ---------------------------------------------------------------------------

  ftsIt('fts_score() returns relevance scores ordered by rank', async () => {
    const db = getDb();
    await seedArticles(db);

    const rows = await db.select<{ score: number; title: string }>(
      "SELECT fts_score(title, body, 'database') AS score, title FROM articles WHERE fts_match(title, body, 'database') ORDER BY score DESC",
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.score).toBeGreaterThan(0);
    }
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.score).toBeGreaterThanOrEqual(rows[i]!.score);
    }
  });

  ftsIt('fts_score() with multi-term query', async () => {
    const db = getDb();
    await seedArticles(db);

    const rows = await db.select<{ score: number; title: string }>(
      "SELECT fts_score(title, body, 'SQLite database') AS score, title FROM articles WHERE fts_match(title, body, 'SQLite database') ORDER BY score DESC",
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.score).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------------
  // fts_highlight() — result highlighting
  // ---------------------------------------------------------------------------

  ftsIt('fts_highlight() wraps matched terms with markers', async () => {
    const db = getDb();
    await seedArticles(db);

    const rows = await db.select<{ highlighted: string }>(
      "SELECT fts_highlight(title, '<b>', '</b>', 'SQLite') AS highlighted FROM articles WHERE fts_match(title, body, 'SQLite') LIMIT 1",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.highlighted).toContain('<b>');
    expect(rows[0]!.highlighted).toContain('</b>');
  });

  // ---------------------------------------------------------------------------
  // Column weights
  // ---------------------------------------------------------------------------

  ftsIt('FTS index with column weights affects ranking', async () => {
    const db = getDb();
    await db.execute('CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, body TEXT)');
    // "database" appears only in title of post 1, only in body of post 2
    await db.execute('INSERT INTO posts (title, body) VALUES (?, ?)', [
      'Database Internals',
      'This book covers storage engines and distributed systems.',
    ]);
    await db.execute('INSERT INTO posts (title, body) VALUES (?, ?)', [
      'Systems Programming',
      'Learn about database drivers, networking, and concurrency.',
    ]);
    await db.execute(
      "CREATE INDEX idx_posts_fts ON posts USING fts (title, body) WITH (weights = 'title=5.0,body=1.0')",
    );

    const rows = await db.select<{ score: number; title: string }>(
      "SELECT fts_score(title, body, 'database') AS score, title FROM posts WHERE fts_match(title, body, 'database') ORDER BY score DESC",
    );
    expect(rows.length).toBe(2);
    // Post with "database" in the heavily-weighted title should rank higher
    expect(rows[0]!.title).toBe('Database Internals');
  });

  // ---------------------------------------------------------------------------
  // Tokenizers
  // ---------------------------------------------------------------------------

  ftsIt('ngram tokenizer enables substring matching', async () => {
    const db = getDb();
    await db.execute('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)');
    await db.execute('INSERT INTO products (name) VALUES (?)', ['JavaScript']);
    await db.execute('INSERT INTO products (name) VALUES (?)', ['TypeScript']);
    await db.execute('INSERT INTO products (name) VALUES (?)', ['Python']);
    await db.execute(
      "CREATE INDEX idx_products_fts ON products USING fts (name) WITH (tokenizer = 'ngram')",
    );

    const rows = await db.select<{ name: string }>(
      "SELECT name FROM products WHERE fts_match(name, 'Script') ORDER BY name",
    );
    expect(rows.length).toBe(2);
    const names = rows.map((r) => r.name);
    expect(names).toContain('JavaScript');
    expect(names).toContain('TypeScript');
  });

  ftsIt('raw tokenizer performs exact matching', async () => {
    const db = getDb();
    await db.execute('CREATE TABLE tags (id INTEGER PRIMARY KEY, tag TEXT)');
    await db.execute('INSERT INTO tags (tag) VALUES (?)', ['v1.0.0']);
    await db.execute('INSERT INTO tags (tag) VALUES (?)', ['v1.0.1']);
    await db.execute('INSERT INTO tags (tag) VALUES (?)', ['v2.0.0']);
    await db.execute("CREATE INDEX idx_tags_raw ON tags USING fts (tag) WITH (tokenizer = 'raw')");

    const rows = await db.select<{ tag: string }>(
      "SELECT tag FROM tags WHERE fts_match(tag, 'v1.0.0')",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tag).toBe('v1.0.0');
  });

  // ---------------------------------------------------------------------------
  // FTS with data mutations
  // ---------------------------------------------------------------------------

  ftsIt('FTS index reflects newly inserted rows', async () => {
    const db = getDb();
    await db.execute('CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT)');
    await db.execute('CREATE INDEX idx_notes_fts ON notes USING fts (text)');

    await db.execute('INSERT INTO notes (text) VALUES (?)', ['first note about testing']);

    let rows = await db.select<{ id: number }>(
      "SELECT id FROM notes WHERE fts_match(text, 'testing')",
    );
    expect(rows).toHaveLength(1);

    await db.execute('INSERT INTO notes (text) VALUES (?)', [
      'second note about testing strategies',
    ]);

    rows = await db.select<{ id: number }>("SELECT id FROM notes WHERE fts_match(text, 'testing')");
    expect(rows).toHaveLength(2);
  });

  ftsIt('FTS index reflects deleted rows', async () => {
    const db = getDb();
    await db.execute('CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT)');
    await db.execute('CREATE INDEX idx_notes_fts ON notes USING fts (text)');
    await db.execute('INSERT INTO notes (text) VALUES (?)', ['important meeting notes']);
    await db.execute('INSERT INTO notes (text) VALUES (?)', ['grocery list items']);

    await db.execute('DELETE FROM notes WHERE id = 2');

    const rows = await db.select<{ text: string }>(
      "SELECT text FROM notes WHERE fts_match(text, 'meeting')",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toContain('meeting');

    const all = await db.select('SELECT * FROM notes');
    expect(all).toHaveLength(1);
  });

  ftsIt('FTS index reflects updated rows', async () => {
    const db = getDb();
    await db.execute('CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT)');
    await db.execute('CREATE INDEX idx_notes_fts ON notes USING fts (text)');
    await db.execute('INSERT INTO notes (text) VALUES (?)', ['old content about cats']);

    await db.execute('UPDATE notes SET text = ? WHERE id = ?', ['new content about dogs', 1]);

    const catRows = await db.select<{ id: number }>(
      "SELECT id FROM notes WHERE fts_match(text, 'cats')",
    );
    expect(catRows).toHaveLength(0);

    const dogRows = await db.select<{ id: number }>(
      "SELECT id FROM notes WHERE fts_match(text, 'dogs')",
    );
    expect(dogRows).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // OPTIMIZE INDEX
  // ---------------------------------------------------------------------------

  ftsIt('OPTIMIZE INDEX runs without error', async () => {
    const db = getDb();
    await seedArticles(db);
    await db.execute('OPTIMIZE INDEX idx_articles_fts');
  });
}
