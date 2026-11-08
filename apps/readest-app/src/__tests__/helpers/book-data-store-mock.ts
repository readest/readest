// For tests that mock '@/store/bookDataStore' with a hook returning stub getters:
// `vi.mock('@/store/bookDataStore', () => ({ ...bookDataStoreHooks(hook) }))` gives a
// useBookDataStore that takes selectors, and useBookData/useBookConfig read from the same stubs.
type Stubs = {
  getBookData?: (key: string) => Record<string, unknown> | null | undefined;
  getConfig?: (key: string | null) => unknown;
};
type Hook = ((...args: never[]) => unknown) & { getState?: () => unknown };

export const bookDataStoreHooks = <H extends Hook>(hook: H) => {
  const stubs = () => (hook.getState ? hook.getState() : (hook as () => unknown)()) as Stubs;
  const useBookDataStore = Object.assign(
    (selector?: (s: Stubs) => unknown) => (selector ? selector(stubs()) : stubs()),
    hook,
  );
  return {
    useBookDataStore,
    useBookData: (key: string | null) => {
      const data = key ? stubs().getBookData?.(key) : null;
      if (!data) return null;
      const { config: _config, ...rest } = data;
      return rest;
    },
    useBookConfig: (key: string | null) => stubs().getConfig?.(key) ?? null,
  };
};
