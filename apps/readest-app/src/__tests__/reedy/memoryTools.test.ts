import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolRegistry } from '@/services/reedy/tools/ToolRegistry';
import type { ToolContext } from '@/services/reedy/tools/types';
import {
  createSearchBookMemoryTool,
  createSearchSessionMemoryTool,
  createSearchUserMemoryTool,
  createWriteBookMemoryTool,
  createWriteUserMemoryTool,
} from '@/services/reedy/tools/builtins';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DatabaseService } from '@/types/database';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';
import { MemoryService } from '@/services/reedy/memory/MemoryService';
import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';

const DIM = 4;
function unit(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0)) || 1;
  return values.map((v) => v / norm);
}
function fakeModel(): EmbeddingModel {
  return {
    id: 'fake',
    dim: DIM,
    async embed(texts) {
      // Map deterministic by text length so identical strings → same vec.
      return texts.map((t) => unit([t.length, 1, 0, 0]));
    },
  };
}
function ctxFor(): ToolContext {
  const controller = new AbortController();
  return {
    bookHash: 'bk1',
    sessionId: 's1',
    assistantMessageId: 'm1',
    signal: controller.signal,
    requestPermission: vi.fn(async () => true),
  };
}

describe('memory tools', () => {
  let svc: DatabaseService;
  let memory: MemoryService;

  beforeEach(async () => {
    svc = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
    await migrate(svc, getMigrations('reedy'));
    memory = new MemoryService(new ReedyDb(svc), fakeModel());
  });

  afterEach(async () => {
    await svc.close();
  });

  describe('writeUserMemory', () => {
    it('persists a user-scoped memory + returns the key', async () => {
      const reg = new ToolRegistry();
      reg.register(createWriteUserMemoryTool({ service: memory, scopeKey: () => 'u1' }));
      const out = (await reg.invoke(
        'writeUserMemory',
        { key: 'taste:scifi', summary: 'User loves space opera.' },
        ctxFor(),
      )) as { ok: true; key: string };
      expect(out).toEqual({ ok: true, key: 'taste:scifi' });
      const row = await memory.get('user', 'u1', 'taste:scifi');
      expect(row?.summary).toBe('User loves space opera.');
    });

    it('rejects keys that match the injection blocklist', async () => {
      const reg = new ToolRegistry();
      reg.register(createWriteUserMemoryTool({ service: memory, scopeKey: () => 'u1' }));
      for (const badKey of ['system', 'system:role', 'policy', 'INJECTION', 'override-fix']) {
        await expect(
          reg.invoke('writeUserMemory', { key: badKey, summary: 'x' }, ctxFor()),
        ).rejects.toMatchObject({ kind: 'tool_invalid_args' });
      }
    });

    it('rejects oversized summaries via the Zod schema', async () => {
      const reg = new ToolRegistry();
      reg.register(createWriteUserMemoryTool({ service: memory, scopeKey: () => 'u1' }));
      await expect(
        reg.invoke('writeUserMemory', { key: 'k', summary: 'x'.repeat(2_001) }, ctxFor()),
      ).rejects.toMatchObject({ kind: 'tool_invalid_args' });
    });

    it('rejects keys with disallowed characters', async () => {
      const reg = new ToolRegistry();
      reg.register(createWriteUserMemoryTool({ service: memory, scopeKey: () => 'u1' }));
      await expect(
        reg.invoke('writeUserMemory', { key: 'has spaces', summary: 'x' }, ctxFor()),
      ).rejects.toMatchObject({ kind: 'tool_invalid_args' });
    });

    it('passes sourceMessageId through to the service when configured', async () => {
      const reg = new ToolRegistry();
      reg.register(
        createWriteUserMemoryTool({
          service: memory,
          scopeKey: () => 'u1',
          sourceMessageId: () => 'msg-42',
        }),
      );
      await reg.invoke('writeUserMemory', { key: 'k', summary: 's' }, ctxFor());
      const row = await memory.get('user', 'u1', 'k');
      expect(row?.sourceMessageId).toBe('msg-42');
    });
  });

  describe('searchUserMemory / searchBookMemory', () => {
    it('returns memories scoped to the active user', async () => {
      await memory.write({ scope: 'user', scopeKey: 'u1', key: 'a', summary: 'A' });
      await memory.write({ scope: 'user', scopeKey: 'u2', key: 'a', summary: 'OTHER' });
      const reg = new ToolRegistry();
      reg.register(createSearchUserMemoryTool({ service: memory, scopeKey: () => 'u1' }));
      const out = (await reg.invoke('searchUserMemory', { limit: 5 }, ctxFor())) as {
        memories: Array<{ summary: string }>;
      };
      expect(out.memories.map((m) => m.summary)).toEqual(['A']);
    });

    it('book-scoped tool returns book-scope rows only', async () => {
      await memory.write({ scope: 'book', scopeKey: 'bk1', key: 'theme', summary: 'identity' });
      await memory.write({
        scope: 'user',
        scopeKey: 'bk1',
        key: 'theme',
        summary: 'should not appear',
      });
      const reg = new ToolRegistry();
      reg.register(createSearchBookMemoryTool({ service: memory, scopeKey: () => 'bk1' }));
      const out = (await reg.invoke('searchBookMemory', { limit: 5 }, ctxFor())) as {
        memories: Array<{ summary: string }>;
      };
      expect(out.memories.map((m) => m.summary)).toEqual(['identity']);
    });
  });

  describe('searchSessionMemory', () => {
    it('is search-only and returns session-scope rows', async () => {
      await memory.write({ scope: 'session', scopeKey: 's1', key: 'k', summary: 'session note' });
      const reg = new ToolRegistry();
      reg.register(createSearchSessionMemoryTool({ service: memory, scopeKey: () => 's1' }));
      const out = (await reg.invoke('searchSessionMemory', { limit: 5 }, ctxFor())) as {
        memories: Array<{ summary: string }>;
      };
      expect(out.memories[0]!.summary).toBe('session note');
    });
  });

  describe('writeBookMemory parallel serialization', () => {
    it('serializes concurrent writes (parallelSafe=false) so the same key doesn’t race', async () => {
      let active = 0;
      let maxActive = 0;
      // Wrap memory.write to count concurrency.
      const original = memory.write.bind(memory);
      memory.write = async (args) => {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          return await original(args);
        } finally {
          active--;
        }
      };
      const reg = new ToolRegistry();
      reg.register(createWriteBookMemoryTool({ service: memory, scopeKey: () => 'bk1' }));
      const ctx = ctxFor();
      await Promise.all([
        reg.invoke('writeBookMemory', { key: 'a', summary: 'one' }, ctx),
        reg.invoke('writeBookMemory', { key: 'b', summary: 'two' }, ctx),
        reg.invoke('writeBookMemory', { key: 'c', summary: 'three' }, ctx),
      ]);
      expect(maxActive).toBe(1);
    });
  });
});
