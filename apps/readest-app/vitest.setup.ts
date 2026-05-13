import { beforeEach } from 'vitest';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(String(key)) ?? null;
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(String(key));
  }

  setItem(key: string, value: string) {
    this.store.set(String(key), String(value));
  }
}

const testLocalStorage = new MemoryStorage();

const installLocalStorage = () => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: testLocalStorage,
    configurable: true,
    writable: true,
  });

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: testLocalStorage,
      configurable: true,
      writable: true,
    });
  }
};

installLocalStorage();

beforeEach(() => {
  installLocalStorage();
  testLocalStorage.clear();
});

// matchMedia mock
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
