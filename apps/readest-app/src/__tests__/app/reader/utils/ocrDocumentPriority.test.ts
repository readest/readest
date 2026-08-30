import { describe, expect, it } from 'vitest';

import { prioritizeCurrentDocument } from '@/app/reader/utils/ocrDocumentPriority';

describe('prioritizeCurrentDocument', () => {
  it('moves the primary page first without disturbing the remaining order', () => {
    const documents = [{ index: 5 }, { index: 6 }, { index: 7 }, { index: 8 }];

    expect(prioritizeCurrentDocument(documents, 7).map(({ index }) => index)).toEqual([7, 5, 6, 8]);
    expect(documents.map(({ index }) => index)).toEqual([5, 6, 7, 8]);
  });

  it('preserves order when the primary page is unavailable', () => {
    const documents = [{ index: 2 }, { index: 3 }];

    expect(prioritizeCurrentDocument(documents, undefined)).toEqual(documents);
    expect(prioritizeCurrentDocument(documents, 9)).toEqual(documents);
  });
});
