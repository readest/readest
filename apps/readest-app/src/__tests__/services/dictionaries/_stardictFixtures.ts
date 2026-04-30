/**
 * Shared StarDict test fixture loader.
 *
 * Points at a real bundle in `src/__tests__/fixtures/data/dicts/`. Drop in
 * any real StarDict bundle (rename the four files to `cmudict.*`) to
 * exercise the production code path against your own data.
 *
 * The default fixture (CMU American English spelling, 105,626 entries,
 * `sametypesequence=m`) is small enough to keep the suite fast but large
 * enough to exercise multi-block reads.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/data/dicts');

export const IFO_FIXTURE_PATH = path.join(FIXTURES_DIR, 'cmudict.ifo');
export const IDX_FIXTURE_PATH = path.join(FIXTURES_DIR, 'cmudict.idx');
export const DICT_FIXTURE_PATH = path.join(FIXTURES_DIR, 'cmudict.dict.dz');

export const IFO_FIXTURE_NAME = 'cmudict.ifo';
export const IDX_FIXTURE_NAME = 'cmudict.idx';
export const DICT_FIXTURE_NAME = 'cmudict.dict.dz';

async function readAsFile(filePath: string, name: string): Promise<File> {
  const bytes = await readFile(filePath);
  const buf = new Uint8Array(bytes.length);
  buf.set(bytes);
  return new File([buf], name);
}

export const readIfoFile = () => readAsFile(IFO_FIXTURE_PATH, IFO_FIXTURE_NAME);
export const readIdxFile = () => readAsFile(IDX_FIXTURE_PATH, IDX_FIXTURE_NAME);
export const readDictFile = () => readAsFile(DICT_FIXTURE_PATH, DICT_FIXTURE_NAME);
