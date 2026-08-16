import type { Book } from '@/types/book';

export const COVER_THUMBNAIL_READY_EVENT = 'cover-thumbnail-ready';

export interface CoverThumbnailRequest {
  bookHash: string;
  coverHash: string | null;
}

export interface CoverThumbnailReadyPayload {
  bookHash: string;
  coverHash: string | null;
  thumbnailPath: string;
}

type VisibilityCallback = () => void;

const visibilityCallbacks = new WeakMap<Element, VisibilityCallback>();
let visibilityObserver: IntersectionObserver | null = null;

const getVisibilityObserver = (): IntersectionObserver => {
  visibilityObserver ??= new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = visibilityCallbacks.get(entry.target);
        visibilityCallbacks.delete(entry.target);
        observer.unobserve(entry.target);
        callback?.();
      }
    },
    { rootMargin: '400px' },
  );
  return visibilityObserver;
};

/**
 * Runs once when a rendered cover reaches the viewport prefetch margin. The
 * observer is shared because grouped list rows can contain hundreds of covers.
 */
export const observeCoverForThumbnail = (
  element: Element,
  onVisible: VisibilityCallback,
): (() => void) => {
  if (typeof IntersectionObserver === 'undefined') {
    onVisible();
    return () => {};
  }

  visibilityCallbacks.set(element, onVisible);
  getVisibilityObserver().observe(element);
  return () => {
    visibilityCallbacks.delete(element);
    visibilityObserver?.unobserve(element);
  };
};

export const buildCoverThumbnailRequests = (books: Book[]): CoverThumbnailRequest[] =>
  books
    .filter((book) => !book.deletedAt)
    .map((book) => ({
      bookHash: book.hash,
      coverHash: book.coverHash ?? null,
    }));
