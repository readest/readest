import init, { cut } from 'jieba-wasm';

let initialized = false;
let initPromise: Promise<void> | null = null;

const initJieba = async (): Promise<void> => {
  if (initialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await init('/vendor/jieba/jieba_rs_wasm_bg.wasm');
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
