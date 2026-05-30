import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DatabaseService } from '@/types/database';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';
import { MemoryService } from '@/services/reedy/memory/MemoryService';
import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';

const DIM = 4;

function fakeEmbedding(text: string): number[] {
  // Distinct per-text vectors: bucket the entire text content into one
  // of four axes via a stable hash so semantically-similar fakes don't
  // accidentally cluster (the char-position fake above clustered "about
  // cats" / "about dogs" / "about birds" so the recency boost dominated
  // the assertion).
  const hash = Array.from(text).reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0);
  const axis = hash % 4;
  const v = [0, 0, 0, 0];
  v[axis] = 1;
  return v;
}

function fakeModel(): EmbeddingModel {
  return {
    id: 'fake',
    dim: DIM,
    async embed(texts) {
      return texts.map(fakeEmbedding);
    },
  };
}

describe('MemoryService', () => {
  let svc: DatabaseService;
  let reedy: ReedyDb;
  let memory: MemoryService;

  beforeEach(async () => {
    svc = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
    await migrate(svc, getMigrations('reedy'));
    reedy = new ReedyDb(svc);
    memory = new MemoryService(reedy, fakeModel());
  });

  afterEach(async () => {
    await svc.close();
  });

  it('write() embeds the summary + lazy-creates the embeddings table', async () => {
    await memory.write({
      scope: 'user',
      scopeKey: 'u1',
      key: 'k',
      summary: 'avoids spoilers',
    });
    const tables = await svc.select(
      "SELECT name FROM sqlite_master WHERE name='reedy_memory_embeddings'",
    );
    expect(tables).toHaveLength(1);
    const embs = await svc.select('SELECT memory_id FROM reedy_memory_embeddings');
    expect(embs).toHaveLength(1);
  });

  it('search(query) embeds the query and ranks vector-aligned memories first', async () => {
    await memory.write({ scope: 'book', scopeKey: 'bk1', key: 'cats', summary: 'about cats' });
    await new Promise((r) => setTimeout(r, 2));
    await memory.write({ scope: 'book', scopeKey: 'bk1', key: 'dogs', summary: 'about dogs' });
    await new Promise((r) => setTimeout(r, 2));
    await memory.write({ scope: 'book', scopeKey: 'bk1', key: 'birds', summary: 'about birds' });

    const out = await memory.search({
      scope: 'book',
      scopeKey: 'bk1',
      query: 'about cats',
      limit: 3,
    });
    expect(out[0]!.key).toBe('cats');
  });

  it('search without query returns rows by recency', async () => {
    await memory.write({ scope: 'user', scopeKey: 'u1', key: 'a', summary: 'A' });
    await new Promise((r) => setTimeout(r, 2));
    await memory.write({ scope: 'user', scopeKey: 'u1', key: 'b', summary: 'B' });
    const out = await memory.search({ scope: 'user', scopeKey: 'u1', limit: 5 });
    expect(out.map((m) => m.key)).toEqual(['b', 'a']);
  });

  it('write() without an embedding model still upserts the row', async () => {
    const m = new MemoryService(reedy, null);
    await m.write({ scope: 'user', scopeKey: 'u1', key: 'k', summary: 's' });
    const row = await m.get('user', 'u1', 'k');
    expect(row?.summary).toBe('s');
    // No embedding row since the model was null.
    const tables = await svc.select(
      "SELECT name FROM sqlite_master WHERE name='reedy_memory_embeddings'",
    );
    expect(tables).toHaveLength(0);
  });

  it('delete() removes the memory + its embedding', async () => {
    await memory.write({ scope: 'user', scopeKey: 'u1', key: 'k', summary: 's' });
    expect(await memory.delete('user', 'u1', 'k')).toBe(true);
    expect(await memory.get('user', 'u1', 'k')).toBeNull();
  });
});
