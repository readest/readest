/**
 * Long TOC headings must wrap onto extra lines instead of being cut off with
 * an ellipsis (issue #5852). English section titles routinely exceed one line
 * on a phone-width sidebar, and there is no other way in the app to read the
 * full heading.
 *
 * Needs real layout and real Tailwind, so it runs as a browser test.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

import type { TOCItem } from '@/libs/document';

vi.mock('@/utils/misc', () => ({
  getContentMd5: (s: string) => s,
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

const { StaticListRow } = await import('@/app/reader/components/sidebar/TOCItem');
await import('@/styles/globals.css');

afterEach(() => cleanup());

const LONG_LABEL =
  'Chapter Seven: In Which the Author Reflects at Considerable Length on the ' +
  'Nature of Memory, the Passage of Time, and the Peculiar Habits of Cats';
const UNBREAKABLE_LABEL = 'Supercalifragilisticexpialidocious'.repeat(4);

// A phone-width sidebar tree, the case the issue was filed against.
const TREE_WIDTH = 300;

const renderRow = (label: string) => {
  const item: TOCItem = {
    id: 1,
    label,
    href: 'ch7.html',
    index: 6,
    subitems: [{ id: 2, label: 'Section', href: 'ch7-1.html', index: 7 }],
  };
  render(
    <div role='tree' style={{ width: TREE_WIDTH }}>
      <StaticListRow
        bookKey='book1'
        flatItem={{ item, depth: 0, index: 0, isExpanded: false }}
        activeHref={null}
        onToggleExpand={vi.fn()}
        onItemClick={vi.fn()}
      />
    </div>,
  );
  const row = screen.getByRole('treeitem');
  const labelEl = screen.getByText(label);
  const pageEl = screen.getByText('7');
  return { row, labelEl, pageEl };
};

const lineHeight = (el: HTMLElement) => parseFloat(getComputedStyle(el).lineHeight);

describe('TOC heading wrapping', () => {
  it('lets a long heading flow onto several lines instead of truncating it', () => {
    const { labelEl } = renderRow(LONG_LABEL);
    const rect = labelEl.getBoundingClientRect();
    expect(rect.height).toBeGreaterThanOrEqual(2 * lineHeight(labelEl));
    // Nothing of the text is clipped away.
    expect(labelEl.scrollWidth).toBeLessThanOrEqual(labelEl.clientWidth + 1);
  });

  it('keeps the page number inside the row beside a wrapped heading', () => {
    const { row, labelEl, pageEl } = renderRow(LONG_LABEL);
    const rowRect = row.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();
    const labelRect = labelEl.getBoundingClientRect();
    expect(pageRect.right).toBeLessThanOrEqual(rowRect.right + 0.5);
    expect(labelRect.right).toBeLessThanOrEqual(pageRect.left + 0.5);
  });

  it('breaks an unbreakable heading rather than pushing the page number out', () => {
    const { row, labelEl, pageEl } = renderRow(UNBREAKABLE_LABEL);
    const rowRect = row.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();
    const labelRect = labelEl.getBoundingClientRect();
    expect(labelRect.height).toBeGreaterThanOrEqual(2 * lineHeight(labelEl));
    expect(pageRect.right).toBeLessThanOrEqual(rowRect.right + 0.5);
    expect(labelRect.right).toBeLessThanOrEqual(pageRect.left + 0.5);
  });
});
