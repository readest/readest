import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { page } from 'vitest/browser';
import LibraryHeader from '@/app/library/components/LibraryHeader';
import { DEFAULT_BOOK_SEARCH_CONFIG } from '@/services/constants';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/hooks/useShortcuts', () => ({ default: () => {} }));
vi.mock('@/app/library/components/SettingsMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/ImportMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/ViewMenu', () => ({ default: () => null }));
await import('@/styles/globals.css');
const noop = () => {};
afterEach(() => {
  cleanup();
  document.documentElement.dir = 'ltr';
});

describe('library search actions', () => {
  for (const width of [768, 1200]) {
    for (const dir of ['ltr', 'rtl']) {
      it(`centers Select Books between Import and the input end at ${width}px in ${dir}`, async () => {
        await page.viewport(width, 900);
        document.documentElement.dir = dir;
        const { getByRole } = render(
          <LibraryHeader
            isSelectMode={false}
            isSelectAll={false}
            searchQuery=''
            searchTarget='books'
            searchConfig={DEFAULT_BOOK_SEARCH_CONFIG}
            onPullLibrary={noop}
            onImportBooksFromFiles={noop}
            onOpenCatalogManager={noop}
            onOpenFeeds={noop}
            onToggleSelectMode={noop}
            onSelectAll={noop}
            onDeselectAll={noop}
            onSearchConfigChange={noop}
            onSearchQueryChange={noop}
            onSearchTargetChange={noop}
          />,
        );
        const input = getByRole('textbox').getBoundingClientRect();
        const plus = getByRole('button', { name: 'Import Books' }).getBoundingClientRect();
        const select = getByRole('button', { name: 'Select Books' }).getBoundingClientRect();
        const plusCenter = (plus.left + plus.right) / 2;
        const selectCenter = (select.left + select.right) / 2;
        expect(selectCenter).toBeCloseTo(
          (plusCenter + (dir === 'ltr' ? input.right : input.left)) / 2,
          0,
        );
      });
    }
  }
});
