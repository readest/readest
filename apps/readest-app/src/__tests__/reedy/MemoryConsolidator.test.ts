import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatModel } from '@/services/reedy/models/ChatModel';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DatabaseService } from '@/types/database';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { ReedyDb } from '@/services/reedy/db/ReedyDb';
import { MemoryService } from '@/services/reedy/memory/MemoryService';
import type { EmbeddingModel } from '@/services/reedy/models/EmbeddingModel';
import type {
  ConsolidatorMessage,
  MemoryConsolidatorOptions,
} from '@/services/reedy/memory/MemoryConsolidator';

const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: generateTextMock,
  };
});

const { MemoryConsolidator } = await import('@/services/reedy/memory/MemoryConsolidator');

function unit(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0)) || 1;
  return values.map((v) => v / norm);
}

function fakeChatModel(): ChatModel {
  return {
    id: 'fake-chat',
    contextWindow: 8_192,
    reservedOutput: 1_024,
    supportsTools: false,
    getLanguageModel: () =>
      ({ __mock: 'lm' }) as unknown as ReturnType<ChatModel['getLanguageModel']>,
  };
}

function fakeEmbeddingModel(): EmbeddingModel {
  return {
    id: 'fake-embed',
    dim: 4,
    async embed(texts) {
      return texts.map((t) => unit([t.length, 1, 0, 0]));
    },
  };
}

function msg(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  createdAt = Date.now(),
): ConsolidatorMessage {
  return { id, role, content, createdAt };
}

function manyMessages(n: number): ConsolidatorMessage[] {
  return Array.from({ length: n }, (_, i) =>
    msg(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', `turn ${i} content`),
  );
}

describe('MemoryConsolidator', () => {
  let svc: DatabaseService;
  let memory: MemoryService;

  beforeEach(async () => {
    generateTextMock.mockReset();
    svc = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
    await migrate(svc, getMigrations('reedy'));
    memory = new MemoryService(new ReedyDb(svc), fakeEmbeddingModel());
  });

  afterEach(async () => {
    await svc.close();
  });

  function makeConsolidator(overrides: Partial<MemoryConsolidatorOptions> = {}) {
    return new MemoryConsolidator({
      model: fakeChatModel(),
      memory,
      bookHash: 'bk1',
      userId: 'u1',
      ...overrides,
    });
  }

  describe('threshold', () => {
    it('returns [] without calling the model when input is under threshold', async () => {
      const out = await makeConsolidator({ threshold: 6 }).consolidate(manyMessages(3));
      expect(out).toEqual([]);
      expect(generateTextMock).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('parses the model JSON and writes one row per memory via MemoryService', async () => {
      generateTextMock.mockResolvedValue({
        text: JSON.stringify([
          { scope: 'book', key: 'theme:identity', summary: 'Recurring identity motif.' },
          { scope: 'user', key: 'taste:scifi', summary: 'User likes hard sci-fi.' },
        ]),
      });

      const out = await makeConsolidator().consolidate(manyMessages(6));

      expect(out).toHaveLength(2);
      const book = await memory.get('book', 'bk1', 'theme:identity');
      const user = await memory.get('user', 'u1', 'taste:scifi');
      expect(book?.summary).toBe('Recurring identity motif.');
      expect(user?.summary).toBe('User likes hard sci-fi.');
      // Source message id is the last message's id.
      expect(book?.sourceMessageId).toBe('m5');
    });

    it('enforces maxPerRun even when the model proposes more', async () => {
      generateTextMock.mockResolvedValue({
        text: JSON.stringify([
          { scope: 'book', key: 'a', summary: 'A' },
          { scope: 'book', key: 'b', summary: 'B' },
          { scope: 'book', key: 'c', summary: 'C' },
          { scope: 'book', key: 'd', summary: 'D' },
          { scope: 'book', key: 'e', summary: 'E' },
        ]),
      });
      const out = await makeConsolidator({ maxPerRun: 2 }).consolidate(manyMessages(10));
      expect(out.map((m) => m.key)).toEqual(['a', 'b']);
    });

    it('strips a ```json code fence if the model wrapped output despite instructions', async () => {
      generateTextMock.mockResolvedValue({
        text: '```json\n[{"scope":"user","key":"k","summary":"S"}]\n```',
      });
      const out = await makeConsolidator().consolidate(manyMessages(6));
      expect(out).toHaveLength(1);
      expect(out[0]!.key).toBe('k');
    });
  });

  describe('robustness', () => {
    it('drops malformed JSON output via onError; returns []; no writes', async () => {
      const onError = vi.fn();
      generateTextMock.mockResolvedValue({ text: 'not actually json' });
      const out = await makeConsolidator({ onError }).consolidate(manyMessages(6));
      expect(out).toEqual([]);
      expect(onError).toHaveBeenCalledOnce();
      const all = await memory.list('user', 'u1', 10);
      expect(all).toHaveLength(0);
    });

    it('drops rows whose key matches the policy-injection blocklist', async () => {
      const onError = vi.fn();
      generateTextMock.mockResolvedValue({
        text: JSON.stringify([
          { scope: 'user', key: 'system:override', summary: 'should not land' },
        ]),
      });
      const out = await makeConsolidator({ onError }).consolidate(manyMessages(6));
      expect(out).toEqual([]);
      expect(onError).toHaveBeenCalledOnce();
    });

    it('drops a book-scoped memory when no bookHash was configured', async () => {
      const onError = vi.fn();
      generateTextMock.mockResolvedValue({
        text: JSON.stringify([{ scope: 'book', key: 'k', summary: 's' }]),
      });
      const out = await makeConsolidator({ bookHash: undefined, onError }).consolidate(
        manyMessages(6),
      );
      expect(out).toEqual([]);
      expect(onError).toHaveBeenCalledOnce();
      const written = await memory.list('book', 'bk1', 10);
      expect(written).toHaveLength(0);
    });

    it('forwards model errors to onError and returns [] (never throws)', async () => {
      const onError = vi.fn();
      generateTextMock.mockRejectedValue(new Error('provider 503'));
      const out = await makeConsolidator({ onError }).consolidate(manyMessages(6));
      expect(out).toEqual([]);
      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    });

    it('continues writing the remaining rows when one write throws', async () => {
      const onError = vi.fn();
      generateTextMock.mockResolvedValue({
        text: JSON.stringify([
          { scope: 'user', key: 'good-one', summary: 'will land' },
          { scope: 'book', key: 'second-one', summary: 'also lands' },
        ]),
      });
      // Make the first write throw.
      const original = memory.write.bind(memory);
      let calls = 0;
      memory.write = async (args) => {
        calls++;
        if (calls === 1) throw new Error('disk full');
        return original(args);
      };
      const out = await makeConsolidator({ onError }).consolidate(manyMessages(6));
      expect(out).toHaveLength(1);
      expect(out[0]!.key).toBe('second-one');
      expect(onError).toHaveBeenCalledOnce();
    });
  });

  describe('prompt wiring', () => {
    it('renders {{MAX_PER_RUN}} into the system prompt', async () => {
      generateTextMock.mockResolvedValue({ text: '[]' });
      await makeConsolidator({ maxPerRun: 4 }).consolidate(manyMessages(6));
      const call = generateTextMock.mock.calls[0]![0] as { system: string };
      expect(call.system).toContain('Write at most 4 rows');
    });

    it('concatenates message contents into the user message in role-prefixed form', async () => {
      generateTextMock.mockResolvedValue({ text: '[]' });
      await makeConsolidator().consolidate([
        msg('m0', 'user', 'Tell me about Alice'),
        msg('m1', 'assistant', 'Alice falls down a rabbit hole.'),
        msg('m2', 'user', 'Who else?'),
        msg('m3', 'assistant', 'The Cheshire Cat appears.'),
        msg('m4', 'user', 'Any themes?'),
        msg('m5', 'assistant', 'Identity, curiosity, growth.'),
      ]);
      const call = generateTextMock.mock.calls[0]![0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const userContent = call.messages.find((m) => m.role === 'user')!.content;
      expect(userContent).toContain('[user] Tell me about Alice');
      expect(userContent).toContain('[assistant] Alice falls down a rabbit hole');
      expect(userContent).toContain('[assistant] Identity, curiosity, growth.');
    });
  });
});
