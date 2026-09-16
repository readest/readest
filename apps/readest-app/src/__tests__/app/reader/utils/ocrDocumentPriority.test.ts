import { expect, it } from 'vitest';

import { prioritizeCurrentDocument } from '@/app/reader/utils/ocrDocumentPriority';

it('orders loaded pages outwards, favouring the next page at equal distance', () => {
  const pages = [0, 1, 2].map((index) => ({ index }));
  const renderer = { index: 2, getContents: () => pages };
  expect(prioritizeCurrentDocument(renderer).map((page) => page.index)).toEqual([2, 1, 0]);
  expect(
    prioritizeCurrentDocument({ ...renderer, primaryIndex: 1 }).map((page) => page.index),
  ).toEqual([1, 2, 0]);
  expect(pages.map((page) => page.index)).toEqual([0, 1, 2]);
});
