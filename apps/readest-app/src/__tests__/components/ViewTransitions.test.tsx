import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { Suspense, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewTransitions, useTransitionRouter } from '@/components/ViewTransitions';

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const startViewTransition = vi.fn();
let updates: Promise<void>[] = [];

beforeEach(() => {
  updates = [];
  window.history.replaceState({}, '', '/opds?catalog=one');
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: startViewTransition,
  });
  startViewTransition.mockImplementation((callback: () => Promise<void>) => {
    const updateCallbackDone = Promise.resolve().then(callback);
    updates.push(updateCallbackDone);
    return { ready: Promise.resolve(), finished: updateCallbackDone, updateCallbackDone };
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, 'startViewTransition');
  vi.resetAllMocks();
});

describe('Readest route transitions', () => {
  it.each([
    '/opds?catalog=two',
    '/opds?catalog=one#section',
    '/opds?catalog=one',
    '/library',
  ])('leaves native history navigation to Next.js: %s', (url) => {
    const onPopState = vi.fn();
    window.addEventListener('popstate', onPopState);
    render(<ViewTransitions>Catalog</ViewTransitions>);
    act(() => {
      window.history.replaceState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(onPopState).toHaveBeenCalledOnce();
    window.removeEventListener('popstate', onPopState);
  });

  it.each([
    '/library',
    '/opds?catalog=two',
    '/opds?catalog=one',
  ])('completes explicit navigation after React commits: %s', async (url) => {
    const { result } = renderHook(() => useTransitionRouter(), { wrapper: ViewTransitions });
    await act(async () => result.current.push(url, { scroll: false }));
    expect(router.push).toHaveBeenCalledWith(url, { scroll: false });
    expect(startViewTransition).toHaveBeenCalledOnce();
    await expect(updates[0]).resolves.toBeUndefined();
  });

  it('settles overlapping navigations', async () => {
    const { result } = renderHook(() => useTransitionRouter(), { wrapper: ViewTransitions });
    await act(async () => {
      result.current.push('/library');
      result.current.replace('/reader');
    });
    await expect(Promise.all(updates)).resolves.toEqual([undefined, undefined]);
    expect(router.replace).toHaveBeenCalledWith('/reader');
  });

  it('waits for a suspended destination to commit before finishing the animation update', async () => {
    let loaded = false;
    let load!: () => void;
    const loading = new Promise<void>((resolve) => {
      load = resolve;
    });
    function Page({ name }: { name: string }) {
      if (name === 'Reader' && !loaded) throw loading;
      return <p>{name}</p>;
    }
    function OpenButton() {
      const navigation = useTransitionRouter();
      return <button onClick={() => navigation.push('/reader')}>Open</button>;
    }
    function App() {
      const [page, setPage] = useState('Library');
      router.push.mockImplementation(() => setPage('Reader'));
      return (
        <ViewTransitions>
          <OpenButton />
          <Suspense fallback={<p>Loading</p>}>
            <Page name={page} />
          </Suspense>
        </ViewTransitions>
      );
    }
    render(<App />);
    await act(async () => fireEvent.click(screen.getByText('Open')));
    let finished = false;
    void updates[0]!.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(screen.getByText('Library')).toBeTruthy();
    expect(finished).toBe(false);
    await act(async () => {
      loaded = true;
      load();
    });
    expect(screen.getByText('Reader')).toBeTruthy();
    await expect(updates[0]).resolves.toBeUndefined();
  });

  it('navigates normally without the View Transitions API', () => {
    Reflect.deleteProperty(document, 'startViewTransition');
    const { result } = renderHook(() => useTransitionRouter(), { wrapper: ViewTransitions });
    act(() => result.current.replace('/library'));
    expect(router.replace).toHaveBeenCalledWith('/library');
  });

  it('keeps back and forward navigation native', () => {
    const { result } = renderHook(() => useTransitionRouter(), { wrapper: ViewTransitions });
    expect(result.current.back).toBe(router.back);
    expect(result.current.forward).toBe(router.forward);
  });

  it('handles skipped animations without rejecting navigation', async () => {
    startViewTransition.mockImplementation((callback: () => Promise<void>) => {
      const updateCallbackDone = Promise.resolve().then(callback);
      updates.push(updateCallbackDone);
      return {
        ready: Promise.reject(new DOMException('Animation skipped', 'AbortError')),
        finished: updateCallbackDone,
        updateCallbackDone,
      };
    });
    const { result } = renderHook(() => useTransitionRouter(), { wrapper: ViewTransitions });
    await act(async () => result.current.push('/library'));
    await expect(updates[0]).resolves.toBeUndefined();
  });
});
