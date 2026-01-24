export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // don't retry on abort
      if (lastError.name === 'AbortError') throw lastError;

      if (attempt < opts.maxRetries) {
        const delay = Math.min(opts.baseDelayMs * Math.pow(2, attempt), opts.maxDelayMs);
        opts.onRetry?.(attempt + 1, lastError);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

/**
 * wraps a promise with a timeout
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const id = setTimeout(() => {
        reject(new Error(message || `Timeout after ${ms}ms`));
      }, ms);
      // cleanup timeout if promise resolves first
      promise.finally(() => clearTimeout(id));
    }),
  ]);
}

/**
 * combines retry and timeout
 */
export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  retryOptions: Partial<RetryOptions> = {},
): Promise<T> {
  return withRetry(() => withTimeout(fn(), timeoutMs), retryOptions);
}

// timeout constants for different operations
export const AI_TIMEOUTS = {
  EMBEDDING_SINGLE: 30_000, // 30s for single embedding
  EMBEDDING_BATCH: 120_000, // 2min for batch embedding
  CHAT_STREAM: 60_000, // 60s for chat response start
  HEALTH_CHECK: 5_000, // 5s for health check
  OLLAMA_CONNECT: 5_000, // 5s for ollama connection
} as const;

// retry configs for different operations
export const AI_RETRY_CONFIGS = {
  EMBEDDING: { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 15000 },
  CHAT: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 5000 },
  HEALTH_CHECK: { maxRetries: 1, baseDelayMs: 500, maxDelayMs: 1000 },
} as const;
