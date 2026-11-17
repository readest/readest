import { describe, expect, test } from 'vitest';

import { docIsVertical } from '@/app/reader/components/FootnotePopup';

// An EPUB may declare `primary-writing-mode: vertical-rl` in its own stylesheet
// and leave the reader's Writing Mode on 'auto', so `viewSettings.vertical` stays
// false while the note lays out vertically. Sizing the popup from the setting
// alone measured the note along the wrong axis and the box flipped between one
// line and one column every frame, above and below its anchor.
const fakeDoc = (writingMode: string, childMode?: string) =>
  ({
    body: {
      querySelector: () => (childMode ? { nodeType: 1 } : null),
    },
    defaultView: {
      getComputedStyle: (el: unknown) => ({
        writingMode: el && (el as { nodeType?: number }).nodeType === 1 ? childMode : writingMode,
      }),
    },
  }) as unknown as Document;

describe('docIsVertical', () => {
  test('reads vertical-rl from the note document', () => {
    expect(docIsVertical(fakeDoc('vertical-rl'))).toBe(true);
  });

  test('reads a horizontal note as horizontal', () => {
    expect(docIsVertical(fakeDoc('horizontal-tb'))).toBe(false);
  });

  // Some EPUBs put the writing mode on the first child of body instead of body.
  test('looks at the first child when body says horizontal', () => {
    expect(docIsVertical(fakeDoc('horizontal-tb', 'vertical-rl'))).toBe(true);
  });

  test('says nothing when there is no document to read', () => {
    expect(docIsVertical(null)).toBe(null);
    expect(docIsVertical(undefined)).toBe(null);
  });
});
