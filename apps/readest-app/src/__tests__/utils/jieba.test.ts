import { describe, test, expect, beforeAll } from 'vitest';
// Import the web build directly. Vitest runs in Node, which would otherwise
// pick the `node` export — that build has no async `init()` and instantiates
// the WASM via Node FS. In production (Next.js / Tauri) the `browser` export
// is selected and matches what `src/utils/jieba.ts` uses.
import init, { cut, cut_all, cut_for_search, tokenize } from 'jieba-wasm/web';
import { readFile } from 'fs/promises';
import { join } from 'path';

describe.concurrent('jieba-wasm', () => {
  beforeAll(async () => {
    const wasmPath = join(process.cwd(), 'public/vendor/jieba/jieba_rs_wasm_bg.wasm');
    const wasmBuffer = await readFile(wasmPath);
    await init({ module_or_path: wasmBuffer });
  });

  test('cut - canonical README example', () => {
    expect(cut('我来到北京清华大学', true)).toEqual(['我', '来到', '北京', '清华大学']);
  });

  test('cut - HMM detects new compounds', () => {
    // 杭研 isn't in the dict; HMM should infer it as a compound.
    const tokens = cut('他来到了网易杭研大厦', true);
    expect(tokens).toContain('网易');
    expect(tokens).toContain('杭研');
    expect(tokens).toContain('大厦');
    expect(tokens.join('')).toBe('他来到了网易杭研大厦');
  });

  test('cut_all returns all possible word combinations', () => {
    const tokens = cut_all('我来到北京清华大学');
    expect(tokens).toContain('清华');
    expect(tokens).toContain('清华大学');
    expect(tokens).toContain('华大');
    expect(tokens).toContain('大学');
  });

  test('cut_for_search produces finer-grained tokens', () => {
    const tokens = cut_for_search('小明硕士毕业于中国科学院计算所', true);
    expect(tokens).toContain('小明');
    expect(tokens).toContain('硕士');
    expect(tokens).toContain('毕业');
    expect(tokens).toContain('中国');
    expect(tokens).toContain('科学');
    expect(tokens).toContain('科学院');
    expect(tokens).toContain('中国科学院');
    expect(tokens).toContain('计算');
    expect(tokens).toContain('计算所');
  });

  test('tokenize returns tokens with start/end offsets', () => {
    const tokens = tokenize('永和服装饰品有限公司', 'default', true);
    expect(tokens.length).toBeGreaterThan(0);
    for (const tok of tokens) {
      expect(typeof tok.word).toBe('string');
      expect(typeof tok.start).toBe('number');
      expect(typeof tok.end).toBe('number');
      expect(tok.end).toBeGreaterThan(tok.start);
    }
    // Recombining tokens by offset reproduces the original string.
    const combined = tokens
      .slice()
      .sort((a, b) => a.start - b.start)
      .map((t) => t.word)
      .join('');
    expect(combined).toBe('永和服装饰品有限公司');
  });

  describe('long passage from a Chinese book', () => {
    const sample =
      '文章采访了一名州警，他从理论上说明这些所谓的“无名车祸”有许多是起因于车内的昆虫：' +
      '黄蜂、蜜蜂，甚至也可能是蜘蛛或蛾子。驾驶人惊慌了，想要用力拍打虫子，或是摇下车窗让虫子出去。' +
      '很有可能是虫子蜇了他，也或许驾驶就是失去控制。无论如何轰然一声巨响……一切结束。' +
      '而那只昆虫，通常安然无恙，快活地嗡嗡叫着飞出冒烟失事的车外，找寻更适合的场所。';

    test('cut preserves the original characters when joined back', () => {
      const tokens = cut(sample, true);
      expect(tokens.join('')).toBe(sample);
    });

    test('cut splits the passage into a reasonable number of tokens', () => {
      const tokens = cut(sample, true);
      // Char length is ~170 — token count should be substantially less but
      // still on the order of dozens, never one token per char.
      expect(tokens.length).toBeGreaterThan(50);
      expect(tokens.length).toBeLessThan(sample.length);
    });

    test('cut recognizes domain-specific words', () => {
      const tokens = cut(sample, true);
      const set = new Set(tokens);
      const expected = [
        '文章',
        '采访',
        '一名',
        '理论',
        '所谓',
        '车祸',
        '车内',
        '昆虫',
        '黄蜂',
        '蜜蜂',
        '蜘蛛',
        '蛾子',
        '驾驶',
        '惊慌',
        '用力',
        '拍打',
        '虫子',
        '车窗',
        '失去',
        '控制',
        '无论如何',
        '一声',
        '巨响',
        '结束',
        '通常',
        '安然无恙',
        '快活地',
        '嗡嗡叫',
        '冒烟',
        '失事',
        '找寻',
        '场所',
      ];
      for (const word of expected) {
        expect(set.has(word), `expected token "${word}" in cut output`).toBe(true);
      }
    });

    test('cut keeps punctuation as standalone tokens', () => {
      const tokens = cut(sample, true);
      expect(tokens).toContain('，');
      expect(tokens).toContain('。');
      expect(tokens).toContain('：');
      expect(tokens).toContain('、');
    });
  });
});
