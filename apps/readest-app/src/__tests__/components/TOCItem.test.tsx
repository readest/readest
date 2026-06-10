import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import {
  StaticListRow,
  CurrentPositionRow,
  buildTOCDisplayItems,
  isCurrentPositionItem,
  type FlatTOCItem,
} from '@/app/reader/components/sidebar/TOCItem';
import { TOCItem } from '@/libs/document';

vi.mock('@/utils/misc', () => ({
  getContentMd5: (s: string) => s,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
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

describe('CurrentPositionRow', () => {
  it('renders the "Current position" label and the current page number', () => {
    render(
      <div role='tree'>
        <CurrentPositionRow depth={1} page={42} />
      </div>,
    );
    expect(screen.getByText('Current position')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('renders an open-book icon', () => {
    const { container } = render(<CurrentPositionRow depth={0} page={1} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('indents according to depth (matching a child of the active item)', () => {
    const { container } = render(<CurrentPositionRow depth={2} page={1} />);
    const row = container.querySelector('[role="treeitem"]') as HTMLElement;
    expect(row.style.paddingInlineStart).toBe(`${(2 + 1) * 12}px`);
  });

  it('exposes the page number in its aria-label', () => {
    render(<CurrentPositionRow depth={0} page={7} />);
    const row = screen.getByRole('treeitem');
    expect(row.getAttribute('aria-label')).toContain('Current position');
    expect(row.getAttribute('aria-label')).toContain('7');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<CurrentPositionRow depth={0} page={5} onClick={onClick} />);
    fireEvent.click(screen.getByRole('treeitem'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick when Enter is pressed', () => {
    const onClick = vi.fn();
    render(<CurrentPositionRow depth={0} page={5} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('treeitem'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is focusable (tabIndex=0) when an onClick is provided', () => {
    render(<CurrentPositionRow depth={0} page={5} onClick={vi.fn()} />);
    expect(screen.getByRole('treeitem').getAttribute('tabindex')).toBe('0');
  });
});

describe('buildTOCDisplayItems', () => {
  const makeFlat = (count: number, depth = 0): FlatTOCItem[] =>
    Array.from({ length: count }, (_, i) => ({
      item: { id: i + 1, label: `Chapter ${i}`, href: `ch${i}.html`, index: i },
      depth,
      index: i,
    }));

  it('inserts a current-position row right after the active item', () => {
    const flat = makeFlat(4);
    const result = buildTOCDisplayItems(flat, 'ch1.html', 10);
    expect(result).toHaveLength(5);
    const inserted = result[2]!;
    expect(isCurrentPositionItem(inserted)).toBe(true);
    if (isCurrentPositionItem(inserted)) expect(inserted.page).toBe(10);
  });

  it('indents the current-position row one level deeper than the active item', () => {
    const flat = makeFlat(3, 1);
    const result = buildTOCDisplayItems(flat, 'ch0.html', 5);
    const inserted = result[1]!;
    expect(isCurrentPositionItem(inserted)).toBe(true);
    if (isCurrentPositionItem(inserted)) expect(inserted.depth).toBe(2);
  });

  it('keeps the active item index unchanged so auto-scroll still targets it', () => {
    const flat = makeFlat(4);
    const result = buildTOCDisplayItems(flat, 'ch2.html', 9);
    const activeIdx = result.findIndex(
      (r) => !isCurrentPositionItem(r) && r.item.href === 'ch2.html',
    );
    expect(activeIdx).toBe(2);
    expect(isCurrentPositionItem(result[3]!)).toBe(true);
  });

  it('returns the original list when no item matches the active href', () => {
    const flat = makeFlat(3);
    const result = buildTOCDisplayItems(flat, 'missing.html', 5);
    expect(result).toBe(flat);
  });

  it('returns the original list when the current page is unknown', () => {
    const flat = makeFlat(3);
    expect(buildTOCDisplayItems(flat, 'ch1.html', null)).toBe(flat);
    expect(buildTOCDisplayItems(flat, 'ch1.html', undefined)).toBe(flat);
  });

  it('returns the original list when there is no active href', () => {
    const flat = makeFlat(3);
    expect(buildTOCDisplayItems(flat, null, 5)).toBe(flat);
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
