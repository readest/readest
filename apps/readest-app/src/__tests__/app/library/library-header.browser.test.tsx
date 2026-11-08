import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { page } from 'vitest/browser';
import { DropdownProvider } from '@/context/DropdownContext';
import Menu from '@/components/Menu';
import LibraryHeader from '@/app/library/components/LibraryHeader';
import { DEFAULT_BOOK_SEARCH_CONFIG } from '@/services/constants';
import { addLibrarySearchHistory } from '@/app/library/utils/searchHistory';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string>) =>
    Object.entries(values ?? {}).reduce(
      (text, [name, value]) => text.replace(`{{${name}}}`, value),
      key,
    ),
}));
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/hooks/useShortcuts', () => ({ default: () => {} }));
vi.mock('@/app/library/components/SettingsMenu', () => ({
  default: () => <Menu className='settings-menu dropdown-content no-triangle mt-2'>Settings</Menu>,
}));
vi.mock('@/app/library/components/ImportMenu', () => ({ default: () => null }));
vi.mock('@/app/library/components/ViewMenu', () => ({
  default: () => (
    <Menu
      className='view-menu dropdown-content no-triangle mt-2'
      style={{ marginRight: window.innerWidth < 640 ? '-40px' : 0 }}
    >
      View
    </Menu>
  ),
}));
await import('@/styles/globals.css');
const noop = () => {};
afterEach(() => {
  cleanup();
  document.documentElement.dir = 'ltr';
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

const renderHeader = (searchQuery = '', searchTarget: 'books' | 'text' = 'books') =>
  render(
    <DropdownProvider>
      <div className='relative w-full'>
        <LibraryHeader
          isSelectMode={false}
          isSelectAll={false}
          searchQuery={searchQuery}
          searchTarget={searchTarget}
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
        />
      </div>
    </DropdownProvider>,
  );

describe('library search history layout', () => {
  for (const width of [390, 768, 1200]) {
    for (const dir of ['ltr', 'rtl']) {
      for (const eink of [false, true]) {
        it(`fits the search field at ${width}px in ${dir}, e-ink ${eink}`, async () => {
          await page.viewport(width, 900);
          document.documentElement.dir = dir;
          document.documentElement.dataset['eink'] = String(eink);
          document.documentElement.dataset['theme'] = eink ? 'light' : 'dark';
          const longTerm = 'A very long search query for a whole series of books '.repeat(4).trim();
          addLibrarySearchHistory(longTerm, 'books');
          addLibrarySearchHistory('Dune', 'books');
          const { getByRole, getByText } = renderHeader();
          const input = getByRole('textbox');
          fireEvent.focus(input);
          const history = getByRole('region', { name: 'Search history' });
          const bounds = history.getBoundingClientRect();
          const inputBounds = input.getBoundingClientRect();
          expect(bounds.left).toBeCloseTo(inputBounds.left, 0);
          expect(bounds.right).toBeCloseTo(inputBounds.right, 0);
          expect(bounds.top).toBeGreaterThanOrEqual(inputBounds.bottom);
          expect(bounds.left).toBeGreaterThanOrEqual(0);
          expect(bounds.right).toBeLessThanOrEqual(width);
          const remove = getByRole('button', { name: `Remove ${longTerm} from search history` });
          expect(remove.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
          expect(remove.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
          const label = getByText(longTerm);
          expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
          const card = history.querySelector('.eink-bordered')!;
          if (eink) {
            expect(getComputedStyle(card).borderTopWidth).toBe('1px');
            expect(getComputedStyle(card).borderTopColor).toBe(getComputedStyle(card).color);
          }
          fireEvent.click(remove);
          expect(getByRole('button', { name: 'Dune' })).toBeTruthy();
        });
      }
    }
  }
});

describe('library search actions', () => {
  for (const width of [390, 768, 1200]) {
    for (const dir of ['ltr', 'rtl']) {
      for (const target of ['books', 'text'] as const) {
        it(`keeps ${target} query text clear of actions at ${width}px in ${dir}`, async () => {
          await page.viewport(width, 900);
          document.documentElement.dir = dir;
          const { getByRole } = renderHeader('A long book title to search for', target);
          const input = getByRole('textbox');
          const bounds = input.getBoundingClientRect();
          const style = getComputedStyle(input);
          const textLeft = bounds.left + Number.parseFloat(style.paddingLeft);
          const textRight = bounds.right - Number.parseFloat(style.paddingRight);
          const clear = getByRole('button', { name: 'Clear Search' }).getBoundingClientRect();
          if (dir === 'ltr') expect(textRight).toBeLessThanOrEqual(clear.left - 4);
          else expect(textLeft).toBeGreaterThanOrEqual(clear.right + 4);
          expect(textRight - textLeft).toBeGreaterThanOrEqual(24);
        });
      }
      it(`centers Select Books between Import and the input end at ${width}px in ${dir}`, async () => {
        await page.viewport(width, 900);
        document.documentElement.dir = dir;
        const { getByRole } = renderHeader();
        const input = getByRole('textbox').getBoundingClientRect();
        const plusButton = getByRole('button', { name: 'Import Books' });
        const selectButton = getByRole('button', { name: 'Select Books' });
        const plus = plusButton.getBoundingClientRect();
        const select = selectButton.getBoundingClientRect();
        const plusCenter = (plus.left + plus.right) / 2;
        const selectCenter = (select.left + select.right) / 2;
        expect(selectCenter).toBeCloseTo(
          (plusCenter + (dir === 'ltr' ? input.right : input.left)) / 2,
          0,
        );
        const plusHitWidth = Number.parseFloat(getComputedStyle(plusButton, '::before').width);
        const selectHitWidth = Number.parseFloat(getComputedStyle(selectButton, '::before').width);
        expect(selectHitWidth).toBeGreaterThanOrEqual(44);
        expect(Math.abs(selectCenter - plusCenter)).toBeGreaterThanOrEqual(
          (plusHitWidth + selectHitWidth) / 2,
        );
      });
    }
  }
});

it.each([
  390, 627,
])('matches mobile menu gaps and dismisses outside taps at %ipx', async (width) => {
  await page.viewport(width, 900);
  const { container, getByRole } = renderHeader();
  const gaps: number[] = [];
  for (const [label, selector] of [
    ['View Menu', '.view-menu'],
    ['Settings Menu', '.settings-menu'],
  ]) {
    const toggle = getByRole('button', { name: label });
    fireEvent.click(toggle);
    const menu = container.querySelector(selector!) as HTMLElement;
    const overlay = container.querySelector('.overlay') as HTMLElement;
    gaps.push(menu.getBoundingClientRect().top - toggle.getBoundingClientRect().bottom);
    expect(menu.getBoundingClientRect().right).toBeCloseTo(width - 16, 0);
    expect(getComputedStyle(overlay).position).toBe('fixed');
    const outside = document.elementFromPoint(16, 880) as HTMLElement;
    expect(outside).toBe(overlay);
    fireEvent.click(outside);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  }
  expect(gaps[0]).toBe(gaps[1]);
});
