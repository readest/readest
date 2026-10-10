import { describe, expect, it } from 'vitest';

import { resolveNotebookTab } from '@/store/notebookStore';

describe('resolveNotebookTab', () => {
  it('falls back to Notes when the saved Handwriting tab has nothing to show', () => {
    // The tab bar hides the ink tab for a book without ink; staying on it would
    // strand the reader on an empty panel with no tab to switch back.
    expect(resolveNotebookTab('handwriting', false)).toBe('notes');
  });

  it('keeps the Handwriting tab while the book has ink', () => {
    expect(resolveNotebookTab('handwriting', true)).toBe('handwriting');
  });

  it('leaves the other tabs alone', () => {
    expect(resolveNotebookTab('ai', false)).toBe('ai');
    expect(resolveNotebookTab('notes', false)).toBe('notes');
  });
});
