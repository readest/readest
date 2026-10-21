import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: vi.fn(),
}));

import TableViewer from '@/app/reader/components/TableViewer';

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('TableViewer', () => {
  afterEach(() => {
    cleanup();
  });

  // The table markup is copied out of the book document into the app window,
  // so anything executable in it must be dropped on the way in.
  it('renders the table without anything executable', () => {
    const html =
      '<table><tr><td colspan="2" style="color: red">cell' +
      '<img src="blob:http://localhost/abc" onerror="window.__pwned=1">' +
      '<svg onload="window.__pwned=2"></svg><script>window.__pwned=3</script>' +
      '<iframe srcdoc="<script>parent.__pwned=4</script>"></iframe></td></tr></table>';
    const { container } = render(
      <TableViewer gridInsets={insets} html={html} isDarkMode={false} onClose={vi.fn()} />,
    );

    const cell = container.querySelector('td');
    expect(cell?.getAttribute('colspan')).toBe('2');
    expect(cell?.getAttribute('style')).toContain('color');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:http://localhost/abc');
    expect(container.querySelector('[onerror], [onload], script, iframe')).toBeNull();
  });
});
