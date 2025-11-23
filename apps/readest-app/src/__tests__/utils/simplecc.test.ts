import { describe, test, expect, beforeAll } from 'vitest';
import init, { simplecc } from '@simplecc/simplecc_wasm';
import { readFile } from 'fs/promises';
import { join } from 'path';

describe.concurrent('suite', () => {
  beforeAll(async () => {
    const wasmPath = join(process.cwd(), 'public/vendor/simplecc/simplecc_wasm_bg.wasm');
    const wasmBuffer = await readFile(wasmPath);
    await init(wasmBuffer);
    await init();
  });

  test('basic s2t and t2s', () => {
    expect(simplecc('发财了去植发', 's2t')).toBe('發財了去植髮');
    expect(simplecc('發財了去植髮', 't2s')).toBe('发财了去植发');
  });

  test('s2tw - Simplified to Traditional (Taiwan)', () => {
    expect(simplecc('鼠标', 's2tw')).toBe('鼠標');
    expect(simplecc('软件', 's2tw')).toBe('軟件');
    expect(simplecc('信息', 's2tw')).toBe('信息');
  });

  test('s2twp - Simplified to Traditional (Taiwan) with phrases', () => {
    expect(simplecc('计算机', 's2twp')).toBe('計算機');
    expect(simplecc('打印机', 's2twp')).toBe('印表機');
    expect(simplecc('激光', 's2twp')).toBe('雷射');
  });

  test('tw2s - Traditional (Taiwan) to Simplified', () => {
    expect(simplecc('滑鼠', 'tw2s')).toBe('滑鼠');
    expect(simplecc('軟體', 'tw2s')).toBe('软体');
    expect(simplecc('資訊', 'tw2s')).toBe('资讯');
  });

  test('tw2sp - Traditional (Taiwan) to Simplified with phrases', () => {
    expect(simplecc('電腦', 'tw2sp')).toBe('电脑');
    expect(simplecc('印表機', 'tw2sp')).toBe('打印机');
    expect(simplecc('雷射', 'tw2sp')).toBe('激光');
  });
});
