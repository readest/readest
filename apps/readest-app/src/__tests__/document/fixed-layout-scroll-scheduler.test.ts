import { describe, expect, it } from 'vitest';

import { planScrollModePages } from 'foliate-js/fixed-layout.js';

// Page model the scheduler operates on. `visible` is set by the
// IntersectionObserver (true when the page is within the widened preload
// margin); `state` mirrors the load lifecycle.
const page = (index: number, state: string, visible: boolean) => ({ index, state, visible });

describe('planScrollModePages', () => {
  it('loads the nearest visible idle pages first, within the concurrency budget', () => {
    const pages = [
      page(8, 'idle', true),
      page(9, 'idle', true),
      page(10, 'loaded', true),
      page(11, 'idle', true),
      page(12, 'idle', true),
    ];

    const { load } = planScrollModePages({
      pages,
      currentIndex: 10,
      maxLoaded: 8,
      maxConcurrent: 2,
      loadingCount: 0,
    });

    // Nearest to index 10 are 9 and 11; both idle+visible; budget is 2.
    expect(load).toEqual([9, 11]);
  });

  it('subtracts in-flight loads from the concurrency budget', () => {
    const pages = [page(9, 'idle', true), page(11, 'idle', true), page(12, 'idle', true)];

    const { load } = planScrollModePages({
      pages,
      currentIndex: 10,
      maxLoaded: 8,
      maxConcurrent: 3,
      loadingCount: 2,
    });

    // 3 concurrent allowed, 2 already loading -> budget of 1 -> nearest only.
    expect(load).toEqual([9]);
  });

  it('never starts a load when the budget is already spent', () => {
    const pages = [page(9, 'idle', true), page(11, 'idle', true)];

    const { load } = planScrollModePages({
      pages,
      currentIndex: 10,
      maxLoaded: 8,
      maxConcurrent: 2,
      loadingCount: 2,
    });

    expect(load).toEqual([]);
  });

  it('ignores idle pages outside the visible preload band', () => {
    const pages = [page(9, 'idle', false), page(11, 'idle', true)];

    const { load } = planScrollModePages({
      pages,
      currentIndex: 10,
      maxLoaded: 8,
      maxConcurrent: 4,
      loadingCount: 0,
    });

    // Page 9 is not visible, so only the visible page 11 loads.
    expect(load).toEqual([11]);
  });

  it('does not re-load pages that are already loading or loaded', () => {
    const pages = [page(9, 'loading', true), page(10, 'loaded', true), page(11, 'idle', true)];

    const { load } = planScrollModePages({
      pages,
      currentIndex: 10,
      maxLoaded: 8,
      maxConcurrent: 4,
      loadingCount: 1,
    });

    expect(load).toEqual([11]);
  });

  it('never re-loads a page in the terminal error state', () => {
    // A page whose load failed is parked in 'error' so the post-completion
    // reschedule cannot retry it forever in a tight async loop.
    const pages = [page(10, 'error', true), page(11, 'idle', true)];

    const { load } = planScrollModePages({
      pages,
      currentIndex: 10,
      maxLoaded: 8,
      maxConcurrent: 4,
      loadingCount: 0,
    });

    expect(load).toEqual([11]);
  });

  it('evicts the farthest non-visible loaded pages once over the in-memory cap', () => {
    const pages = [
      page(2, 'loaded', false),
      page(20, 'loaded', false),
      page(9, 'loaded', true),
      page(10, 'loaded', true),
      page(11, 'loaded', true),
    ];

    const { evict } = planScrollModePages({
      pages,
      currentIndex: 10,
      maxLoaded: 3,
      maxConcurrent: 2,
      loadingCount: 0,
    });

    // 5 loaded, cap 3 -> evict the 2 farthest from index 10: pages 20 and 2.
    expect(evict.sort((a: number, b: number) => a - b)).toEqual([2, 20]);
  });

  it('never evicts a visible page even when over the cap', () => {
    const pages = [page(9, 'loaded', true), page(10, 'loaded', true), page(11, 'loaded', true)];

    const { evict } = planScrollModePages({
      pages,
      currentIndex: 10,
      maxLoaded: 1,
      maxConcurrent: 2,
      loadingCount: 0,
    });

    // All three are on screen; none may be torn out from under the reader.
    expect(evict).toEqual([]);
  });

  it('does not evict when loaded pages are within the cap', () => {
    const pages = [page(9, 'loaded', true), page(10, 'loaded', true)];

    const { evict } = planScrollModePages({
      pages,
      currentIndex: 10,
      maxLoaded: 8,
      maxConcurrent: 2,
      loadingCount: 0,
    });

    expect(evict).toEqual([]);
  });
});
