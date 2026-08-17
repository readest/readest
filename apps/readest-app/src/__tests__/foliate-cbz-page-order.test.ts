// Regression test for #5745: a CBZ chapter split across folders that share a
// chapter number — `Chapter 0060/` and `Chapter 0060 (2)/` — rendered part 2
// before part 1. The image paths were flattened and sorted as plain strings,
// and a space (0x20) sorts before a slash (0x2F), so
// `Chapter 0060 (2)/001.jpg` < `Chapter 0060/001.jpg`. Pages must instead be
// ordered per path segment so a folder that is a prefix of a sibling folder
// sorts first, with numeric-aware comparison inside each segment.
import { describe, expect, it } from 'vitest';

import { makeComicBook } from 'foliate-js/comic-book.js';

const makeLoader = (filenames: string[]) => ({
  entries: filenames.map((filename) => ({ filename })),
  loadBlob: async () => new Blob(['x'], { type: 'image/jpeg' }),
  getSize: () => 1,
  getComment: async () => '',
});

const pageOrder = async (filenames: string[]): Promise<string[]> => {
  const book = await makeComicBook(makeLoader(filenames), new File([], 'test.cbz'));
  return book.sections.map((section: { id: string }) => section.id);
};

describe('CBZ page order (#5745)', () => {
  it('orders split chapter folders base-first, then (2), (3), (10)', async () => {
    const order = await pageOrder([
      'Chapter 0060 (10)/001.jpg',
      'Chapter 0060 (2)/001.jpg',
      'Chapter 0060 (2)/002.jpg',
      'Chapter 0060 (3)/001.jpg',
      'Chapter 0060/001.jpg',
      'Chapter 0060/002.jpg',
      'Chapter 0061/001.jpg',
    ]);
    expect(order).toEqual([
      'Chapter 0060/001.jpg',
      'Chapter 0060/002.jpg',
      'Chapter 0060 (2)/001.jpg',
      'Chapter 0060 (2)/002.jpg',
      'Chapter 0060 (3)/001.jpg',
      'Chapter 0060 (10)/001.jpg',
      'Chapter 0061/001.jpg',
    ]);
  });

  it('orders unpadded numeric page names numerically within a folder', async () => {
    const order = await pageOrder(['Chapter 0059/10.jpg', 'Chapter 0059/2.jpg']);
    expect(order).toEqual(['Chapter 0059/2.jpg', 'Chapter 0059/10.jpg']);
  });
});
