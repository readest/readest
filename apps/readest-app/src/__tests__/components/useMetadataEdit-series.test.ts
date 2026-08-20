import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BookMetadata } from '@/libs/document';
import { useMetadataEdit } from '@/components/metadata/useMetadataEdit';

const metadata = { title: 'Book', author: 'Author' } as BookMetadata;
// Stable reference: the hook resyncs editedMeta on the metadata identity.
const indexedMetadata = { ...metadata, seriesIndex: 2 } as BookMetadata;
const noTags: string[] = [];

// The Series Index / Total inputs hand over e.target.value, a string. Stored
// as-is it persists (and syncs) as "2", and every `typeof seriesIndex ===
// 'number'` consumer (formatSeries, the #5776 data attributes) then silently
// drops the index for exactly the books the user bothered to edit.
describe('useMetadataEdit numeric series fields', () => {
  it('stores the series index as a number', () => {
    const { result } = renderHook(() => useMetadataEdit(metadata, noTags));

    act(() => {
      result.current.handleFieldChange('seriesIndex', '2');
    });

    expect(result.current.editedMeta.seriesIndex).toBe(2);
  });

  it('keeps fractional indices', () => {
    const { result } = renderHook(() => useMetadataEdit(metadata, noTags));

    act(() => {
      result.current.handleFieldChange('seriesIndex', '1.5');
    });

    expect(result.current.editedMeta.seriesIndex).toBe(1.5);
  });

  it('clears the index when the input is emptied', () => {
    const { result } = renderHook(() => useMetadataEdit(indexedMetadata, noTags));

    act(() => {
      result.current.handleFieldChange('seriesIndex', '');
    });

    expect(result.current.editedMeta.seriesIndex).toBeUndefined();
  });

  it('stores the series total as a number', () => {
    const { result } = renderHook(() => useMetadataEdit(metadata, noTags));

    act(() => {
      result.current.handleFieldChange('seriesTotal', '7');
    });

    expect(result.current.editedMeta.seriesTotal).toBe(7);
  });
});
