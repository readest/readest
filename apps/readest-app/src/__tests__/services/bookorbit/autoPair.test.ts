import { describe, expect, it, vi } from 'vitest';
import { autoPairBookOrbitAudiobook } from '@/services/bookorbit/autoPair';
import { MANIFEST_SCHEMA, SUPPORTED_SCHEMA_VERSION } from '@/services/bookorbit/manifest';
import type { BookOrbitManifest } from '@/services/bookorbit/manifest';
import type { Book } from '@/types/book';

const manifest: BookOrbitManifest = {
  schema: MANIFEST_SCHEMA,
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  revision: 'f'.repeat(64),
  book: { id: 8, title: 'Sherlock', authors: ['Doyle'], narrators: [] },
  assets: [
    { assetId: 'aud_0', sequence: 0, format: 'mp3', durationMs: 100_000, sizeBytes: 1, etag: 'a' },
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
  ],
};

const book = { hash: 'h1', title: 'Sherlock', format: 'EPUB' } as Book;

const makeDeps = (over: Partial<Parameters<typeof autoPairBookOrbitAudiobook>[0]> = {}) => {
  const saveBookConfig = vi.fn().mockResolvedValue(undefined);
  return {
    book,
    bookId: 8,
    loadManifest: vi.fn().mockResolvedValue(manifest),
    loadTocChapterIds: vi.fn().mockResolvedValue(['c1']),
    appService: {
      loadBookConfig: vi.fn().mockResolvedValue({ updatedAt: 1, viewSettings: {} }),
      saveBookConfig,
    },
    settings: {},
    ...over,
  } as never as Parameters<typeof autoPairBookOrbitAudiobook>[0] & {
    appService: { saveBookConfig: typeof saveBookConfig };
  };
};

describe('autoPairBookOrbitAudiobook', () => {
  it('writes the pairing into the book config and turns narration on', async () => {
    const deps = makeDeps();

    const paired = await autoPairBookOrbitAudiobook(deps);

    expect(paired).toBe(true);
    const [, config] = deps.appService.saveBookConfig.mock.calls[0]!;
    expect(config.audiobook?.source).toMatchObject({ kind: 'bookorbit', bookId: 8 });
    expect(config.audiobook?.mappings).toEqual([{ ebookChapterId: 'c1', audioChapterId: 'ch_a' }]);
    // Without this the pairing exists but the reader never narrates from it.
    expect(config.viewSettings?.ttsUseNarration).toBe(true);
  });

  // Re-importing must not silently discard a pairing the user adjusted by hand.
  it('leaves an existing pairing alone', async () => {
    const deps = makeDeps({
      appService: {
        loadBookConfig: vi.fn().mockResolvedValue({ audiobook: { version: 1 }, viewSettings: {} }),
        saveBookConfig: vi.fn(),
      },
    } as never);

    expect(await autoPairBookOrbitAudiobook(deps)).toBe(false);
    expect(deps.appService.saveBookConfig).not.toHaveBeenCalled();
  });

  // Best effort throughout: a server hiccup must never fail the import that
  // triggered it -- the user still gets their ebook, just unpaired.
  it('reports failure instead of throwing when the manifest is unavailable', async () => {
    const deps = makeDeps({
      loadManifest: vi.fn().mockRejectedValue(new Error('offline')),
    } as never);

    expect(await autoPairBookOrbitAudiobook(deps)).toBe(false);
    expect(deps.appService.saveBookConfig).not.toHaveBeenCalled();
  });

  it('does not pair when the ebook has no chapters to map', async () => {
    const deps = makeDeps({ loadTocChapterIds: vi.fn().mockResolvedValue([]) } as never);

    expect(await autoPairBookOrbitAudiobook(deps)).toBe(false);
    expect(deps.appService.saveBookConfig).not.toHaveBeenCalled();
  });
});
