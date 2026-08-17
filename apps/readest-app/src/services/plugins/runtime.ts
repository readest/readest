import {
  PLUGIN_PROTOCOL_VERSION,
  normalizePluginErrorPayload,
  parsePluginOperationResult,
  pluginRequestSchema,
  pluginWorkerOutboundMessageSchema,
  type PluginHostCall,
  type PluginOperation,
  type PluginPayload,
  type PluginProgress,
  type PluginRequest,
  type PluginResult,
  type PluginWorkerInboundMessage,
} from './contract';

export interface PluginWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export class PluginRuntimeError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PluginRuntimeError';
  }
}

export interface PluginCallOptions {
  signal?: AbortSignal;
  onProgress?: (progress: Omit<PluginProgress, 'kind' | 'protocolVersion' | 'requestId'>) => void;
}

export type PluginHostCallHandler = (
  call: PluginHostCall,
  request: PluginRequest,
) => Promise<unknown>;

interface PendingRequest {
  request: PluginRequest;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  onProgress?: PluginCallOptions['onProgress'];
}

interface CreatePluginRuntimeOptions {
  createWorker: () => PluginWorkerLike;
  handleHostCall?: PluginHostCallHandler;
}

const abortError = (): DOMException => new DOMException('Plugin request aborted', 'AbortError');

const errorDetails = (error: unknown): { code: string; message: string } => {
  if (error instanceof PluginRuntimeError) {
    return normalizePluginErrorPayload(error.code, error.message);
  }
  return normalizePluginErrorPayload(
    'HOST_CALL_FAILED',
    error instanceof Error ? error.message : String(error),
  );
};

const transferablesFor = (value: unknown): Transferable[] => {
  const buffers = new Set<ArrayBuffer>();
  const visited = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (candidate instanceof ArrayBuffer) {
      buffers.add(candidate);
      return;
    }
    if (ArrayBuffer.isView(candidate)) {
      if (candidate.buffer instanceof ArrayBuffer) buffers.add(candidate.buffer);
      return;
    }
    if (typeof candidate !== 'object' || candidate === null || visited.has(candidate)) return;
    visited.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return [...buffers];
};

export const createPluginRuntime = ({
  createWorker,
  handleHostCall,
}: CreatePluginRuntimeOptions) => {
  let worker: PluginWorkerLike | null = null;
  let nextRequestId = 0;
  const pending = new Map<string, PendingRequest>();

  const cleanupRequest = (requestId: string): PendingRequest | undefined => {
    const request = pending.get(requestId);
    if (!request) return undefined;
    if (request.signal && request.onAbort) {
      request.signal.removeEventListener('abort', request.onAbort);
    }
    pending.delete(requestId);
    return request;
  };

  const terminateWorker = (): void => {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  };

  const failWorker = (message: string, code = 'WORKER_FAILED'): void => {
    terminateWorker();
    for (const requestId of [...pending.keys()]) {
      cleanupRequest(requestId)?.reject(new PluginRuntimeError(message, code));
    }
  };

  const postHostResult = (
    targetWorker: PluginWorkerLike,
    call: PluginHostCall,
    result: unknown,
  ): void => {
    if (worker !== targetWorker || !pending.has(call.requestId)) return;
    const message: PluginWorkerInboundMessage = {
      kind: 'host-result',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: call.requestId,
      callId: call.callId,
      ok: true,
      result,
    };
    targetWorker.postMessage(message, transferablesFor(result));
  };

  const postHostError = (
    targetWorker: PluginWorkerLike,
    call: PluginHostCall,
    error: unknown,
  ): void => {
    if (worker !== targetWorker || !pending.has(call.requestId)) return;
    const message: PluginWorkerInboundMessage = {
      kind: 'host-result',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      requestId: call.requestId,
      callId: call.callId,
      ok: false,
      error: errorDetails(error),
    };
    targetWorker.postMessage(message);
  };

  const routeHostCall = (targetWorker: PluginWorkerLike, call: PluginHostCall): void => {
    const owningRequest = pending.get(call.requestId)?.request;
    if (!owningRequest) return;
    if (!handleHostCall) {
      postHostError(
        targetWorker,
        call,
        new PluginRuntimeError(
          'Plugin host capabilities are unavailable',
          'CAPABILITY_UNAVAILABLE',
        ),
      );
      return;
    }
    void handleHostCall(call, owningRequest).then(
      (result) => postHostResult(targetWorker, call, result),
      (error: unknown) => postHostError(targetWorker, call, error),
    );
  };

  const handleMessage = (targetWorker: PluginWorkerLike, value: unknown): void => {
    const parsed = pluginWorkerOutboundMessageSchema.safeParse(value);
    if (!parsed.success) {
      failWorker('Plugin worker sent an invalid message', 'INVALID_WORKER_MESSAGE');
      return;
    }
    const message = parsed.data;
    if (message.kind === 'host-call') {
      routeHostCall(targetWorker, message);
      return;
    }
    if (message.kind === 'progress') {
      const request = pending.get(message.requestId);
      request?.onProgress?.({
        stage: message.stage,
        completed: message.completed,
        ...(message.total === undefined ? {} : { total: message.total }),
      });
      return;
    }

    const request = cleanupRequest(message.requestId);
    if (!request) return;
    if (!message.ok) {
      request.reject(new PluginRuntimeError(message.error.message, message.error.code));
      return;
    }
    try {
      request.resolve(parsePluginOperationResult(request.request.operation, message.result));
    } catch (error) {
      request.reject(
        new PluginRuntimeError(
          error instanceof Error ? error.message : String(error),
          'INVALID_OPERATION_RESULT',
        ),
      );
    }
  };

  const getWorker = (): PluginWorkerLike => {
    if (worker) return worker;
    const created = createWorker();
    worker = created;
    created.onmessage = (event) => handleMessage(created, event.data);
    created.onerror = (event) => failWorker(event.message || 'Plugin worker failed');
    created.onmessageerror = () =>
      failWorker(
        'Plugin worker response could not be deserialized',
        'MESSAGE_DESERIALIZATION_FAILED',
      );
    return created;
  };

  return {
    call<T extends PluginOperation>(
      operation: T,
      payload: PluginPayload<T>,
      options: PluginCallOptions = {},
    ): Promise<PluginResult<T>> {
      if (options.signal?.aborted) return Promise.reject(abortError());
      const requestId = `plugin-request-${++nextRequestId}`;
      const request = pluginRequestSchema.parse({
        kind: 'request',
        protocolVersion: PLUGIN_PROTOCOL_VERSION,
        requestId,
        operation,
        payload,
      });

      return new Promise<PluginResult<T>>((resolve, reject) => {
        const onAbort = (): void => {
          const aborted = cleanupRequest(requestId);
          if (!aborted) return;
          const cancel: PluginWorkerInboundMessage = {
            kind: 'cancel',
            protocolVersion: PLUGIN_PROTOCOL_VERSION,
            requestId,
          };
          worker?.postMessage(cancel);
          reject(abortError());
        };
        pending.set(requestId, {
          request,
          resolve: (value) => resolve(value as PluginResult<T>),
          reject,
          signal: options.signal,
          onAbort,
          onProgress: options.onProgress,
        });
        options.signal?.addEventListener('abort', onAbort, { once: true });
        try {
          getWorker().postMessage(request);
        } catch (error) {
          cleanupRequest(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },

    close(): void {
      failWorker('Plugin runtime closed', 'RUNTIME_CLOSED');
    },
  };
};
