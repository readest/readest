import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tool } from 'ai';
import type { RetrievalBackend } from '@/services/ai/adapters/retrievalBackend';
import { ReedySourceStore } from '@/services/ai/adapters/reedySourceStore';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings, ScoredChunk } from '@/services/ai/types';

// streamText is mocked so the test runs without an LLM provider — we assert
// what arguments the adapter PASSES, not what the model produces.
const streamTextMock = vi.fn();
const stepCountIsMock = vi.fn((n: number) => ({ __stepCountIs: n }));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: streamTextMock,
    stepCountIs: stepCountIsMock,
  };
});

// Provider must return a model object that streamText accepts. Since
// streamText itself is mocked we can hand back any opaque sentinel.
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({
    getModel: () => ({ __mock: 'language-model' }),
    getEmbeddingModel: () => ({ __mock: 'embedding-model' }),
  }),
}));

// Import after mocks so the adapter picks up the mocked streamText.
const { createTauriAdapter } = await import('@/services/ai/adapters/TauriChatAdapter');

interface FakeBackendOverrides {
  searchResult?: ScoredChunk[];
  buildLookupTool?: RetrievalBackend['buildLookupTool'];
}

function fakeLegacy(overrides: FakeBackendOverrides = {}): RetrievalBackend {
  return {
    kind: 'legacy-idb',
    isIndexed: vi.fn(async () => true),
    indexBook: vi.fn(async () => {}),
    clearBook: vi.fn(async () => {}),
    searchForSystemPrompt: vi.fn(async () => overrides.searchResult ?? []),
  };
}

function fakeReedy(overrides: FakeBackendOverrides = {}): RetrievalBackend {
  const tool = { __mock: 'tool' } as unknown as Tool<unknown, unknown>;
  return {
    kind: 'reedy',
    isIndexed: vi.fn(async () => true),
    indexBook: vi.fn(async () => {}),
    clearBook: vi.fn(async () => {}),
    buildLookupTool: overrides.buildLookupTool ?? vi.fn(() => tool),
  };
}

const baseSettings: AISettings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  provider: 'ollama',
  reedy: { enabled: true },
};

async function* asyncIter<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

interface RunCall {
  model: unknown;
  system: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Record<string, unknown>;
  stopWhen?: unknown;
  abortSignal?: AbortSignal;
}

async function drainRun(adapterRun: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of adapterRun) {
    /* swallow */
  }
}

beforeEach(() => {
  streamTextMock.mockReset();
  stepCountIsMock.mockClear();
  // Default: streamText returns an empty text stream so the for-await loop
  // in the adapter completes immediately.
  streamTextMock.mockImplementation(
    (args: RunCall) =>
      ({
        ...args,
        textStream: asyncIter<string>([]),
      }) as unknown,
  );
});

describe('TauriChatAdapter wiring (M1.11)', () => {
  it('Reedy backend: streamText receives tools.lookupPassage and stopWhen=stepCountIs(3)', async () => {
    const sourceStore = new ReedySourceStore();
    const backend = fakeReedy();
    const adapter = createTauriAdapter(() => ({
      settings: baseSettings,
      bookHash: 'bk1',
      bookTitle: 'Title',
      authorName: 'Author',
      currentPage: 0,
      backend,
      sourceStore,
    }));

    await drainRun(
      adapter.run({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'What is Alice doing?' }] }],
        abortSignal: undefined,
      } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<unknown>,
    );

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const call = streamTextMock.mock.calls[0]![0] as RunCall;
    expect(call.tools).toBeDefined();
    expect(call.tools!['lookupPassage']).toBeDefined();
    expect(call.stopWhen).toEqual({ __stepCountIs: 3 });
    expect(call.system).toMatch(/lookupPassage/);
    expect(call.system).toMatch(/<retrieved/);
    expect(backend.buildLookupTool).toHaveBeenCalledWith(
      expect.objectContaining({
        bookHash: 'bk1',
        sourceStore,
      }),
    );
  });

  it('legacy backend: streamText receives NO tools and the system prompt holds chunks', async () => {
    const sourceStore = new ReedySourceStore();
    const chunks: ScoredChunk[] = [
      {
        id: 'c1',
        bookHash: 'bk1',
        sectionIndex: 0,
        chapterTitle: 'Ch1',
        pageNumber: 0,
        text: 'Alice met the rabbit',
        searchMethod: 'hybrid',
        score: 0.9,
      },
    ];
    const backend = fakeLegacy({ searchResult: chunks });
    const adapter = createTauriAdapter(() => ({
      settings: { ...baseSettings, reedy: { enabled: false }, provider: 'ollama' },
      bookHash: 'bk1',
      bookTitle: 'Title',
      authorName: 'Author',
      currentPage: 0,
      backend,
      sourceStore,
    }));

    await drainRun(
      adapter.run({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'rabbit' }] }],
        abortSignal: undefined,
      } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<unknown>,
    );

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const call = streamTextMock.mock.calls[0]![0] as RunCall;
    expect(call.tools).toBeUndefined();
    expect(backend.searchForSystemPrompt).toHaveBeenCalled();
    // Source store should be populated with the legacy chunks under the turn id.
    const turnIds = (sourceStore as unknown as { sources: Map<string, unknown[]> }).sources;
    const populatedTurns = [...turnIds.entries()].filter(([, v]) => v.length > 0);
    expect(populatedTurns.length).toBe(1);
  });

  it('onTurnStart fires synchronously before the stream begins so the UI can subscribe', async () => {
    const sourceStore = new ReedySourceStore();
    const backend = fakeReedy();
    const turnStartedWith: string[] = [];

    const adapter = createTauriAdapter(() => ({
      settings: baseSettings,
      bookHash: 'bk1',
      bookTitle: 'Title',
      authorName: 'Author',
      currentPage: 0,
      backend,
      sourceStore,
      onTurnStart: (id) => turnStartedWith.push(id),
    }));

    await drainRun(
      adapter.run({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        abortSignal: undefined,
      } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<unknown>,
    );

    expect(turnStartedWith).toHaveLength(1);
    expect(turnStartedWith[0]).toMatch(/.+/);
    // The store should hold the same key (replaced with [] at turn start).
    expect(sourceStore.get(turnStartedWith[0]!)).toEqual([]);
  });

  it('Reedy backend: every system prompt includes the status-handling instructions', async () => {
    const sourceStore = new ReedySourceStore();
    const adapter = createTauriAdapter(() => ({
      settings: baseSettings,
      bookHash: 'bk1',
      bookTitle: 'My Book',
      authorName: '',
      currentPage: 5,
      backend: fakeReedy(),
      sourceStore,
    }));

    await drainRun(
      adapter.run({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
        abortSignal: undefined,
      } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<unknown>,
    );

    const call = streamTextMock.mock.calls[0]![0] as RunCall;
    for (const status of [
      'not_indexed',
      'empty_index',
      'stale_index',
      'degraded',
      'budget_exceeded',
    ]) {
      expect(call.system, `system prompt should mention ${status}`).toContain(status);
    }
    expect(call.system).toContain('My Book');
  });
});
