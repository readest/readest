/**
 * Shared Babylon BGL test fixture loader.
 *
 * Points at a real Babylon glossary in `src/__tests__/fixtures/data/dicts/`:
 * "History and Geography" by Olivier TABARY, an English→French vocabulary
 * list (624 entries, cp1252 source/target, gzip payload at offset 0x69).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/data/dicts');

export const BGL_FIXTURE_PATH = path.join(FIXTURES_DIR, 'hist-geog-en-fr.bgl');
export const BGL_FIXTURE_NAME = 'hist-geog-en-fr.bgl';

async function readAsFile(filePath: string, name: string): Promise<File> {
  const bytes = await readFile(filePath);
  const buf = new Uint8Array(bytes.length);
  buf.set(bytes);
  return new File([buf], name);
}

export const readBglFile = () => readAsFile(BGL_FIXTURE_PATH, BGL_FIXTURE_NAME);
