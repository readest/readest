import { describe, it, expect } from 'vitest';
import { events, type ReedyEvent } from '@/services/reedy/runtime/events';
import {
  ReedyError,
  ReedyToolError,
  makeReedyError,
  makeToolError,
} from '@/services/reedy/runtime/errors';

describe('ReedyError', () => {
  it('makeReedyError sets retryable per the default table when unspecified', () => {
    expect(makeReedyError('context_overflow', 'too big').retryable).toBe(true);
    expect(makeReedyError('provider_unavailable', 'down').retryable).toBe(true);
    expect(makeReedyError('turn_timeout', '5m hit').retryable).toBe(false);
    expect(makeReedyError('invalid_response', 'bad').retryable).toBe(false);
  });

  it('allows the caller to override retryable explicitly', () => {
    expect(makeReedyError('context_overflow', 'x', { retryable: false }).retryable).toBe(false);
    expect(makeReedyError('turn_timeout', 'x', { retryable: true }).retryable).toBe(true);
  });

  it('preserves cause for upstream debugging', () => {
    const root = new Error('underlying');
    const err = makeReedyError('model_error', 'wrapped', { cause: root });
    expect(err.cause).toBe(root);
  });

  it('isAbort returns true only for kind=abort ReedyError', () => {
    expect(ReedyError.isAbort(makeReedyError('abort', 'cancelled'))).toBe(true);
    expect(ReedyError.isAbort(makeReedyError('model_error', 'other'))).toBe(false);
    expect(ReedyError.isAbort(new Error('plain'))).toBe(false);
  });
});

describe('ReedyToolError', () => {
  it('defaults retryable=true only for tool_invalid_args and tool_timeout', () => {
    expect(makeToolError('tool_invalid_args', 'lookupPassage', 'bad').retryable).toBe(true);
    expect(makeToolError('tool_timeout', 'lookupPassage', 'slow').retryable).toBe(true);
    expect(makeToolError('tool_permission_denied', 'navigate', 'denied').retryable).toBe(false);
    expect(makeToolError('tool_runtime_error', 'lookupPassage', 'crash').retryable).toBe(false);
  });

  it('exposes toolName + kind on the instance', () => {
    const err = makeToolError('tool_timeout', 'lookupPassage', 'slow');
    expect(err.toolName).toBe('lookupPassage');
    expect(err.kind).toBe('tool_timeout');
    expect(err.name).toBe('ReedyToolError');
  });
});

describe('events factories', () => {
  it('emit the expected shape for every variant', () => {
    const out: ReedyEvent[] = [
      events.turnStart('s1', 'msg1'),
      events.textDelta('hi'),
      events.toolCall({ id: 't1', name: 'lookupPassage', args: { q: 'a' }, permission: 'read' }),
      events.toolResultOk({ id: 't1', name: 'lookupPassage', result: { x: 1 }, durationMs: 42 }),
      events.toolResultErr({
        id: 't2',
        name: 'lookupPassage',
        error: makeToolError('tool_timeout', 'lookupPassage', 'slow'),
      }),
      events.citation({ cfi: 'epubcfi(/6/2!)', sectionIndex: 0, snippet: 'hi' }),
      events.memoryWrite('book', 'theme', 'about loss'),
      events.stepFinish(1, 'tool-calls'),
      events.usage(500, 200),
      events.error('model_error', 'oops', true),
      events.abort(true),
      events.done({
        sessionId: 's1',
        assistantMessageId: 'msg1',
        finishReason: 'stop',
        usage: { promptTokens: 500, completionTokens: 200 },
      }),
    ];

    expect(out.map((e) => e.type)).toEqual([
      'turn_start',
      'text_delta',
      'tool_call',
      'tool_result',
      'tool_result',
      'citation',
      'memory_write',
      'step_finish',
      'usage',
      'error',
      'abort',
      'done',
    ]);
  });

  it('toolResultOk carries ok=true; toolResultErr carries ok=false + error', () => {
    const okEv = events.toolResultOk({ id: 't', name: 'n', result: 1, durationMs: 0 });
    const errEv = events.toolResultErr({
      id: 't',
      name: 'n',
      error: makeToolError('tool_runtime_error', 'n', 'boom'),
    });
    expect(okEv).toMatchObject({ type: 'tool_result', ok: true });
    expect(errEv).toMatchObject({ type: 'tool_result', ok: false });
    if (errEv.type === 'tool_result' && !errEv.ok) {
      expect(errEv.error).toBeInstanceOf(ReedyToolError);
    }
  });
});
