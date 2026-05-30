/**
 * Tiny abort-signal helpers used by the runtime. Compose the
 * caller's signal with a runtime-local one so internal cancellation
 * (e.g. context_overflow retry) doesn't propagate out to the caller
 * unless the caller themselves cancelled.
 */

/**
 * Returns an AbortSignal that fires when EITHER input fires. The
 * `cleanup` function unsubscribes listeners so we don't leak across
 * long-lived consumers.
 */
export function anySignal(...signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; fn: () => void }> = [];

  for (const sig of signals) {
    if (!sig) continue;
    if (sig.aborted) {
      controller.abort(sig.reason);
      break;
    }
    const fn = (): void => controller.abort(sig.reason);
    sig.addEventListener('abort', fn, { once: true });
    listeners.push({ signal: sig, fn });
  }

  const cleanup = (): void => {
    for (const { signal, fn } of listeners) signal.removeEventListener('abort', fn);
  };
  return { signal: controller.signal, cleanup };
}

/**
 * Type guard so the runtime can distinguish AbortError-shaped exceptions
 * from real errors without doing instanceof against DOMException (which
 * isn't always available in Node).
 */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}
