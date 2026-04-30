/**
 * Shared MDict test fixture loader.
 *
 * Tests and benchmarks point at the same on-disk bundle in
 * `src/__tests__/fixtures/data/dicts/`. Drop in any real `.mdx` / `.mdd`
 * pair (rename to `mdict-en-en.*`) to exercise the production code path
 * against real-world data without changing test code.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/data/dicts');

export const MDX_FIXTURE_PATH = path.join(FIXTURES_DIR, 'mdict-en-en.mdx');
export const MDD_FIXTURE_PATH = path.join(FIXTURES_DIR, 'mdict-en-en.mdd');

export const MDX_FIXTURE_NAME = 'mdict-en-en.mdx';
export const MDD_FIXTURE_NAME = 'mdict-en-en.mdd';

/** Read the .mdx as a fresh-ArrayBuffer-backed File suitable for BlobScanner. */
export async function readMdxFile(): Promise<File> {
  const bytes = await readFile(MDX_FIXTURE_PATH);
  const buf = new Uint8Array(bytes.length);
  buf.set(bytes);
  return new File([buf], MDX_FIXTURE_NAME);
}

/** Read the .mdd as a fresh-ArrayBuffer-backed File. */
export async function readMddFile(): Promise<File> {
  const bytes = await readFile(MDD_FIXTURE_PATH);
  const buf = new Uint8Array(bytes.length);
  buf.set(bytes);
  return new File([buf], MDD_FIXTURE_NAME);
}
