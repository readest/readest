class EventDispatcher {
  private syncListeners: Map<string, Array<(event: CustomEvent) => boolean>>;
  private asyncListeners: Map<string, Set<(event: CustomEvent) => Promise<void> | void>>;

  constructor() {
    this.syncListeners = new Map();
    this.asyncListeners = new Map();
  }

  on(event: string, callback: (event: CustomEvent) => Promise<void> | void): void {
    if (!this.asyncListeners.has(event)) {
      this.asyncListeners.set(event, new Set());
    }
    this.asyncListeners.get(event)!.add(callback);
  }

  off(event: string, callback: (event: CustomEvent) => Promise<void> | void): void {
    this.asyncListeners.get(event)?.delete(callback);
  }

  async dispatch(event: string, detail?: unknown): Promise<void> {
    const listeners = this.asyncListeners.get(event);
    if (listeners) {
      const customEvent = new CustomEvent(event, { detail });
      for (const listener of listeners) {
        await listener(customEvent);
      }
    }
  }

  onSync(event: string, callback: (event: CustomEvent) => boolean): void {
    if (!this.syncListeners.has(event)) {
      this.syncListeners.set(event, []);
    }
    this.syncListeners.get(event)!.push(callback);
  }

  offSync(event: string, callback: (event: CustomEvent) => boolean): void {
    const listeners = this.syncListeners.get(event);
    if (listeners) {
      this.syncListeners.set(
        event,
        listeners.filter((listener) => listener !== callback),
      );
    }
  }

  dispatchSync(event: string, detail?: unknown): boolean {
    const listeners = this.syncListeners.get(event);
    if (listeners) {
      const customEvent = new CustomEvent(event, { detail });
      for (const listener of [...listeners].reverse()) {
        const consumed = listener(customEvent);
        if (consumed) {
          return true;
        }
      }
    }
    return false;
  }
}

export const eventDispatcher = new EventDispatcher();

// ─── Settled events (one-shot, replay-on-subscribe) ────────────────────
//
// `markSettled` records that a one-shot event has fired and dispatches
// it to currently-subscribed listeners. Subsequent calls with the same
// name are no-ops — the event has already settled.
//
// `onSettled` subscribes a listener that fires exactly once: synchronously
// if the event has already settled (replay), otherwise on the next
// markSettled. The listener auto-unsubscribes after firing. Returns an
// unsubscribe function that cancels the subscription if the event hasn't
// settled yet.
//
// Use case: boot-readiness signals like "replica-sync-ready" or
// "transferManager-ready" where late subscribers must still observe
// that the milestone happened. The plain eventDispatcher fires-and-
// forgets, so a listener that subscribes after dispatch misses it
// forever.

const settledEvents = new Map<string, unknown>();

export const markSettled = async (name: string, detail?: unknown): Promise<void> => {
  if (settledEvents.has(name)) return;
  settledEvents.set(name, detail);
  await eventDispatcher.dispatch(name, detail);
};

export const onSettled = <T = unknown>(
  name: string,
  listener: (detail: T) => void,
): (() => void) => {
  if (settledEvents.has(name)) {
    listener(settledEvents.get(name) as T);
    return () => {};
  }
  let invoked = false;
  const wrapped = (event: CustomEvent) => {
    if (invoked) return;
    invoked = true;
    eventDispatcher.off(name, wrapped);
    listener(event.detail as T);
  };
  eventDispatcher.on(name, wrapped);
  return () => {
    if (!invoked) {
      eventDispatcher.off(name, wrapped);
    }
  };
};

/** Test seam — clear the settled-events registry between specs. */
export const __resetSettledEventsForTests = (): void => {
  settledEvents.clear();
};
