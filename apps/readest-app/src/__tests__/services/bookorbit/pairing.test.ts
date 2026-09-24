import { describe, expect, it } from 'vitest';
import { BOOKORBIT_PAIRED_FILE_ID, buildBookOrbitPairing } from '@/services/bookorbit/pairing';
import { MANIFEST_SCHEMA, SUPPORTED_SCHEMA_VERSION } from '@/services/bookorbit/manifest';
import type { BookOrbitManifest } from '@/services/bookorbit/manifest';

const manifest: BookOrbitManifest = {
  schema: MANIFEST_SCHEMA,
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  revision: 'f'.repeat(64),
  book: { id: 8, title: 'Sherlock', authors: ['Doyle'], narrators: ['Reader'] },
  assets: [
    { assetId: 'aud_0', sequence: 0, format: 'mp3', durationMs: 100_000, sizeBytes: 1, etag: 'a' },
    { assetId: 'aud_1', sequence: 1, format: 'mp3', durationMs: 200_000, sizeBytes: 1, etag: 'b' },
  ],
  chapters: [
    {
      id: 'ch_a',
      title: 'One',
      assetId: 'aud_0',
      sequence: 0,
      startMs: 0,
      endMs: 100_000,
      assetOffsetMs: 0,
    },
    {
      id: 'ch_b',
      title: 'Two',
      assetId: 'aud_1',
      sequence: 1,
      startMs: 100_000,
      endMs: 300_000,
      assetOffsetMs: 0,
    },
  ],
};

describe('buildBookOrbitPairing', () => {
  // Mirrors the Audiobookshelf pairing: one virtual file whose chapters are
  // timed on the book's global timeline, with the track list carried along so
  // playback can map that timeline onto the server's assets.
  it('builds a single virtual file over the whole book', () => {
    const pairing = buildBookOrbitPairing(manifest, ['c1', 'c2']);

    expect(pairing.files).toEqual([
      {
        id: BOOKORBIT_PAIRED_FILE_ID,
        name: 'Sherlock',
        path: 'bookorbit://8',
        duration: 300,
      },
    ]);
    expect(pairing.narrator).toBe('Reader');
  });

  it('times chapters globally against that file', () => {
    const pairing = buildBookOrbitPairing(manifest, ['c1', 'c2']);

    expect(pairing.chapters).toEqual([
      { id: 'ch_a', fileId: BOOKORBIT_PAIRED_FILE_ID, label: 'One', start: 0, end: 100 },
      { id: 'ch_b', fileId: BOOKORBIT_PAIRED_FILE_ID, label: 'Two', start: 100, end: 300 },
    ]);
  });

  // The whole point of auto-pairing: the ebook and the audio are the same
  // BookOrbit book, so chapter 1 is chapter 1 and the user need not be asked.
  it('maps ebook chapters to audio chapters in order', () => {
    const pairing = buildBookOrbitPairing(manifest, ['c1', 'c2']);

    expect(pairing.mappings).toEqual([
      { ebookChapterId: 'c1', audioChapterId: 'ch_a' },
      { ebookChapterId: 'c2', audioChapterId: 'ch_b' },
    ]);
  });

  it('carries the track list so playback can reach the assets', () => {
    const pairing = buildBookOrbitPairing(manifest, ['c1', 'c2']);

    expect(pairing.source).toEqual({
      kind: 'bookorbit',
      bookId: 8,
      tracks: [
        {
          index: 0,
          startOffset: 0,
          duration: 100,
          contentUrl: '/api/v1/audiobooks/8/assets/aud_0/content',
        },
        {
          index: 1,
          startOffset: 100,
          duration: 200,
          contentUrl: '/api/v1/audiobooks/8/assets/aud_1/content',
        },
      ],
    });
  });

  // An EPUB TOC normally opens with front matter and nests sub-sections, so a
  // mismatched count means first-to-first would shift every chapter: the
  // titlepage would take audio chapter 1 and chapter 1 would narrate the
  // third. Better to map nothing and let the dialog ask for the anchor.
  it('refuses to guess when the chapter counts disagree', () => {
    expect(buildBookOrbitPairing(manifest, ['c1', 'c2', 'c3']).mappings).toEqual([]);
    expect(buildBookOrbitPairing(manifest, ['c1']).mappings).toEqual([]);
  });

  it('still carries the files and chapters so the dialog opens pre-populated', () => {
    const pairing = buildBookOrbitPairing(manifest, ['c1', 'c2', 'c3']);

    expect(pairing.files).toHaveLength(1);
    expect(pairing.chapters).toHaveLength(2);
    expect(pairing.source).toMatchObject({ kind: 'bookorbit', bookId: 8 });
  });

  it('returns no mappings when the ebook has no chapters to map', () => {
    expect(buildBookOrbitPairing(manifest, []).mappings).toEqual([]);
  });
});

// `manifestChapters` sorts by sequence while `manifest.chapters` keeps the
// server's order, so indexing into the raw array paired a chapter's title and
// timing with a different chapter's id whenever the server answered unsorted.
describe('buildBookOrbitPairing chapter identity', () => {
  it('keeps each chapter id with its own sequence when the server is unsorted', () => {
    const unsorted: BookOrbitManifest = {
      ...manifest,
      chapters: [...manifest.chapters].reverse(),
    };

    const paired = buildBookOrbitPairing(unsorted, ['c1', 'c2']);

    expect(paired.chapters.map((chapter) => chapter.id)).toEqual(
      manifest.chapters.map((chapter) => chapter.id),
    );
    expect(paired.chapters[0]!.label).toBe(manifest.chapters[0]!.title);
    expect(paired.chapters[0]!.start).toBe(manifest.chapters[0]!.startMs / 1000);
  });
});
