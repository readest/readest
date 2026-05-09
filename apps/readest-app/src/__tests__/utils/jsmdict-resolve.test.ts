import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MDX, MDD, BlobScanner } from 'js-mdict';

const MDX_PATH = path.resolve(
  __dirname,
  '../../../../../packages/js-mdict/tests/data/mini/mini.mdx',
);
const MDD_PATH = path.resolve(
  __dirname,
  '../../../../../packages/js-mdict/tests/data/mini/mini.mdd',
);

describe('js-mdict resolves from readest-app', () => {
  it('exports the expected symbols', () => {
    expect(typeof MDX).toBe('function');
    expect(typeof MDD).toBe('function');
    expect(typeof BlobScanner).toBe('function');
  });

  it('opens an mdx via Blob (lazy slicing)', async () => {
    const bytes = await readFile(MDX_PATH);
    const file = new Blob([bytes]);
    Object.defineProperty(file, 'name', { value: 'mini.mdx' });
    const mdx = await MDX.create(file as Blob);
    expect(mdx.keywordList.length).toBeGreaterThan(0);
    const result = await mdx.lookup('ask');
    expect(typeof result.definition).toBe('string');
    expect(result.keyText).toBe('ask');
  });

  it('opens an mdd via Blob and locates a real key', async () => {
    const bytes = await readFile(MDD_PATH);
    const file = new Blob([bytes]);
    Object.defineProperty(file, 'name', { value: 'mini.mdd' });
    const mdd = await MDD.create(file as Blob);
    expect(mdd.keywordList.length).toBeGreaterThan(0);
    const firstKey = mdd.keywordList[0]!.keyText;
    const located = await mdd.locate(firstKey);
    expect(located.keyText).toBe(firstKey);
  });
});
