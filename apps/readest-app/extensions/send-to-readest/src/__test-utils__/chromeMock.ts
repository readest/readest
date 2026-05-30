/**
 * Stubbed `chrome.*` surface for vitest. Only the APIs the extension shell
 * actually touches at module-load or test-execution time are filled in.
 *
 * Promise-returning shape matches MV3 (chrome.storage.local.get returns a
 * Promise<Record<string, unknown>>, not a callback). Spies are exposed so
 * tests can assert call counts / arguments.
 */
import { vi, type Mock } from 'vitest';

export interface ChromeMock {
  storage: {
    local: {
      get: Mock;
      set: Mock;
      remove: Mock;
    };
    session: {
      get: Mock;
      set: Mock;
      remove: Mock;
    };
  };
  action: {
    setBadgeText: Mock;
    setBadgeBackgroundColor: Mock;
  };
  tabs: {
    query: Mock;
    get: Mock;
    create: Mock;
    sendMessage: Mock;
  };
  scripting: {
    executeScript: Mock;
  };
  runtime: {
    sendMessage: Mock;
    connect: Mock;
    onMessage: { addListener: Mock };
    onConnect: { addListener: Mock };
    lastError: chrome.runtime.LastError | undefined;
  };
  i18n: {
    getUILanguage: Mock;
  };
}

/** Reset all spies and seed a fresh `storage.local` and `storage.session`. */
export function installChromeMock(): ChromeMock {
  const localStore = new Map<string, unknown>();
  const sessionStore = new Map<string, unknown>();

  const store = (s: Map<string, unknown>) => ({
    get: vi.fn(async (key?: string | string[]) => {
      if (key === undefined) {
        return Object.fromEntries(s);
      }
      const keys = Array.isArray(key) ? key : [key];
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        if (s.has(k)) out[k] = s.get(k);
      }
      return out;
    }),
    set: vi.fn(async (entries: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(entries)) s.set(k, v);
    }),
    remove: vi.fn(async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) s.delete(k);
    }),
  });

  const chromeMock: ChromeMock = {
    storage: {
      local: store(localStore),
      session: store(sessionStore),
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
    tabs: {
      query: vi.fn(async () => []),
      get: vi.fn(async () => null),
      create: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
    },
    scripting: {
      executeScript: vi.fn(async () => [{ frameId: 0, documentId: 'x' }]),
    },
    runtime: {
      sendMessage: vi.fn(async () => undefined),
      connect: vi.fn(() => ({
        name: '',
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
      })),
      onMessage: { addListener: vi.fn() },
      onConnect: { addListener: vi.fn() },
      lastError: undefined,
    },
    i18n: {
      getUILanguage: vi.fn(() => 'en'),
    },
  };

  (globalThis as unknown as { chrome: ChromeMock }).chrome = chromeMock;
  return chromeMock;
}

export function uninstallChromeMock(): void {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
}
