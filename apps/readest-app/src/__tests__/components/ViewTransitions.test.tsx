import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewTransitions } from 'next-view-transitions';

let pathname = '/opds';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({}),
}));
vi.mock('next/link', () => ({ default: () => null }));

const startViewTransition = vi.fn();

beforeEach(() => {
  pathname = '/opds';
  window.history.replaceState({}, '', '/opds?catalog=one');
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: startViewTransition,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, 'startViewTransition');
  startViewTransition.mockReset();
});

describe('native history view transitions', () => {
  it.each([
    '/opds?catalog=two',
    '/opds?catalog=one#section',
    '/opds?catalog=one',
  ])('does not wait for a route mount when history stays on the same path: %s', (url) => {
    render(<ViewTransitions>Catalog</ViewTransitions>);
    act(() => {
      window.history.replaceState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it('completes a cross-path transition after the new route mounts', async () => {
    let update: (() => Promise<void>) | undefined;
    startViewTransition.mockImplementation((callback: () => Promise<void>) => {
      update = callback;
    });
    const view = render(<ViewTransitions>Catalog</ViewTransitions>);
    act(() => {
      window.history.replaceState({}, '', '/library');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(startViewTransition).toHaveBeenCalledOnce();
    const finished = update!();
    pathname = '/library';
    await act(async () => {
      view.rerender(<ViewTransitions>Library</ViewTransitions>);
    });
    await expect(finished).resolves.toBeUndefined();
  });
});
