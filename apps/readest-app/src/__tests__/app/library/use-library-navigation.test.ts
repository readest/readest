import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

import { useRouter, ReadonlyURLSearchParams } from 'next/navigation';
import { useLibraryNavigation } from '@/app/library/hooks/useLibraryNavigation';

function mockRouter() {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  };
}

function makeSearchParams(query: string): ReadonlyURLSearchParams {
  // URLSearchParams shares the read-only subset of methods we need.
  return new URLSearchParams(query) as unknown as ReadonlyURLSearchParams;
}

describe('useLibraryNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute('data-nav-direction');
  });

  it('navigates to /library (no query) when going back to root from a group', () => {
    // Regression: clicking the breadcrumb "All" button from /library?group=foo
    // must call router.replace('/library'). Previously this navigation was
    // wrapped through next-view-transitions' useTransitionRouter which is
    // incompatible with Next.js 16.2 RSC navigation when the pathname stays
    // the same and all query params are removed, causing the click to do
    // nothing on the first attempt. See readest/readest#3782.
    const router = mockRouter();
    vi.mocked(useRouter).mockReturnValue(router as never);

    const { result } = renderHook(() => useLibraryNavigation(makeSearchParams('group=foo')));

    act(() => {
      result.current('');
    });

    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/library', undefined);
  });

  it('preserves other search params when going back to root', () => {
    const router = mockRouter();
    vi.mocked(useRouter).mockReturnValue(router as never);

    const { result } = renderHook(() =>
      useLibraryNavigation(makeSearchParams('groupBy=author&group=cf6342e&sort=title')),
    );

    act(() => {
      result.current('');
    });

    expect(router.replace).toHaveBeenCalledTimes(1);
    const calledHref = router.replace.mock.calls[0]![0] as string;
    expect(calledHref.startsWith('/library?')).toBe(true);
    const calledParams = new URLSearchParams(calledHref.slice('/library?'.length));
    expect(calledParams.get('group')).toBeNull();
    expect(calledParams.get('groupBy')).toBe('author');
    expect(calledParams.get('sort')).toBe('title');
  });

  it('navigates forward to a group by setting the group param', () => {
    const router = mockRouter();
    vi.mocked(useRouter).mockReturnValue(router as never);

    const { result } = renderHook(() => useLibraryNavigation(makeSearchParams('')));

    act(() => {
      result.current('group-id-abc');
    });

    expect(router.replace).toHaveBeenCalledWith('/library?group=group-id-abc', undefined);
  });

  it('replaces the group param when navigating between sibling groups', () => {
    const router = mockRouter();
    vi.mocked(useRouter).mockReturnValue(router as never);

    const { result } = renderHook(() => useLibraryNavigation(makeSearchParams('group=group-a')));

    act(() => {
      result.current('group-b');
    });

    expect(router.replace).toHaveBeenCalledWith('/library?group=group-b', undefined);
  });

  it('sets data-nav-direction to "back" when returning to root from a group', () => {
    const router = mockRouter();
    vi.mocked(useRouter).mockReturnValue(router as never);

    const { result } = renderHook(() => useLibraryNavigation(makeSearchParams('group=foo')));

    act(() => {
      result.current('');
    });

    expect(document.documentElement.getAttribute('data-nav-direction')).toBe('back');
  });

  it('sets data-nav-direction to "forward" when entering a group', () => {
    const router = mockRouter();
    vi.mocked(useRouter).mockReturnValue(router as never);

    const { result } = renderHook(() => useLibraryNavigation(makeSearchParams('')));

    act(() => {
      result.current('group-id');
    });

    expect(document.documentElement.getAttribute('data-nav-direction')).toBe('forward');
  });

  it('invokes onBeforeNavigate with the current group before navigating', () => {
    const router = mockRouter();
    vi.mocked(useRouter).mockReturnValue(router as never);
    const onBeforeNavigate = vi.fn();

    const { result } = renderHook(() =>
      useLibraryNavigation(makeSearchParams('group=foo'), onBeforeNavigate),
    );

    act(() => {
      result.current('');
    });

    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(onBeforeNavigate).toHaveBeenCalledWith('foo');
    // Order matters: callback should run before router.replace so callers can
    // capture state (e.g. scroll position) of the leaving view.
    expect(onBeforeNavigate.mock.invocationCallOrder[0]).toBeLessThan(
      router.replace.mock.invocationCallOrder[0]!,
    );
  });
});
