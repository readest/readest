import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDir = path.dirname(fileURLToPath(import.meta.url));

/** Synthetic plain-text book — fast, used for basic import coverage. */
export const SAMPLE_TXT = path.join(fixturesDir, 'books/readest-e2e-sample.txt');

/**
 * A real EPUB ("Alice's Adventures in Wonderland") from the unit-test
 * fixtures. Has multiple chapters and substantial prose, so it exercises
 * reading and annotation flows realistically.
 */
export const SAMPLE_EPUB = path.join(
  fixturesDir,
  '../../src/__tests__/fixtures/data/sample-alice.epub',
);
