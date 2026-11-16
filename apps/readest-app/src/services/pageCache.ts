import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

/** Where foliate's paginator keeps how far each section runs along its pages (`setPageCache`). */
export interface PageCache {
  get(index: number): Promise<unknown>;
  put(index: number, entry: unknown): void;
}

const NAME = 'pages.json';
// a section's measures and its neighbours' come within a few seconds: one write for them
const SAVE_DELAY_MS = 2000;

/**
 * Keeps how far each section of an EPUB runs along its pages, as foliate's paginator measured it
 * with what that depends on, for the book's next open (as crengine keeps its page list).
 * Measuring a section takes the boxes of all its text, a few hundred ms on an e-ink reader.
 */
export const createPageCache = (
  appService: Pick<AppService, 'loadBookCache' | 'saveBookCache'>,
  book: Book,
): PageCache => {
  let kept: Promise<Record<number, unknown>> | undefined;
  const load = () =>
    (kept ??= appService.loadBookCache(book, NAME).then((data) => {
      try {
        const sections = JSON.parse(data ?? '{}');
        return sections && typeof sections === 'object' ? sections : {};
      } catch {
        return {};
      }
    }));
  // read while the first section loads
  void load();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    get: async (index) => (await load())[index] ?? null,
    put: (index, entry) => {
      void load().then((sections) => {
        sections[index] = entry;
        clearTimeout(timer);
        timer = setTimeout(() => {
          appService.saveBookCache(book, NAME, JSON.stringify(sections)).catch(() => {});
        }, SAVE_DELAY_MS);
      });
    },
  };
};
