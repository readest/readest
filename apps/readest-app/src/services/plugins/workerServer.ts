import {
  PLUGIN_PROTOCOL_VERSION,
  normalizePluginErrorPayload,
  parsePluginOperationResult,
  pluginWorkerInboundMessageSchema,
  pluginWorkerOutboundMessageSchema,
  type PluginHostCall,
  type PluginOperation,
  type PluginPayload,
  type PluginRequest,
  type PluginResult,
  type PluginWorkerOutboundMessage,
} from './contract';

export interface PluginWorkerGlobalLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

type HostCallFor<C extends PluginHostCall['capability']> = Extract<
  PluginHostCall,
  { capability: C }
>;

export interface PluginWorkerOperationContext {
  readonly signal: AbortSignal;
  call<C extends PluginHostCall['capability']>(
    capability: C,
    payload: HostCallFor<C>['payload'],
  ): Promise<unknown>;
  progress(stage: string, completed: number, total?: number): void;
}

export type PluginOperationHandlers = {
  [K in PluginOperation]?: (
    payload: PluginPayload<K>,
    context: PluginWorkerOperationContext,
  ) => Promise<PluginResult<K>>;
};

interface ActiveOperation {
  controller: AbortController;
}

interface PendingHostCall {
  requestId: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

class WorkerHostCallError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'WorkerHostCallError';
  }
}

const errorPayload = (error: unknown): { code: string; message: string } => {
  if (error instanceof WorkerHostCallError) {
    return normalizePluginErrorPayload(error.code, error.message);
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return normalizePluginErrorPayload('ABORTED', error.message || 'Plugin operation aborted');
  }
  return normalizePluginErrorPayload(
    'PLUGIN_OPERATION_FAILED',
    error instanceof Error ? error.message : String(error),
  );
};

const missingHandler = (operation: PluginOperation): never => {
  throw new WorkerHostCallError(
    `Plugin operation is unavailable: ${operation}`,
    'OPERATION_UNAVAILABLE',
  );
};

const runHandler = (
  handlers: PluginOperationHandlers,
  request: PluginRequest,
  context: PluginWorkerOperationContext,
): Promise<unknown> => {
  switch (request.operation) {
    case 'probe':
      return handlers.probe?.(request.payload, context) ?? missingHandler(request.operation);
    case 'inspect':
      return handlers.inspect?.(request.payload, context) ?? missingHandler(request.operation);
    case 'buildIndex':
      return handlers.buildIndex?.(request.payload, context) ?? missingHandler(request.operation);
    case 'verifyIndex':
      return handlers.verifyIndex?.(request.payload, context) ?? missingHandler(request.operation);
    case 'lookup':
      return handlers.lookup?.(request.payload, context) ?? missingHandler(request.operation);
    case 'readResource':
      return handlers.readResource?.(request.payload, context) ?? missingHandler(request.operation);
  }
};

export const startPluginWorkerServer = (
  workerScope: PluginWorkerGlobalLike,
  handlers: PluginOperationHandlers,
): void => {
  let nextCallId = 0;
  const active = new Map<string, ActiveOperation>();
  const pendingHostCalls = new Map<string, PendingHostCall>();

  const rejectHostCalls = (requestId: string): void => {
    for (const [callId, call] of pendingHostCalls) {
      if (call.requestId !== requestId) continue;
      pendingHostCalls.delete(callId);
      call.reject(new DOMException('Plugin operation aborted', 'AbortError'));
    }
  };

  const post = (message: PluginWorkerOutboundMessage): void =>
    workerScope.postMessage(pluginWorkerOutboundMessageSchema.parse(message));

  const createContext = (
    requestId: string,
    controller: AbortController,
  ): PluginWorkerOperationContext => ({
    signal: controller.signal,
    call: (capability, payload) => {
      if (controller.signal.aborted)
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      const callId = `plugin-host-call-${++nextCallId}`;
      return new Promise<unknown>((resolve, reject) => {
        pendingHostCalls.set(callId, { requestId, resolve, reject });
        post({
          kind: 'host-call',
          protocolVersion: PLUGIN_PROTOCOL_VERSION,
          requestId,
          callId,
          capability,
          payload,
        } as PluginHostCall);
      });
    },
    progress: (stage, completed, total) => {
      if (controller.signal.aborted) return;
      post({
        kind: 'progress',
        protocolVersion: PLUGIN_PROTOCOL_VERSION,
        requestId,
        stage,
        completed,
        ...(total === undefined ? {} : { total }),
      });
    },
  });

  const handleRequest = (request: PluginRequest): void => {
    if (active.has(request.requestId)) return;
    const controller = new AbortController();
    const operation: ActiveOperation = { controller };
    active.set(request.requestId, operation);
    const context = createContext(request.requestId, controller);
    void runHandler(handlers, request, context).then(
      (value) => {
        if (active.get(request.requestId) !== operation || controller.signal.aborted) return;
        active.delete(request.requestId);
        rejectHostCalls(request.requestId);
        try {
          const result = parsePluginOperationResult(request.operation, value);
          post({
            kind: 'response',
            protocolVersion: PLUGIN_PROTOCOL_VERSION,
            requestId: request.requestId,
            ok: true,
            result,
          });
        } catch (error) {
          post({
            kind: 'response',
            protocolVersion: PLUGIN_PROTOCOL_VERSION,
            requestId: request.requestId,
            ok: false,
            error: errorPayload(error),
          });
        }
      },
      (error: unknown) => {
        if (active.get(request.requestId) !== operation || controller.signal.aborted) return;
        active.delete(request.requestId);
        rejectHostCalls(request.requestId);
        post({
          kind: 'response',
          protocolVersion: PLUGIN_PROTOCOL_VERSION,
          requestId: request.requestId,
          ok: false,
          error: errorPayload(error),
        });
      },
    );
  };

  workerScope.onmessage = (event): void => {
    const parsed = pluginWorkerInboundMessageSchema.safeParse(event.data);
    if (!parsed.success) {
      const value = event.data;
      if (typeof value !== 'object' || value === null) return;
      const envelope = value as Record<string, unknown>;
      if (
        envelope['kind'] !== 'host-result' ||
        typeof envelope['requestId'] !== 'string' ||
        typeof envelope['callId'] !== 'string'
      ) {
        return;
      }
      const call = pendingHostCalls.get(envelope['callId']);
      if (!call || call.requestId !== envelope['requestId']) return;
      pendingHostCalls.delete(envelope['callId']);
      call.reject(
        new WorkerHostCallError('Plugin host returned an invalid result', 'INVALID_HOST_RESULT'),
      );
      return;
    }
    const message = parsed.data;
    if (message.kind === 'request') {
      handleRequest(message);
      return;
    }
    if (message.kind === 'cancel') {
      const operation = active.get(message.requestId);
      if (!operation) return;
      active.delete(message.requestId);
      operation.controller.abort();
      rejectHostCalls(message.requestId);
      return;
    }
    const call = pendingHostCalls.get(message.callId);
    if (!call || call.requestId !== message.requestId) return;
    pendingHostCalls.delete(message.callId);
    if (message.ok) call.resolve(message.result);
    else call.reject(new WorkerHostCallError(message.error.message, message.error.code));
  };
};
