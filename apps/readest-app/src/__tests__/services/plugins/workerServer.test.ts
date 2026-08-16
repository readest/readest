import { describe, expect, test, vi } from 'vitest';
import { PLUGIN_PROTOCOL_VERSION } from '@/services/plugins/contract';
import {
  startPluginWorkerServer,
  type PluginWorkerGlobalLike,
} from '@/services/plugins/workerServer';

class FakeWorkerGlobal implements PluginWorkerGlobalLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly sent: unknown[] = [];

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  emit(message: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: message }));
  }
}

describe('plugin worker server', () => {
  test('runs an operation and multiplexes its host capability calls', async () => {
    const scope = new FakeWorkerGlobal();
    startPluginWorkerServer(scope, {
      lookup: async (payload, context) => {
        const stat = await context.call('source.stat', { handle: 'source-1' });
        context.progress('lookup', 1, 1);
        expect(stat).toEqual({ name: 'dict.zip', size: 42 });
        return {
          entries: [{ expression: payload.query, reading: payload.query, definitions: [] }],
        };
      },
    });

    scope.emit({
      kind: 'request',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: 'request-1',
      operation: 'lookup',
      payload: {
        dictionaryId: 'dict-1',
        databaseHandle: 'db-1',
        query: '読む',
      },
    });
    await vi.waitFor(() => expect(scope.sent).toHaveLength(1));
    expect(scope.sent[0]).toMatchObject({
      kind: 'host-call',
      requestId: 'request-1',
      capability: 'source.stat',
      payload: { handle: 'source-1' },
    });
    const call = scope.sent[0] as { callId: string };

    scope.emit({
      kind: 'host-result',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: 'request-1',
      callId: call.callId,
      ok: true,
      result: { name: 'dict.zip', size: 42 },
    });

    await vi.waitFor(() => expect(scope.sent).toHaveLength(3));
    expect(scope.sent[1]).toMatchObject({
      kind: 'progress',
      requestId: 'request-1',
      stage: 'lookup',
    });
    expect(scope.sent[2]).toEqual({
      kind: 'response',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: 'request-1',
      ok: true,
      result: {
        entries: [{ expression: '読む', reading: '読む', definitions: [] }],
      },
    });
  });

  test('aborts the owning handler and ignores its late result', async () => {
    const scope = new FakeWorkerGlobal();
    let observedSignal: AbortSignal | undefined;
    startPluginWorkerServer(scope, {
      lookup: async (_payload, context) => {
        observedSignal = context.signal;
        await new Promise<void>((resolve) =>
          context.signal.addEventListener('abort', () => resolve()),
        );
        return { entries: [] };
      },
    });
    scope.emit({
      kind: 'request',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: 'request-1',
      operation: 'lookup',
      payload: { dictionaryId: 'dict-1', databaseHandle: 'db-1', query: '読む' },
    });
    await vi.waitFor(() => expect(observedSignal).toBeDefined());

    scope.emit({
      kind: 'cancel',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: 'request-1',
    });
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
    await Promise.resolve();
    expect(scope.sent).toEqual([]);
  });
});
