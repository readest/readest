import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GroupHeader from '@/app/library/components/GroupHeader';
import { LibraryGroupByType } from '@/types/settings';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

const routerStub = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
let currentSearch = '';
vi.mock('next/navigation', () => ({
  useRouter: () => routerStub,
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const navigateToLibraryMock = vi.fn();
vi.mock('@/utils/nav', () => ({
  navigateToLibrary: (...args: unknown[]) => navigateToLibraryMock(...args),
}));

afterEach(() => {
  cleanup();
  navigateToLibraryMock.mockReset();
});

describe('GroupHeader back button', () => {
  // Regression for #4437: inside a series/author folder after a cold start, the
  // URL is just `?group=X` (groupBy comes from settings, not the URL). Deleting
  // `group` would leave an empty query, and `router.replace('/library')` with an
  // empty search silently no-ops under the Next.js 16.2 static export (same root
  // cause as #3782, fixed for the breadcrumb "All" button in #3832). The back
  // button must keep the query non-empty via the `group=` workaround so the
  // navigation actually commits.
  it('keeps a non-empty query when group is the only param', () => {
    currentSearch = 'group=abc123';
    render(<GroupHeader groupBy={LibraryGroupByType.Series} groupName='My Series' />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to library' }));

    expect(navigateToLibraryMock).toHaveBeenCalledTimes(1);
    const query = navigateToLibraryMock.mock.calls[0]![1] as string;
    expect(query).not.toBe('');
    const params = new URLSearchParams(query);
    expect(params.has('group')).toBe(true);
    expect(params.get('group')).toBe('');
  });

  it('preserves other params while clearing the group', () => {
    currentSearch = 'groupBy=author&sort=title&group=abc123';
    render(<GroupHeader groupBy={LibraryGroupByType.Author} groupName='Jane Doe' />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to library' }));

    const query = navigateToLibraryMock.mock.calls[0]![1] as string;
    const params = new URLSearchParams(query);
    expect(params.get('groupBy')).toBe('author');
    expect(params.get('sort')).toBe('title');
    expect(params.get('group')).toBe('');
  });
});
