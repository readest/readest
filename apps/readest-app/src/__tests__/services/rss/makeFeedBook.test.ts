import { describe, expect, it } from 'vitest';
import { makeFeedBook } from '@/services/rss/makeFeedBook';
import { CFI } from '@/libs/document';
import type { FeedManifest } from '@/services/rss/feedManifest';

// Manifest with hash-style slots (non-sequential). Slot 7 is "older" (publishedAt earlier),
// slot 42 is "newer" (publishedAt later). Entries are in manifest order (42 first, 7 second)
// but should be sorted by date ascending in sections (7 first, 42 second).
const manifest: FeedManifest = {
  feedUrl: 'u',
  title: 'Blog',
  entries: [
    {
      id: 'a',
      slot: 42,
      title: 'A',
      link: 'https://x/a',
      read: false,
      publishedAt: '2024-01-02T00:00:00Z',
    },
    {
      id: 'c',
      slot: 7,
      title: 'C',
      link: 'https://x/c',
      read: false,
      publishedAt: '2024-01-01T00:00:00Z',
    },
  ],
};

describe('makeFeedBook', () => {
  it('builds one section per entry with correct CFIs (slot != array index)', async () => {
    const book = await makeFeedBook(manifest, async (e) => `<p>body ${e.id}</p>`);
    expect(book.sections).toHaveLength(2);
    // After date-ascending sort: slot-7 (C, older) is index 0, slot-42 (A, newer) is index 1
    expect(book.sections[0]!.cfi).toBe(CFI.fake.fromIndex(7));
    expect(book.sections[1]!.cfi).toBe(CFI.fake.fromIndex(42)); // slot 42, not index 1
    expect(book.metadata.title).toBe('Blog');
    const doc0 = await book.sections[0]!.createDocument();
    expect(doc0.body.textContent).toContain('body c'); // C is slot-7, date-first
  });

  it('sorts sections by publishedAt ascending (entries with date before undated)', async () => {
    const mixedManifest: FeedManifest = {
      feedUrl: 'u',
      title: 'Mixed',
      entries: [
        {
          id: 'newer',
          slot: 100,
          title: 'Newer',
          link: 'https://x/newer',
          read: false,
          publishedAt: '2024-02-01T00:00:00Z',
        },
        { id: 'undated', slot: 200, title: 'Undated', link: 'https://x/undated', read: false },
        {
          id: 'older',
          slot: 300,
          title: 'Older',
          link: 'https://x/older',
          read: false,
          publishedAt: '2024-01-01T00:00:00Z',
        },
      ],
    };
    const book = await makeFeedBook(mixedManifest, async (e) => `<p>body ${e.id}</p>`);
    expect(book.sections[0]!.id).toBe('300'); // older date first
    expect(book.sections[1]!.id).toBe('100'); // newer date second
    expect(book.sections[2]!.id).toBe('200'); // undated last
  });

  it('resolveCFI resolves by slot id, not array index', async () => {
    // slot-42 entry is at index 1 in manifest but becomes index 1 in sections too (after date sort),
    // but the key test: slot-7 entry maps to sections[0] by content, not by slot number ordering.
    const book = await makeFeedBook(manifest, async (e) => `<p>body ${e.id}</p>`);
    const bookWithResolve = book as unknown as {
      resolveCFI: (c: string) => { index: number; anchor: (doc: Document) => unknown };
    };
    expect(typeof bookWithResolve.resolveCFI).toBe('function');
    // slot-7 (C) is at array index 0 after date sort
    const result7 = bookWithResolve.resolveCFI(CFI.fake.fromIndex(7));
    expect(result7.index).toBe(0);
    // slot-42 (A) is at array index 1 after date sort
    const result42 = bookWithResolve.resolveCFI(CFI.fake.fromIndex(42));
    expect(result42.index).toBe(1);
  });
});
