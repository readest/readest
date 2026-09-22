import { describe, expect, test, vi } from 'vitest';

// The wasm-bindgen glue defaults to `new URL('jieba_rs_wasm_bg.wasm', import.meta.url)`,
// which the bundler always emits into `_next/static/media`. Passing any other
// path ships the WASM a second time (Tauri embeds every file in `out/`).
const jiebaInit = vi.fn();
vi.mock('jieba-wasm', () => ({ default: jiebaInit, cut: vi.fn() }));

describe('jieba WASM init', () => {
  test('uses the bundler-emitted file', async () => {
    const { initJieba } = await import('@/utils/jieba');
    await initJieba();
    expect(jiebaInit).toHaveBeenCalledWith();
  });
});
