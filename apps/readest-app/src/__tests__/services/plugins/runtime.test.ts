import { describe, expect, test, vi } from 'vitest';
import {
  PLUGIN_PROTOCOL_VERSION,
  type PluginWorkerInboundMessage,
} from '@/services/plugins/contract';
import { createPluginRuntime, type PluginWorkerLike } from '@/services/plugins/runtime';

class FakeWorker implements PluginWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly sent: PluginWorkerInboundMessage[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.sent.push(message as PluginWorkerInboundMessage);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: message }));
  }

  crash(message = 'boom'): void {
    this.onerror?.(new ErrorEvent('error', { message }));
  }
}

const lookupPayload = {
  dictionaryId: 'dict-1',
  databaseHandle: 'db-1',
  query: '読む',
  language: 'ja',
};

describe('plugin runtime', () => {
  test('routes a validated operation response to its caller', async () => {
    const worker = new FakeWorker();
    const runtime = createPluginRuntime({ createWorker: () => worker });

    const pending = runtime.call('lookup', lookupPayload);
    const request = worker.sent[0];
    expect(request).toMatchObject({
      kind: 'request',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      operation: 'lookup',
      payload: lookupPayload,
    });
    expect(request?.kind).toBe('request');
    if (request?.kind !== 'request') throw new Error('Expected request');

    worker.emit({
      kind: 'response',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: {
        entries: [{ expression: '読む', reading: 'よむ', definitions: [] }],
      },
    });

    await expect(pending).resolves.toEqual({
      entries: [{ expression: '読む', reading: 'よむ', definitions: [] }],
    });
  });

  test('rejects an operation response that violates its result contract', async () => {
    const worker = new FakeWorker();
    const runtime = createPluginRuntime({ createWorker: () => worker });
    const pending = runtime.call('lookup', lookupPayload);
    const request = worker.sent[0];
    if (request?.kind !== 'request') throw new Error('Expected request');

    worker.emit({
      kind: 'response',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: {
        entries: [
          {
            expression: 'x',
            reading: 'x',
            definitions: [{ type: 'html', value: '<script>alert(1)</script>' }],
          },
        ],
      },
    });

    await expect(pending).rejects.toThrow();
  });

  test('proxies host calls and reports progress for the owning request', async () => {
    const worker = new FakeWorker();
    const handleHostCall = vi.fn(async () => ({ name: 'dict.zip', size: 42 }));
    const onProgress = vi.fn();
    const runtime = createPluginRuntime({ createWorker: () => worker, handleHostCall });
    const pending = runtime.call('inspect', { sourceHandle: 'source-1' }, { onProgress });
    const request = worker.sent[0];
    if (request?.kind !== 'request') throw new Error('Expected request');

    worker.emit({
      kind: 'host-call',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: request.requestId,
      callId: 'call-1',
      capability: 'source.stat',
      payload: { handle: 'source-1' },
    });
    await vi.waitFor(() => {
      expect(worker.sent[1]).toEqual({
        kind: 'host-result',
        protocolVersion: PLUGIN_PROTOCOL_VERSION,
        requestId: request.requestId,
        callId: 'call-1',
        ok: true,
        result: { name: 'dict.zip', size: 42 },
      });
    });
    expect(handleHostCall).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'source.stat' }),
      request,
    );

    worker.emit({
      kind: 'progress',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: request.requestId,
      stage: 'indexing',
      completed: 1,
      total: 2,
    });
    expect(onProgress).toHaveBeenCalledWith({ stage: 'indexing', completed: 1, total: 2 });

    worker.emit({
      kind: 'response',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: {
        formatId: 'yomitan',
        sourceFormatVersion: 3,
        title: 'Test dictionary',
      },
    });
    await expect(pending).resolves.toMatchObject({ title: 'Test dictionary' });
  });

  test('cancels an aborted request and rejects with AbortError', async () => {
    const worker = new FakeWorker();
    const runtime = createPluginRuntime({ createWorker: () => worker });
    const controller = new AbortController();
    const pending = runtime.call('lookup', lookupPayload, { signal: controller.signal });
    const request = worker.sent[0];
    if (request?.kind !== 'request') throw new Error('Expected request');

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.sent[1]).toEqual({
      kind: 'cancel',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: request.requestId,
    });
  });

  test('fails pending calls on crash and lazily creates a fresh worker', async () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    const createWorker = vi.fn(() => workers[createWorker.mock.calls.length - 1]!);
    const runtime = createPluginRuntime({ createWorker });

    const first = runtime.call('lookup', lookupPayload);
    workers[0]!.crash('plugin crashed');
    await expect(first).rejects.toThrow('plugin crashed');
    expect(workers[0]!.terminated).toBe(true);

    const second = runtime.call('lookup', lookupPayload);
    const request = workers[1]!.sent[0];
    if (request?.kind !== 'request') throw new Error('Expected request');
    workers[1]!.emit({
      kind: 'response',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: { entries: [] },
    });

    await expect(second).resolves.toEqual({ entries: [] });
    expect(createWorker).toHaveBeenCalledTimes(2);
  });
});
