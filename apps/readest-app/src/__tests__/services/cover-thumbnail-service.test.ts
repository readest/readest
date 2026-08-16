import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCoverThumbnailRequests,
  observeCoverForThumbnail,
} from '@/services/coverThumbnailService';
import type { Book } from '@/types/book';

const makeBook = (overrides: Partial<Book>): Book =>
  ({
    hash: '0123456789abcdef0123456789abcdef',
    format: 'EPUB',
    title: 'Test Book',
    author: 'Test Author',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }) as Book;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildCoverThumbnailRequests', () => {
  it('queues live books with their content-addressed cover hashes', () => {
    const books = [
      makeBook({ coverHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
      makeBook({
        hash: 'fedcba9876543210fedcba9876543210',
        coverHash: null,
      }),
      makeBook({
        hash: '22222222222222222222222222222222',
        coverHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        deletedAt: 3,
      }),
    ];

    expect(buildCoverThumbnailRequests(books)).toEqual([
      {
        bookHash: '0123456789abcdef0123456789abcdef',
        coverHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      {
        bookHash: 'fedcba9876543210fedcba9876543210',
        coverHash: null,
      },
    ]);
  });
});

describe('observeCoverForThumbnail', () => {
  it('runs immediately when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const onVisible = vi.fn();

    const cleanup = observeCoverForThumbnail(document.createElement('div'), onVisible);

    expect(onVisible).toHaveBeenCalledOnce();
    expect(cleanup).not.toThrow();
  });

  it('waits for intersection and cleanup prevents a stale callback', () => {
    let observerCallback: IntersectionObserverCallback | undefined;
    const observe = vi.fn();
    const unobserve = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
        observe = observe;
        unobserve = unobserve;
        disconnect = vi.fn();
        takeRecords = () => [];
        root = null;
        rootMargin = '400px';
        thresholds = [0];
      },
    );
    const hiddenElement = document.createElement('div');
    const removedElement = document.createElement('div');
    const onHiddenVisible = vi.fn();
    const onRemovedVisible = vi.fn();
    const cleanup = observeCoverForThumbnail(removedElement, onRemovedVisible);
    observeCoverForThumbnail(hiddenElement, onHiddenVisible);

    observerCallback?.(
      [
        { target: hiddenElement, isIntersecting: false } as unknown as IntersectionObserverEntry,
        { target: removedElement, isIntersecting: false } as unknown as IntersectionObserverEntry,
      ],
      { unobserve } as unknown as IntersectionObserver,
    );
    expect(onHiddenVisible).not.toHaveBeenCalled();
    expect(onRemovedVisible).not.toHaveBeenCalled();

    cleanup();
    observerCallback?.(
      [
        { target: hiddenElement, isIntersecting: true } as unknown as IntersectionObserverEntry,
        { target: removedElement, isIntersecting: true } as unknown as IntersectionObserverEntry,
      ],
      { unobserve } as unknown as IntersectionObserver,
    );

    expect(onHiddenVisible).toHaveBeenCalledOnce();
    expect(onRemovedVisible).not.toHaveBeenCalled();
    expect(unobserve).toHaveBeenCalledWith(removedElement);
    expect(unobserve).toHaveBeenCalledWith(hiddenElement);
  });
});
