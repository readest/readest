import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { ChatModel } from '@/services/reedy/models/ChatModel';
import { ToolRegistry } from '@/services/reedy/tools/ToolRegistry';
import type { ReedyTool } from '@/services/reedy/tools/types';
import { createPolicyLayer } from '@/services/reedy/context';
import type { ReedyEvent } from '@/services/reedy/runtime/events';

// Mock streamText so we drive what the runtime sees without an LLM.
// vi.hoisted lets the factory below access these — vi.mock is hoisted
// above regular consts, so a plain `const streamTextMock = vi.fn()` would
// fail with "cannot access before initialization".
const { streamTextMock, stepCountIsMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  stepCountIsMock: vi.fn((n: number) => ({ __stepCountIs: n })),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: streamTextMock,
    stepCountIs: stepCountIsMock,
  };
});

const { AgentRuntime } = await import('@/services/reedy/runtime/AgentRuntime');

function fakeModel(): ChatModel {
  return {
    id: 'fake',
    contextWindow: 32_000,
    reservedOutput: 1_000,
    supportsTools: true,
    getLanguageModel: () =>
      ({ __mock: 'lm' }) as unknown as ReturnType<ChatModel['getLanguageModel']>,
  };
}

async function* asyncIter<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function drain(stream: AsyncIterable<ReedyEvent>): Promise<ReedyEvent[]> {
  const out: ReedyEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

beforeEach(() => {
  streamTextMock.mockReset();
  stepCountIsMock.mockClear();
});

describe('AgentRuntime — happy path', () => {
  it('emits turn_start → text_delta(s) → finish-step → usage → done for a text-only stream', async () => {
    streamTextMock.mockReturnValue({
      fullStream: asyncIter([
        { type: 'text-delta', id: 't1', text: 'Hello, ' },
        { type: 'text-delta', id: 't1', text: 'world.' },
        {
          type: 'finish-step',
          finishReason: 'stop',
          usage: { inputTokens: 50, outputTokens: 10 },
        },
        { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 50, outputTokens: 10 } },
      ]),
    });

    const runtime = new AgentRuntime({
      model: fakeModel(),
      tools: new ToolRegistry(),
      layers: [createPolicyLayer('You are Reedy.')],
    });
    const events = await drain(
      runtime.runTurn({ sessionId: 's1', bookHash: 'bk1', userMessage: 'hi' }),
    );

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('turn_start');
    expect(types).toContain('text_delta');
    expect(types).toContain('step_finish');
    expect(types).toContain('usage');
    expect(types.at(-1)).toBe('done');

    const done = events.at(-1)!;
    if (done.type === 'done') {
      expect(done.output.finishReason).toBe('stop');
      expect(done.output.usage).toEqual({ promptTokens: 50, completionTokens: 10 });
    }
  });
});

describe('AgentRuntime — tool calls', () => {
  function readTool(name: string): ReedyTool<{ q: string }, { hit: string }> {
    return {
      name,
      description: 'find',
      permission: 'read',
      parallelSafe: true,
      inputSchema: z.object({ q: z.string() }),
      async run(args) {
        return { hit: args.q };
      },
    };
  }

  it('emits tool_call → tool_result(ok) when streamText reports a successful dispatch', async () => {
    streamTextMock.mockReturnValue({
      fullStream: asyncIter([
        {
          type: 'tool-call',
          toolCallId: 'tc1',
          toolName: 'find',
          input: { q: 'alice' },
        },
        {
          type: 'tool-result',
          toolCallId: 'tc1',
          toolName: 'find',
          output: { hit: 'alice' },
        },
        {
          type: 'finish-step',
          finishReason: 'tool-calls',
          usage: { inputTokens: 5, outputTokens: 0 },
        },
        { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 5, outputTokens: 0 } },
      ]),
    });

    const reg = new ToolRegistry();
    reg.register(readTool('find'));
    const runtime = new AgentRuntime({
      model: fakeModel(),
      tools: reg,
      layers: [createPolicyLayer('p')],
    });

    const events = await drain(
      runtime.runTurn({ sessionId: 's1', bookHash: 'bk1', userMessage: 'find alice' }),
    );

    const toolCall = events.find((e) => e.type === 'tool_call')!;
    const toolResult = events.find((e) => e.type === 'tool_result')!;
    expect(toolCall.type).toBe('tool_call');
    if (toolCall.type === 'tool_call') {
      expect(toolCall.name).toBe('find');
      expect(toolCall.permission).toBe('read');
      expect(toolCall.args).toEqual({ q: 'alice' });
    }
    expect(toolResult.type).toBe('tool_result');
    if (toolResult.type === 'tool_result' && toolResult.ok) {
      expect(toolResult.result).toEqual({ hit: 'alice' });
    }
  });

  it('emits tool_result(ok=false) with the tool error when streamText reports tool-error', async () => {
    streamTextMock.mockReturnValue({
      fullStream: asyncIter([
        {
          type: 'tool-error',
          toolCallId: 'tc1',
          toolName: 'find',
          error: new Error('boom'),
        },
        {
          type: 'finish-step',
          finishReason: 'tool-calls',
          usage: { inputTokens: 1, outputTokens: 0 },
        },
        { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 0 } },
      ]),
    });

    const runtime = new AgentRuntime({
      model: fakeModel(),
      tools: new ToolRegistry(),
      layers: [createPolicyLayer('p')],
    });

    const events = await drain(
      runtime.runTurn({ sessionId: 's1', bookHash: 'bk1', userMessage: 'do thing' }),
    );

    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    if (toolResult?.type === 'tool_result' && !toolResult.ok) {
      expect(toolResult.error.kind).toBe('tool_runtime_error');
      expect(toolResult.error.toolName).toBe('find');
    }
  });

  it('extracts citation events from lookupPassage tool results by default', async () => {
    streamTextMock.mockReturnValue({
      fullStream: asyncIter([
        {
          type: 'tool-result',
          toolCallId: 'tc1',
          toolName: 'lookupPassage',
          output: {
            passages: [
              { cfi: 'epubcfi(/6/2)', sectionIndex: 0, chapter: 'Ch1', text: 'snippet a' },
              { cfi: 'epubcfi(/6/4)', sectionIndex: 1, chapter: 'Ch2', text: 'snippet b' },
            ],
            status: 'ok',
          },
        },
        { type: 'finish-step', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } },
        { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 1 } },
      ]),
    });

    const runtime = new AgentRuntime({
      model: fakeModel(),
      tools: new ToolRegistry(),
      layers: [createPolicyLayer('p')],
    });

    const events = await drain(
      runtime.runTurn({ sessionId: 's1', bookHash: 'bk1', userMessage: 'alice?' }),
    );

    const citations = events.filter((e) => e.type === 'citation');
    expect(citations).toHaveLength(2);
    if (citations[0]!.type === 'citation') {
      expect(citations[0]!.cfi).toBe('epubcfi(/6/2)');
      expect(citations[0]!.snippet).toBe('snippet a');
    }
  });
});

describe('AgentRuntime — abort + error paths', () => {
  it('yields events.abort + done(finishReason=abort) when caller signal fires mid-stream', async () => {
    const controller = new AbortController();
    streamTextMock.mockImplementation(() => ({
      fullStream: (async function* (): AsyncGenerator<unknown> {
        yield { type: 'text-delta', id: 't1', text: 'part 1' };
        controller.abort();
        // Simulate the SDK respecting the signal — yield an abort part.
        yield { type: 'abort', reason: 'caller cancelled' };
      })(),
    }));

    const runtime = new AgentRuntime({
      model: fakeModel(),
      tools: new ToolRegistry(),
      layers: [createPolicyLayer('p')],
    });

    const events = await drain(
      runtime.runTurn({
        sessionId: 's1',
        bookHash: 'bk1',
        userMessage: 'long stream',
        signal: controller.signal,
      }),
    );

    expect(events.some((e) => e.type === 'abort')).toBe(true);
    const done = events.at(-1)!;
    expect(done.type).toBe('done');
    if (done.type === 'done') expect(done.output.finishReason).toBe('abort');
  });

  it('emits events.error and done(finishReason=error) when streamText throws (non-abort)', async () => {
    // A real "fullStream" that rejects mid-iteration. We return an
    // AsyncIterable whose next() rejects — Biome doesn't flag this the
    // way it does an empty-bodied generator with throw.
    streamTextMock.mockImplementation(() => ({
      fullStream: {
        [Symbol.asyncIterator](): AsyncIterator<unknown> {
          return {
            next() {
              return Promise.reject(new Error('upstream provider 500'));
            },
          };
        },
      },
    }));

    const runtime = new AgentRuntime({
      model: fakeModel(),
      tools: new ToolRegistry(),
      layers: [createPolicyLayer('p')],
    });

    const events = await drain(
      runtime.runTurn({ sessionId: 's1', bookHash: 'bk1', userMessage: 'hi' }),
    );

    const errorEv = events.find((e) => e.type === 'error');
    expect(errorEv).toBeDefined();
    if (errorEv?.type === 'error') {
      expect(errorEv.kind).toBe('model_error');
      expect(errorEv.message).toContain('500');
    }
    const done = events.at(-1)!;
    if (done.type === 'done') expect(done.output.finishReason).toBe('error');
  });
});

describe('AgentRuntime — streamText arg wiring', () => {
  it('passes the composed system prompt + tools + stopWhen(maxSteps) to streamText', async () => {
    streamTextMock.mockReturnValue({
      fullStream: asyncIter([
        { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 0, outputTokens: 0 } },
      ]),
    });

    const reg = new ToolRegistry();
    reg.register({
      name: 'a',
      description: 'a desc',
      permission: 'read',
      parallelSafe: true,
      inputSchema: z.object({}),
      async run() {
        return null;
      },
    });
    const runtime = new AgentRuntime({
      model: fakeModel(),
      tools: reg,
      layers: [createPolicyLayer('POL.')],
      maxSteps: 4,
    });

    await drain(runtime.runTurn({ sessionId: 's', bookHash: 'b', userMessage: 'q' }));

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const call = streamTextMock.mock.calls[0]![0] as {
      system: string;
      tools?: Record<string, unknown>;
      stopWhen: unknown;
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.system).toContain('POL.');
    expect(call.tools).toBeDefined();
    expect(call.tools!['a']).toBeDefined();
    expect(call.stopWhen).toEqual({ __stepCountIs: 4 });
    expect(call.messages.at(-1)).toEqual({ role: 'user', content: 'q' });
  });

  it('does not pass tools when the registry is empty', async () => {
    streamTextMock.mockReturnValue({
      fullStream: asyncIter([
        { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 0, outputTokens: 0 } },
      ]),
    });

    const runtime = new AgentRuntime({
      model: fakeModel(),
      tools: new ToolRegistry(),
      layers: [createPolicyLayer('p')],
    });
    await drain(runtime.runTurn({ sessionId: 's', bookHash: 'b', userMessage: 'q' }));

    const call = streamTextMock.mock.calls[0]![0] as { tools?: unknown };
    expect(call.tools).toBeUndefined();
  });
});
