/**
 * Shared Slob (Aard 2) test fixture loader.
 *
 * Points at the real FreeDict English-Dutch slob in
 * `src/__tests__/fixtures/data/dicts/`. ~7,700 refs, zlib-compressed bins,
 * `text/html;charset=utf-8` content for headwords and `text/css` for the
 * bundled stylesheet (`~/css/default.css`).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/data/dicts');

export const SLOB_FIXTURE_PATH = path.join(FIXTURES_DIR, 'eng-nld.slob');
export const SLOB_FIXTURE_NAME = 'eng-nld.slob';

async function readAsFile(filePath: string, name: string): Promise<File> {
  const bytes = await readFile(filePath);
  const buf = new Uint8Array(bytes.length);
  buf.set(bytes);
  return new File([buf], name);
}

export const readSlobFile = () => readAsFile(SLOB_FIXTURE_PATH, SLOB_FIXTURE_NAME);
