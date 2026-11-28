import init, { cut, cut_for_search } from 'jieba-wasm';

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

// The word around text[start, end), as [start, end) offsets, or null when the
// span crosses words. jieba keeps compounds whole (独立思考, 北京大学) where iOS
// and desktop select their parts (思考, 大学), so a longer word is split into
// the dictionary words search mode finds in it, left to right and longest
// first. Characters none of them covers stay together.
const findZhWord = (text: string, start: number, end: number): [number, number] | null => {
  let wordStart = 0;
  for (const word of cut(text, true)) {
    const wordEnd = wordStart + word.length;
    if (end <= wordEnd) {
      if (start < wordStart) return null;
      const parts = cut_for_search(word, true).filter((part) => part.length < word.length);
      const bounds = new Set([0, word.length]);
      for (let i = 0; i < word.length; ) {
        const part = parts
          .filter((p) => word.startsWith(p, i))
          .reduce((a, b) => (b.length > a.length ? b : a), '');
        if (!part) {
          i++;
          continue;
        }
        bounds.add(i).add(i + part.length);
        i += part.length;
      }
      const sorted = [...bounds].sort((a, b) => a - b);
      for (let k = 1; k < sorted.length; k++) {
        const pieceStart = wordStart + sorted[k - 1]!;
        const pieceEnd = wordStart + sorted[k]!;
        if (start >= pieceStart && end <= pieceEnd) return [pieceStart, pieceEnd];
      }
      return [wordStart, wordEnd];
    }
    wordStart = wordEnd;
  }
  return null;
};

export { initJieba, isJiebaReady, cutZh, findZhWord };
