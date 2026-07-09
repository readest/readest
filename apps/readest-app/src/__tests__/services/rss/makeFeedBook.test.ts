import { describe, expect, it } from 'vitest';
import { makeFeedBook } from '@/services/rss/makeFeedBook';
import { CFI } from '@/libs/document';
import type { FeedManifest } from '@/services/rss/feedManifest';

const manifest: FeedManifest = {
  feedUrl: 'u',
  title: 'Blog',
  entries: [
    { id: 'a', slot: 0, title: 'A', link: 'https://x/a', read: false },
    { id: 'c', slot: 2, title: 'C', link: 'https://x/c', read: false },
  ],
};

describe('makeFeedBook', () => {
  it('builds one section per entry in slot order with fromIndex(slot) CFI', async () => {
    const book = await makeFeedBook(manifest, async (e) => `<p>body ${e.id}</p>`);
    expect(book.sections).toHaveLength(2);
    expect(book.sections[0]!.cfi).toBe(CFI.fake.fromIndex(0));
    expect(book.sections[1]!.cfi).toBe(CFI.fake.fromIndex(2)); // slot 2, not index 1
    expect(book.metadata.title).toBe('Blog');
    const doc0 = await book.sections[0]!.createDocument();
    expect(doc0.body.textContent).toContain('body a');
  });
});
