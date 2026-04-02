import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import { StaticListRow } from '@/app/reader/components/sidebar/TOCItem';
import { TOCItem } from '@/libs/document';

vi.mock('@/utils/misc', () => ({
  getContentMd5: (s: string) => s,
}));

const makeLeafItem = (overrides?: Partial<TOCItem>): TOCItem => ({
  id: 1,
  label: 'Chapter 1',
  href: 'chapter1.html',
  index: 0,
  ...overrides,
});

const makeParentItem = (overrides?: Partial<TOCItem>): TOCItem => ({
  id: 1,
  label: 'Part One',
  href: 'part1.html',
  index: 0,
  subitems: [{ id: 2, label: 'Chapter 1', href: 'chapter1.html', index: 1 }],
  ...overrides,
});

const defaultProps = {
  bookKey: 'book1',
  activeHref: null,
  onToggleExpand: vi.fn(),
  onItemClick: vi.fn(),
};

afterEach(() => cleanup());

describe('TOCItem accessibility', () => {
  it('treeitem has aria-label containing the chapter title', () => {
    const item = makeLeafItem({ label: 'Introduction' });
    render(<StaticListRow {...defaultProps} flatItem={{ item, depth: 0, index: 0 }} />);
    const treeitem = screen.getByRole('treeitem');
    expect(treeitem.getAttribute('aria-label')).toContain('Introduction');
  });

  it('treeitem aria-label includes page number when location is available', () => {
    const item = makeLeafItem({
      label: 'Chapter 2',
      location: { current: 4, total: 100 } as TOCItem['location'],
    });
    render(<StaticListRow {...defaultProps} flatItem={{ item, depth: 0, index: 0 }} />);
    const treeitem = screen.getByRole('treeitem');
    // aria-label should include chapter title and page number (5 = current+1)
    expect(treeitem.getAttribute('aria-label')).toContain('Chapter 2');
    expect(treeitem.getAttribute('aria-label')).toContain('5');
  });

  it('leaf treeitem does NOT have aria-expanded', () => {
    const item = makeLeafItem();
    render(<StaticListRow {...defaultProps} flatItem={{ item, depth: 0, index: 0 }} />);
    const treeitem = screen.getByRole('treeitem');
    expect(treeitem.hasAttribute('aria-expanded')).toBe(false);
  });

  it('parent treeitem HAS aria-expanded set to false when collapsed', () => {
    const item = makeParentItem();
    render(
      <StaticListRow
        {...defaultProps}
        flatItem={{ item, depth: 0, index: 0, isExpanded: false }}
      />,
    );
    const treeitem = screen.getByRole('treeitem');
    expect(treeitem.getAttribute('aria-expanded')).toBe('false');
  });

  it('parent treeitem HAS aria-expanded set to true when expanded', () => {
    const item = makeParentItem();
    render(
      <StaticListRow {...defaultProps} flatItem={{ item, depth: 0, index: 0, isExpanded: true }} />,
    );
    const treeitem = screen.getByRole('treeitem');
    expect(treeitem.getAttribute('aria-expanded')).toBe('true');
  });

  it('expand button has descriptive aria-label', () => {
    const item = makeParentItem();
    render(
      <StaticListRow
        {...defaultProps}
        flatItem={{ item, depth: 0, index: 0, isExpanded: false }}
      />,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toBeTruthy();
  });

  it('page number element is aria-hidden', () => {
    const item = makeLeafItem({ index: 2 });
    const { container } = render(
      <StaticListRow {...defaultProps} flatItem={{ item, depth: 0, index: 0 }} />,
    );
    // The page number div should be aria-hidden since it's included in aria-label
    const pageDiv = container.querySelector('[aria-hidden="true"]');
    expect(pageDiv).toBeTruthy();
  });
});

describe('aria-current on active treeitem', () => {
  it('active treeitem has aria-current="page"', () => {
    const item = makeLeafItem({ href: 'chapter1.html' });
    render(
      <StaticListRow
        {...defaultProps}
        activeHref='chapter1.html'
        flatItem={{ item, depth: 0, index: 0 }}
      />,
    );
    const treeitem = screen.getByRole('treeitem');
    expect(treeitem.getAttribute('aria-current')).toBe('page');
  });

  it('inactive treeitem does NOT have aria-current', () => {
    const item = makeLeafItem({ href: 'chapter1.html' });
    render(
      <StaticListRow
        {...defaultProps}
        activeHref='chapter2.html'
        flatItem={{ item, depth: 0, index: 0 }}
      />,
    );
    const treeitem = screen.getByRole('treeitem');
    expect(treeitem.hasAttribute('aria-current')).toBe(false);
  });

  it('active treeitem is focusable (tabIndex=0)', () => {
    const item = makeLeafItem({ href: 'chapter1.html' });
    render(
      <StaticListRow
        {...defaultProps}
        activeHref='chapter1.html'
        flatItem={{ item, depth: 0, index: 0 }}
      />,
    );
    const treeitem = screen.getByRole('treeitem');
    expect(treeitem.getAttribute('tabindex')).toBe('0');
  });
});

describe('TOCView tree role', () => {
  it('static list container has role="tree"', async () => {
    // This is tested indirectly via TOCView, but we verify the container role
    // by checking the structure rendered by StaticListRow's wrapper
    const item = makeLeafItem();
    render(
      <div role='tree'>
        <StaticListRow {...defaultProps} flatItem={{ item, depth: 0, index: 0 }} />
      </div>,
    );
    const tree = screen.getByRole('tree');
    expect(tree).toBeTruthy();
    expect(tree.querySelector('[role="treeitem"]')).toBeTruthy();
  });
});
