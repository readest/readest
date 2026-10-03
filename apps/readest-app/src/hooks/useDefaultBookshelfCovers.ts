import { readDefaultBookshelfCovers } from '@/services/bookshelves/state';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Cover appearance for surfaces that are not inside a shelf. The reader is
 * memoized, so the selector keeps returning the same object.
 */
export const useDefaultBookshelfCovers = () =>
  useSettingsStore((state) => readDefaultBookshelfCovers(state.settings));
