import init, { cut } from 'jieba-wasm';

let initialized = false;
let initPromise: Promise<void> | null = null;

const initJieba = async (): Promise<void> => {
  if (initialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        // No path: the glue falls back to `new URL('jieba_rs_wasm_bg.wasm',
        // import.meta.url)`, the copy the bundler already emits. Pointing it at
        // a public/vendor copy instead shipped the 4MB WASM twice.
        await init();
        initialized = true;
      } catch (e) {
        initPromise = null;
        throw e;
      }
    })();
  }
  return initPromise;
};

const isJiebaReady = (): boolean => initialized;

const cutZh = (text: string): string[] => {
  return cut(text, true);
};

export { initJieba, isJiebaReady, cutZh };
