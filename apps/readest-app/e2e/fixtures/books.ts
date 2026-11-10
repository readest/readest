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

/** The same book as a 69-page PDF, for the fixed-layout renderer. */
export const SAMPLE_PDF = path.join(
  fixturesDir,
  '../../src/__tests__/fixtures/data/sample-alice.pdf',
);

/**
 * A 15 KB CC0 bilingual EPUB whose stylesheet is the point: every paragraph is
 * a `.paracol` holding a `.yuanwen` (original) and a `.yiwen` (translation),
 * laid out side by side under `@media (orientation: landscape)` and stacked
 * under `@media (orientation: portrait)`.
 *
 * Small enough to read in a diff-free zip, with no images, fonts or scripts,
 * so a failing assertion points at the reader rather than at the sample. Five
 * spine items (cover, colophon, three chapters) so TOC jumps land in prose.
 */
export const ADAPTIVE_EPUB = path.join(fixturesDir, 'books/orientation-bilingual.epub');
