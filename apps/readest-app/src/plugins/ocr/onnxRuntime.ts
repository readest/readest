import type { InferenceSession } from 'onnxruntime-web/wasm';

export type OnnxRuntime = typeof import('onnxruntime-web/wasm');

/** Loads the runtime the models share. Its settings apply before the first session only. */
export const loadOnnxRuntime = async (): Promise<OnnxRuntime> => {
  const runtime = await import('onnxruntime-web/wasm');
  runtime.env.wasm.numThreads = globalThis.crossOriginIsolated
    ? Math.min(8, Math.ceil((navigator.hardwareConcurrency || 1) / 2))
    : 1;
  runtime.env.wasm.proxy = typeof document !== 'undefined';
  runtime.env.wasm.wasmPaths = '/vendor/onnxruntime/';
  return runtime;
};

export const createOnnxSession = (
  runtime: OnnxRuntime,
  model: ArrayBuffer,
): Promise<InferenceSession> =>
  runtime.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    executionMode: 'sequential',
    graphOptimizationLevel: 'all',
  });
