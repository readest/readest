class EventDispatcher {
  private syncListeners: Map<string, Set<(event: CustomEvent) => boolean>>;
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
      this.syncListeners.set(event, new Set());
    }
    this.syncListeners.get(event)!.add(callback);
  }

  offSync(event: string, callback: (event: CustomEvent) => boolean): void {
    this.syncListeners.get(event)?.delete(callback);
  }

  dispatchSync(event: string, detail?: unknown): boolean {
    const listeners = this.syncListeners.get(event);
    if (listeners) {
      const customEvent = new CustomEvent(event, { detail });
      for (const listener of listeners) {
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
