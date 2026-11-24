/** Lets a queued cancellation reach a worker between two of its inferences. */
export const yieldToCancellation = async (signal?: AbortSignal): Promise<void> => {
  if (typeof document === 'undefined') {
    // scheduler.yield() would prioritize its own continuation.
    const { scheduler } = globalThis as typeof globalThis & {
      scheduler?: { postTask?: (callback: () => void) => Promise<void> };
    };
    if (scheduler?.postTask) await scheduler.postTask(() => undefined);
    else await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  signal?.throwIfAborted();
};
