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

/** Real PDF with selectable text, used for native PDF.js interaction coverage. */
export const SAMPLE_PDF = path.join(
  fixturesDir,
  '../../src/__tests__/fixtures/data/sample-paper.pdf',
);

/** Same-named source paired with SAMPLE_PDF during multi-file import. */
export const SAMPLE_TEX = path.join(
  fixturesDir,
  '../../src/__tests__/fixtures/data/sample-paper.tex',
);

/** Minimal valid SyncTeX map covering page 1 and pointing to source line 4. */
export const SAMPLE_SYNCTEX = path.join(
  fixturesDir,
  '../../src/__tests__/fixtures/data/sample-paper.synctex',
);
