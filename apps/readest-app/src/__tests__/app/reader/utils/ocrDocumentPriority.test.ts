import { expect, it } from 'vitest';

import { prioritizeCurrentDocument } from '@/app/reader/utils/ocrDocumentPriority';

it('prioritizes the current fixed-layout page without reordering the background pages', () => {
  const pages = [0, 1, 2].map((index) => ({ index }));
  const renderer = { index: 2, getContents: () => pages };
  expect(prioritizeCurrentDocument(renderer).map((page) => page.index)).toEqual([2, 0, 1]);
  expect(
    prioritizeCurrentDocument({ ...renderer, primaryIndex: 1 }).map((page) => page.index),
  ).toEqual([1, 0, 2]);
  expect(pages.map((page) => page.index)).toEqual([0, 1, 2]);
});
