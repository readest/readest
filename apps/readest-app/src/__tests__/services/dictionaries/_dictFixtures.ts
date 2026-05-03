/**
 * Shared DICT (dictd) test fixture loader.
 *
 * Points at the real FreeDict English-Dutch bundle in
 * `src/__tests__/fixtures/data/dicts/`. 7,720 entries, dictzip-compressed
 * body, plain UTF-8 plain-text definitions — small enough for fast tests
 * but large enough to exercise multi-chunk reads.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/data/dicts');

export const INDEX_FIXTURE_PATH = path.join(FIXTURES_DIR, 'freedict-eng-nld.index');
export const DICT_FIXTURE_PATH = path.join(FIXTURES_DIR, 'freedict-eng-nld.dict.dz');

export const INDEX_FIXTURE_NAME = 'freedict-eng-nld.index';
export const DICT_FIXTURE_NAME = 'freedict-eng-nld.dict.dz';

async function readAsFile(filePath: string, name: string): Promise<File> {
  const bytes = await readFile(filePath);
  const buf = new Uint8Array(bytes.length);
  buf.set(bytes);
  return new File([buf], name);
}

export const readIndexFile = () => readAsFile(INDEX_FIXTURE_PATH, INDEX_FIXTURE_NAME);
export const readDictFile = () => readAsFile(DICT_FIXTURE_PATH, DICT_FIXTURE_NAME);
