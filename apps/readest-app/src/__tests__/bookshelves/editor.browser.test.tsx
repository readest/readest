import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { DEFAULT_SYSTEM_SETTINGS as partialSettings } from '@/services/constants';
import type { SystemSettings } from '@/types/settings';
import { eventDispatcher } from '@/utils/event';
const DEFAULT_SYSTEM_SETTINGS = partialSettings as SystemSettings;
const saveDraft = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, values?: Record<string, unknown>) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));
vi.mock('@/services/bookshelves/persistence', () => ({ saveBookshelfDraft: saveDraft }));
vi.mock('@/store/absServerStore', () => ({
  useABSServerStore: () => [],
  isAbsBookOrphaned: () => false,
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn() }));
const { default: BookshelvesDialog } = await import('@/app/library/components/BookshelvesDialog');
await import('@/styles/globals.css');
beforeEach(() => {
  localStorage.removeItem('lastBookshelfTab');
  saveDraft.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      libraryGroupBy: 'none',
      libraryAutoColumns: false,
      libraryColumns: 3,
    },
  });
  useLibraryStore.setState({
    library: Array.from({ length: 24 }, (_, i) => ({
      hash: `${i}`,
      title: `Reading ${i + 1}`,
      author: 'Author',
      format: 'EPUB',
      createdAt: i,
      updatedAt: i,
      progress: [1, 100],
    })),
  });
});
afterEach(async () => {
  cleanup();
  localStorage.removeItem('lastBookshelfTab');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.dir = 'ltr';
  await page.viewport(1280, 900);
});
describe('bookshelf editor responsive layout', () => {
  for (const width of [320, 437]) {
    for (const dir of ['ltr', 'rtl']) {
      it(`centers every wrapped shelf row at ${width}px in ${dir}`, async () => {
        await page.viewport(width, 900);
        document.documentElement.dir = dir;
        const { getByRole, getByLabelText } = render(<BookshelvesDialog />);
        await act(async () => {
          await eventDispatcher.dispatch('show-bookshelves');
        });
        fireEvent.click(getByRole('button', { name: 'Add bookshelf' }));
        fireEvent.click(getByRole('button', { name: 'Add bookshelf' }));
        const tabs = getByRole('group', { name: 'Bookshelves' });
        const expectCenteredRows = () => {
          const rows = new Map<number, DOMRect[]>();
          for (const control of tabs.querySelectorAll('[data-bookshelf-control]')) {
            const bounds = control.getBoundingClientRect();
            const top = Math.round(bounds.top);
            rows.set(top, [...(rows.get(top) || []), bounds]);
          }
          expect(rows.size).toBeGreaterThan(1);
          const bounds = tabs.getBoundingClientRect();
          for (const row of rows.values()) {
            const start = Math.min(...row.map((control) => control.left));
            const end = Math.max(...row.map((control) => control.right));
            expect((start + end) / 2).toBeCloseTo((bounds.left + bounds.right) / 2, 0);
          }
        };
        await waitFor(expectCenteredRows);
        await waitFor(() => expect(getByLabelText('Bookshelf status').textContent).toBe('Saved'));
        expectCenteredRows();
        fireEvent.click(getByRole('button', { name: 'Default' }));
        await waitFor(expectCenteredRows);
      });
    }
  }
  it('previews skeuomorphic covers for books and groups using the shelf setting', async () => {
    await page.viewport(1440, 900);
    useLibraryStore.setState({
      library: useLibraryStore
        .getState()
        .library.slice(0, 3)
        .map((book) => ({
          ...book,
          coverImageUrl:
            'data:image/svg+xml,' +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="gray"/></svg>',
            ),
        })),
    });
    const { getByRole, getByLabelText } = render(<BookshelvesDialog />);
    await act(async () => {
      await eventDispatcher.dispatch('show-bookshelves');
    });
    const toggle = getByLabelText('Skeuomorphic covers');
    expect(toggle.getBoundingClientRect().top).toBeGreaterThan(
      getByLabelText('Book covers').getBoundingClientRect().bottom,
    );
    const preview = getByRole('region', { name: 'Bookshelf preview' });
    const visibleSpines = (selector = '.book-spine') =>
      Array.from(preview.querySelectorAll(selector)).filter(
        (spine) => getComputedStyle(spine).visibility === 'visible',
      );
    await waitFor(() => expect(preview.querySelectorAll('.book-item')).toHaveLength(3));
    expect(visibleSpines()).toHaveLength(0);
    await userEvent.click(toggle);
    await waitFor(() => expect(visibleSpines('.book-item .book-spine')).toHaveLength(3));
    await userEvent.click(getByLabelText('Use global grouping'));
    await userEvent.selectOptions(getByLabelText('Group by'), 'author');
    await waitFor(() => expect(visibleSpines('.group-item .book-spine')).toHaveLength(3));
    await userEvent.click(toggle);
    await waitFor(() => expect(visibleSpines()).toHaveLength(0));
    await waitFor(() =>
      expect(saveDraft.mock.calls.at(-1)?.[2][0]).toMatchObject({ skeuomorphicCovers: false }),
    );
  });
  for (const width of [390, 1440]) {
    for (const dir of ['ltr', 'rtl']) {
      it(`opens filter instructions on tap at ${width}px in ${dir}`, async () => {
        await page.viewport(width, 900);
        document.documentElement.dir = dir;
        const { container, getByRole, queryByRole } = render(<BookshelvesDialog />);
        await act(async () => {
          await eventDispatcher.dispatch('show-bookshelves');
        });
        const info = getByRole('button', { name: 'Filter help' });
        await userEvent.click(info);
        const tooltip = await waitFor(() => getByRole('tooltip'));
        expect(tooltip.textContent).toContain('Add condition');
        expect(tooltip.textContent).toContain('Add filter group');
        expect(tooltip.textContent).toContain('AND');
        expect(tooltip.textContent).toContain('OR');
        const popup = tooltip.parentElement!;
        await waitFor(() => {
          const bounds = popup.getBoundingClientRect();
          expect(bounds.left).toBeGreaterThanOrEqual(0);
          expect(bounds.right).toBeLessThanOrEqual(width);
          expect(bounds.top).toBeGreaterThanOrEqual(0);
          expect(bounds.bottom).toBeLessThanOrEqual(900);
          const hit = document.elementFromPoint(bounds.left + 10, bounds.top + 10);
          expect(popup.contains(hit)).toBe(true);
        });
        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(queryByRole('tooltip')).toBeNull());
        expect(container.querySelector('dialog')?.open).toBe(true);
        await userEvent.click(info);
        await waitFor(() => expect(getByRole('tooltip')).toBeTruthy());
        await userEvent.click(getByRole('button', { name: 'Add condition' }));
        await waitFor(() => expect(queryByRole('tooltip')).toBeNull());
      });
    }
  }
  for (const width of [390, 1440]) {
    it(`edits and previews relative date filters without overflow at ${width}px`, async () => {
      await page.viewport(width, 900);
      useLibraryStore.setState({
        library: useLibraryStore
          .getState()
          .library.slice(0, 2)
          .map((book, i) => ({ ...book, createdAt: Date.now() - i * 40 * 86400000 })),
      });
      const { getByRole, getByLabelText } = render(<BookshelvesDialog />);
      await act(async () => {
        await eventDispatcher.dispatch('show-bookshelves');
      });
      await userEvent.click(getByRole('button', { name: 'Default' }));
      await userEvent.click(getByRole('button', { name: 'Add condition' }));
      await userEvent.selectOptions(getByLabelText('Filter field'), 'created');
      await userEvent.selectOptions(getByLabelText('Filter comparison'), 'withinLast');
      const period = getByLabelText('Time period') as HTMLInputElement;
      const unit = getByLabelText('Time unit') as HTMLSelectElement;
      fireEvent.change(period, { target: { value: '7' } });
      const preview = getByRole('region', { name: 'Bookshelf preview' });
      await waitFor(() =>
        expect(preview.textContent).toContain('1 displayed · 1 matching · 0 excluded'),
      );
      const periodBounds = period.getBoundingClientRect();
      const unitBounds = unit.getBoundingClientRect();
      expect(Math.abs(periodBounds.top - unitBounds.top)).toBeLessThan(1);
      expect(periodBounds.right).toBeLessThan(unitBounds.left);
      expect(unitBounds.right).toBeLessThan(
        getByRole('group', { name: 'Filters' }).getBoundingClientRect().right,
      );
      if (width > 640)
        expect(periodBounds.top).toBe(getByLabelText('Filter field').getBoundingClientRect().top);
      await userEvent.selectOptions(unit, 'years');
      await waitFor(() =>
        expect(preview.textContent).toContain('2 displayed · 2 matching · 0 excluded'),
      );
      await waitFor(() =>
        expect(
          saveDraft.mock.calls.at(-1)?.[2].find((s: { id: string }) => s.id === 'default').filters
            .children[0],
        ).toMatchObject({
          operator: 'withinLast',
          value: 7,
          unit: 'years',
        }),
      );
    });
  }
  for (const width of [390, 1440]) {
    it(`inherits global grouping and previews an independent choice at ${width}px`, async () => {
      await page.viewport(width, 900);
      const { getByRole, getByLabelText } = render(<BookshelvesDialog />);
      await act(async () => {
        await eventDispatcher.dispatch('show-bookshelves');
      });
      const grouping = getByRole('group', { name: 'Grouping' });
      const sorting = getByRole('group', { name: 'Sorting' });
      expect(grouping.getBoundingClientRect().bottom).toBeLessThan(
        sorting.getBoundingClientRect().top,
      );
      expect(grouping.getBoundingClientRect().left).toBe(sorting.getBoundingClientRect().left);
      expect(grouping.getBoundingClientRect().width).toBe(sorting.getBoundingClientRect().width);
      const inherit = getByLabelText('Use global grouping') as HTMLInputElement;
      const choice = getByLabelText('Group by') as HTMLSelectElement;
      expect(inherit.checked).toBe(true);
      expect(choice.disabled).toBe(true);
      expect(choice.value).toBe('none');
      const preview = getByRole('region', { name: 'Bookshelf preview' });
      await waitFor(() => expect(preview.querySelector('.book-item')).toBeTruthy());
      await userEvent.click(inherit);
      expect(choice.disabled).toBe(false);
      await userEvent.selectOptions(choice, 'author');
      await waitFor(() => expect(preview.querySelectorAll('.group-item')).toHaveLength(1));
      expect(preview.querySelector('.group-item')?.textContent).toContain('Author');
      await waitFor(() =>
        expect(saveDraft.mock.calls.at(-1)?.[2][0]).toMatchObject({
          useGlobalGrouping: false,
          groupBy: 'author',
        }),
      );
      await userEvent.click(inherit);
      expect(choice.value).toBe('none');
      await waitFor(() => expect(preview.querySelector('.book-item')).toBeTruthy());
      await userEvent.click(inherit);
      expect(choice.value).toBe('author');
      await waitFor(() => expect(preview.querySelectorAll('.group-item')).toHaveLength(1));
    });
  }
  for (const width of [390, 1440]) {
    for (const layout of ['carousel', 'grid'] as const) {
      it(`bottom-aligns fitted covers and labels in the ${layout} preview at ${width}px`, async () => {
        await page.viewport(width, 900);
        const shapes = [
          [60, 120],
          [120, 80],
          [80, 120],
        ];
        useLibraryStore.setState({
          library: useLibraryStore
            .getState()
            .library.slice(0, 3)
            .map((book, index) => ({
              ...book,
              coverImageUrl:
                'data:image/svg+xml,' +
                encodeURIComponent(
                  `<svg xmlns="http://www.w3.org/2000/svg" width="${shapes[index]![0]}" height="${shapes[index]![1]}"><rect width="100%" height="100%" fill="gray"/></svg>`,
                ),
            })),
        });
        const { getByRole, getByLabelText } = render(<BookshelvesDialog />);
        await act(async () => {
          await eventDispatcher.dispatch('show-bookshelves');
        });
        if (layout === 'grid') await userEvent.click(getByLabelText('Carousel layout'));
        await userEvent.selectOptions(getByLabelText('Book covers'), 'fit');
        const preview = getByRole('region', { name: 'Bookshelf preview' });
        await waitFor(() => {
          const covers = Array.from(preview.querySelectorAll<HTMLImageElement>('.fit-cover-img'));
          expect(covers).toHaveLength(3);
          expect(covers.every((cover) => cover.complete && cover.naturalWidth > 0)).toBe(true);
          const bottoms = covers.map((cover) => cover.getBoundingClientRect().bottom);
          expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(1);
          const titles = Array.from(
            preview.querySelectorAll('h4'),
            (title) => title.getBoundingClientRect().top,
          );
          expect(titles).toHaveLength(3);
          expect(Math.max(...titles) - Math.min(...titles)).toBeLessThan(1);
        });
      });
    }
  }
  for (const width of [390, 1440]) {
    it(`places cover sizing after Hide covers and applies it to the preview at ${width}px`, async () => {
      await page.viewport(width, 900);
      useLibraryStore.setState({
        library: useLibraryStore.getState().library.map((book) => ({
          ...book,
          coverImageUrl:
            'data:image/svg+xml,' +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="120"><rect width="60" height="120" fill="gray"/></svg>',
            ),
        })),
      });
      const { getByRole, getByLabelText } = render(<BookshelvesDialog />);
      await act(async () => {
        await eventDispatcher.dispatch('show-bookshelves');
      });
      const coverSizing = getByLabelText('Book covers');
      expect(coverSizing.getBoundingClientRect().top).toBeGreaterThan(
        getByLabelText('Hide covers').getBoundingClientRect().bottom,
      );
      const preview = getByRole('region', { name: 'Bookshelf preview' });
      await waitFor(() => expect(preview.querySelector('.crop-cover-img')).toBeTruthy());
      await userEvent.selectOptions(coverSizing, 'fit');
      await waitFor(() => expect(preview.querySelector('.fit-cover-img')).toBeTruthy());
      expect(preview.querySelector('.crop-cover-img')).toBeNull();
      await waitFor(() =>
        expect(saveDraft.mock.calls.at(-1)?.[2][0]).toMatchObject({ coverFit: 'fit' }),
      );
      await userEvent.click(getByRole('button', { name: 'Default' }));
      expect((coverSizing as HTMLSelectElement).value).toBe('crop');
      await waitFor(() => expect(preview.querySelector('.crop-cover-img')).toBeTruthy());
    });
  }
  for (const width of [390, 1440]) {
    it(`shows a labeled Sorting box and disables inherited controls at ${width}px`, async () => {
      await page.viewport(width, 900);
      const { getByRole, getByLabelText } = render(<BookshelvesDialog />);
      await act(async () => {
        await eventDispatcher.dispatch('show-bookshelves');
      });
      const sorting = getByRole('group', { name: 'Sorting' });
      const filters = getByRole('group', { name: 'Filters' });
      const sortingBounds = sorting.getBoundingClientRect();
      const filterBounds = filters.getBoundingClientRect();
      expect(sortingBounds.left).toBe(filterBounds.left);
      expect(sortingBounds.width).toBe(filterBounds.width);
      const inherit = getByLabelText('Use global sorting') as HTMLInputElement;
      expect(inherit.checked).toBe(true);
      for (const label of ['Sort by', 'Ascending', 'Then by', 'Secondary sort ascending']) {
        expect((getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
      }
      await userEvent.click(inherit);
      expect((getByLabelText('Sort by') as HTMLSelectElement).disabled).toBe(false);
      await userEvent.selectOptions(getByLabelText('Sort by'), 'title');
      await userEvent.click(inherit);
      expect((getByLabelText('Sort by') as HTMLSelectElement).value).toBe('updated');
      await userEvent.click(inherit);
      expect((getByLabelText('Sort by') as HTMLSelectElement).value).toBe('title');
    });
  }
  it('expands every title when they fit and collapses inactive titles as space runs out', async () => {
    await page.viewport(1440, 900);
    const { getByRole, getByLabelText } = render(<BookshelvesDialog />);
    await act(async () => {
      await eventDispatcher.dispatch('show-bookshelves');
    });
    const defaultTab = getByRole('button', { name: 'Default' });
    const recent = getByRole('button', { name: /^Recently read/ });
    const finished = getByRole('button', { name: /^Finished books/ });
    await waitFor(() => expect(defaultTab.getBoundingClientRect().width).toBeGreaterThan(44));
    expect(finished.getBoundingClientRect().width).toBeGreaterThan(44);
    expect(defaultTab.getBoundingClientRect().top).toBe(recent.getBoundingClientRect().top);
    await page.viewport(390, 900);
    await waitFor(() => expect(defaultTab.getBoundingClientRect().width).toBe(44));
    expect(finished.getBoundingClientRect().width).toBe(44);
    expect(recent.getBoundingClientRect().width).toBeGreaterThan(44);
    await page.viewport(1100, 900);
    await waitFor(() => expect(defaultTab.getBoundingClientRect().width).toBeGreaterThan(44));
    for (let i = 0; i < 4; i++) {
      await userEvent.click(getByRole('button', { name: 'Add bookshelf' }));
    }
    await waitFor(() => expect(defaultTab.getBoundingClientRect().width).toBe(44));
    await page.viewport(2000, 900);
    await waitFor(() => expect(defaultTab.getBoundingClientRect().width).toBeGreaterThan(44));
    expect(recent.getBoundingClientRect().width).toBeGreaterThan(44);
    expect(finished.getBoundingClientRect().width).toBeGreaterThan(44);
    await page.viewport(800, 900);
    await userEvent.click(getByRole('button', { name: 'Rename bookshelf' }));
    await userEvent.clear(getByLabelText('Bookshelf name'));
    await userEvent.type(getByLabelText('Bookshelf name'), 'My books');
    await userEvent.keyboard('{Enter}');
    expect(getByRole('button', { name: 'My books' }).getBoundingClientRect().width).toBeGreaterThan(
      44,
    );
    expect(defaultTab.getBoundingClientRect().width).toBe(44);
  });
  for (const width of [390, 1440]) {
    it(`edits names in the tabs at ${width}px without closing the dialog on Escape`, async () => {
      await page.viewport(width, 900);
      const { getByRole, getByLabelText, container } = render(<BookshelvesDialog />);
      await act(async () => {
        await eventDispatcher.dispatch('show-bookshelves');
      });
      const inactive = getByRole('button', { name: 'Default' });
      if (width < 600) expect(inactive.getBoundingClientRect().width).toBe(44);
      else expect(inactive.getBoundingClientRect().width).toBeGreaterThan(44);
      expect(inactive.title).toContain('Default');
      expect(getByRole('button', { name: 'Add bookshelf' }).getBoundingClientRect().width).toBe(44);
      await userEvent.click(inactive);
      expect(inactive.getBoundingClientRect().width).toBeGreaterThan(44);
      const recentWidth = getByRole('button', { name: /^Recently read/ }).getBoundingClientRect()
        .width;
      if (width < 600) expect(recentWidth).toBe(44);
      else expect(recentWidth).toBeGreaterThan(44);
      await userEvent.click(getByRole('button', { name: 'Rename bookshelf' }));
      const input = getByLabelText('Bookshelf name');
      expect(getByRole('group', { name: 'Bookshelves' }).contains(input)).toBe(true);
      const bounds = input.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThan(width);
      await userEvent.clear(input);
      await userEvent.type(input, 'Cancelled name');
      await userEvent.keyboard('{Escape}');
      expect(container.querySelector('dialog')?.open).toBe(true);
      expect(getByRole('button', { name: 'Default' })).toBeTruthy();
      await userEvent.click(getByRole('button', { name: 'Rename bookshelf' }));
      await userEvent.clear(getByLabelText('Bookshelf name'));
      await userEvent.type(getByLabelText('Bookshelf name'), 'All my books');
      await userEvent.click(getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(saveDraft).toHaveBeenCalledOnce());
      expect(
        saveDraft.mock.calls.at(-1)![2].find((s: { id: string }) => s.id === 'default').name,
      ).toBe('All my books');
    });
  }
  for (const width of [390, 1440]) {
    it(`confirms deletion at the end of the settings panel at ${width}px`, async () => {
      await page.viewport(width, 900);
      const { getByRole, getByLabelText, queryByRole, container } = render(<BookshelvesDialog />);
      await act(async () => {
        await eventDispatcher.dispatch('show-bookshelves');
      });
      await userEvent.click(getByRole('button', { name: 'Add bookshelf' }));
      await waitFor(() => expect(saveDraft).toHaveBeenCalledOnce());
      const settingsPane = getByRole('region', { name: 'Bookshelf settings' });
      expect(getByLabelText('Hide covers').getBoundingClientRect().top).toBeGreaterThan(
        getByLabelText('Carousel layout').getBoundingClientRect().bottom,
      );
      const remove = getByRole('button', { name: 'Delete' });
      const scroller = settingsPane.querySelector<HTMLElement>(
        '[data-overlayscrollbars-viewport]',
      )!;
      scroller.scrollTop = scroller.scrollHeight;
      await waitFor(() => {
        const bounds = remove.getBoundingClientRect();
        expect(bounds.right).toBeLessThanOrEqual(settingsPane.getBoundingClientRect().right);
        expect(bounds.right).toBeCloseTo(
          getByLabelText('Include books from exclusive shelves').getBoundingClientRect().right,
          0,
        );
        expect(bounds.bottom).toBeLessThanOrEqual(settingsPane.getBoundingClientRect().bottom);
      });
      await userEvent.click(remove);
      const confirmation = getByRole('dialog', { name: 'Delete bookshelf?' });
      expect(confirmation.getBoundingClientRect().width).toBeLessThanOrEqual(width);
      expect(getByRole('button', { name: 'New bookshelf 1' })).toBeTruthy();
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(queryByRole('dialog', { name: 'Delete bookshelf?' })).toBeNull());
      expect(container.querySelector('dialog')?.open).toBe(true);
      await userEvent.click(remove);
      await userEvent.click(
        within(getByRole('dialog', { name: 'Delete bookshelf?' })).getByRole('button', {
          name: 'Delete',
        }),
      );
      await waitFor(() => expect(queryByRole('button', { name: 'New bookshelf 1' })).toBeNull());
      expect(container.querySelector('dialog')?.open).toBe(true);
      await waitFor(() =>
        expect(saveDraft.mock.calls.at(-1)![2].map((s: { id: string }) => s.id)).toEqual([
          'recent',
          'audiobooks',
          'podcasts',
          'default',
          'finished',
        ]),
      );
    });
  }
  for (const width of [390, 1440]) {
    it(`confirms and autosaves reset without shifting the preview at ${width}px`, async () => {
      await page.viewport(width, 900);
      const { getByRole, getByLabelText, queryByRole, container } = render(<BookshelvesDialog />);
      await act(async () => {
        await eventDispatcher.dispatch('show-bookshelves');
      });
      expect(getByRole('button', { name: 'Add bookshelf' }).title).toBe('Add bookshelf');
      const preview = getByRole('region', { name: 'Bookshelf preview' });
      const top = preview.getBoundingClientRect().top;
      await userEvent.click(getByLabelText('Hide covers'));
      await waitFor(() => expect(getByLabelText('Bookshelf status').textContent).toBe('Saved'));
      expect(preview.getBoundingClientRect().top).toBe(top);
      await userEvent.click(getByRole('button', { name: 'Reset' }));
      const confirmation = getByRole('dialog', { name: 'Reset bookshelf?' });
      expect(confirmation.getBoundingClientRect().width).toBeLessThanOrEqual(width);
      await userEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(queryByRole('dialog', { name: 'Reset bookshelf?' })).toBeNull());
      expect((getByLabelText('Hide covers') as HTMLInputElement).checked).toBe(true);
      expect(saveDraft).toHaveBeenCalledOnce();
      await userEvent.click(getByRole('button', { name: 'Reset' }));
      await userEvent.click(
        within(getByRole('dialog', { name: 'Reset bookshelf?' })).getByRole('button', {
          name: 'Reset',
        }),
      );
      await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2));
      expect(saveDraft.mock.calls.at(-1)![2][0]).toMatchObject({
        enabled: true,
        hideCovers: false,
        layout: 'carousel',
      });
      expect(container.querySelector('dialog')?.open).toBe(true);
    });
  }
  it('keeps the editor open after a failed close-time save and allows retry', async () => {
    saveDraft.mockRejectedValue(new Error('Storage unavailable'));
    const { getByRole, getByLabelText, container } = render(<BookshelvesDialog />);
    await act(async () => {
      await eventDispatcher.dispatch('show-bookshelves');
    });
    await userEvent.click(getByLabelText('Hide covers'));
    await userEvent.click(getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(getByRole('alert', { name: 'Bookshelf status' }).textContent).toBe(
        'Storage unavailable',
      ),
    );
    expect(container.querySelector('dialog')?.open).toBe(true);
    // Both close-time saving and the queued autosave must fail before Retry is enabled.
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2));
    saveDraft.mockResolvedValue(undefined);
    await userEvent.click(getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(getByLabelText('Bookshelf status').textContent).toBe('Saved'));
    await userEvent.click(getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(container.querySelector('dialog')?.open).toBe(false));
  });
  it('reorders tabs with a long press without dismissing the mobile dialog', async () => {
    await page.viewport(390, 900);
    const { getByRole, getByLabelText, getByText, container } = render(<BookshelvesDialog />);
    await act(async () => {
      await eventDispatcher.dispatch('show-bookshelves');
    });
    fireEvent.click(getByLabelText('Enabled'));
    fireEvent.click(getByRole('button', { name: 'Rename bookshelf' }));
    fireEvent.change(getByLabelText('Bookshelf name'), { target: { value: 'A' } });
    fireEvent.keyDown(getByLabelText('Bookshelf name'), { key: 'Enter' });
    fireEvent.click(getByRole('button', { name: 'Add bookshelf' }));
    fireEvent.click(getByRole('button', { name: 'Rename bookshelf' }));
    fireEvent.change(getByLabelText('Bookshelf name'), { target: { value: 'B' } });
    fireEvent.keyDown(getByLabelText('Bookshelf name'), { key: 'Enter' });
    const source = getByRole('button', { name: 'B' });
    const from = source.getBoundingClientRect();
    const to = getByRole('button', { name: 'A' }).getBoundingClientRect();
    const start = new Touch({
      identifier: 1,
      target: source,
      clientX: from.x + from.width / 2,
      clientY: from.y + from.height / 2,
    });
    const end = new Touch({
      identifier: 1,
      target: source,
      clientX: to.x + to.width / 2,
      clientY: to.y + to.height / 2,
    });
    fireEvent.touchStart(source, { touches: [start] });
    await waitFor(() => expect(getByText('B: position 2.')).toBeTruthy());
    fireEvent.touchMove(source, { touches: [end] });
    await waitFor(() => expect(getByText('B: position 1.')).toBeTruthy());
    expect(source.getBoundingClientRect().width).toBeCloseTo(from.width, 0);
    expect(getByRole('button', { name: 'A' }).getBoundingClientRect().width).toBeCloseTo(
      to.width,
      0,
    );
    fireEvent.touchEnd(source, { touches: [], changedTouches: [end] });
    await waitFor(() =>
      expect(
        within(getByRole('group', { name: 'Bookshelves' }))
          .getAllByRole('button')
          .filter((tab) => tab.hasAttribute('aria-pressed'))
          .map((tab) => tab.textContent),
      ).toEqual(['B', 'A', 'Audiobooks', 'Podcasts', 'Default', 'Finished books(Disabled)']),
    );
    expect(container.querySelector('dialog')?.open).toBe(true);
    await waitFor(() =>
      expect(saveDraft.mock.calls.at(-1)![2].map((s: { name: string }) => s.name)).toEqual([
        'B',
        'A',
        '',
        '',
        '',
        '',
      ]),
    );
  });
  for (const width of [390, 1200, 1440])
    for (const dir of ['ltr', 'rtl']) {
      it(`places the preview correctly at ${width}px, ${dir}, with e-ink borders`, async () => {
        await page.viewport(width, 900);
        document.documentElement.dir = dir;
        document.documentElement.setAttribute('data-eink', 'true');
        const { container, getByLabelText, getByRole, queryByRole } = render(<BookshelvesDialog />);
        await act(async () => {
          await eventDispatcher.dispatch('show-bookshelves');
        });
        await waitFor(() => expect(container.querySelector('dialog')?.open).toBe(true));
        const preview = getByRole('region', { name: 'Bookshelf preview' });
        const controls = getByLabelText('Enabled');
        await waitFor(() => {
          const p = preview.getBoundingClientRect();
          const c = controls.getBoundingClientRect();
          expect(p.width).toBeGreaterThan(200);
          if (width < 600) expect(p.top).toBeGreaterThan(c.bottom);
          else expect(Math.abs(p.top - c.top)).toBeLessThan(60);
        });
        expect(getComputedStyle(preview).borderTopWidth).toBe('1px');
        const body = container.querySelector<HTMLElement>('.modal-box')!;
        await waitFor(() => {
          const bounds = body.getBoundingClientRect();
          expect(bounds.left).toBeCloseTo(0, 0);
          expect(bounds.top).toBeCloseTo(0, 0);
          expect(bounds.width).toBeCloseTo(width, 0);
          expect(bounds.height).toBeCloseTo(900, 0);
          expect(getComputedStyle(body).borderTopLeftRadius).toBe('0px');
        });
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
        const shelves = getByRole('group', { name: 'Bookshelves' });
        expect(queryByRole('button', { name: 'Save' })).toBeNull();
        expect(queryByRole('button', { name: 'Cancel' })).toBeNull();
        const tabsBounds = shelves.getBoundingClientRect();
        const renameBounds = getByRole('button', {
          name: 'Rename bookshelf',
        }).getBoundingClientRect();
        expect(renameBounds.left).toBeGreaterThanOrEqual(tabsBounds.left);
        expect(renameBounds.right).toBeLessThanOrEqual(tabsBounds.right);
        const tabs = within(shelves)
          .getAllByRole('button')
          .filter((tab) => tab.hasAttribute('aria-pressed'));
        expect(shelves.scrollWidth).toBeLessThanOrEqual(shelves.clientWidth);
        if (width >= 600) {
          expect(tabs.at(-1)!.getBoundingClientRect().top).toBe(
            tabs[0]!.getBoundingClientRect().top,
          );
          const controlBounds = Array.from(
            shelves.querySelectorAll('[data-bookshelf-control]'),
            (control) => control.getBoundingClientRect(),
          );
          const controlsCenter =
            (Math.min(...controlBounds.map((b) => b.left)) +
              Math.max(...controlBounds.map((b) => b.right))) /
            2;
          expect(controlsCenter).toBeCloseTo((tabsBounds.left + tabsBounds.right) / 2, 0);
        }
        // Two tab rows and a separate, stable-height status row on small screens.
        if (width < 600) expect(tabsBounds.height).toBeLessThanOrEqual(140);
        const settingsPane = getByRole('region', { name: 'Bookshelf settings' });
        const settingsBox = settingsPane.querySelector<HTMLElement>('.card')!;
        await waitFor(() => {
          const previewScroller = preview.querySelector('[data-virtuoso-scroller]')!;
          expect(previewScroller.hasAttribute('data-overlayscrollbars-viewport')).toBe(true);
          expect(preview.querySelector('.os-scrollbar-vertical')).toBeTruthy();
          const boxes = [settingsBox.getBoundingClientRect(), preview.getBoundingClientRect()];
          expect(Math.min(...boxes.map((box) => box.left))).toBeCloseTo(
            width - Math.max(...boxes.map((box) => box.right)),
            0,
          );
          if (width < 600) {
            expect(boxes[0]!.left).toBeCloseTo(boxes[1]!.left, 0);
            expect(boxes[0]!.right).toBeCloseTo(boxes[1]!.right, 0);
          }
        });
        const enabledLabel = getByLabelText('Enabled').closest('label')!.querySelector('span')!;
        const previewHeading = within(preview).getByRole('heading', { name: 'Live preview' });
        await waitFor(() => {
          expect(preview.getBoundingClientRect().width).toBeCloseTo(
            settingsBox.getBoundingClientRect().width,
            0,
          );
          const edge = dir === 'rtl' ? 'right' : 'left';
          expect(
            Math.abs(
              previewHeading.getBoundingClientRect()[edge] - preview.getBoundingClientRect()[edge],
            ),
          ).toBeCloseTo(
            Math.abs(
              enabledLabel.getBoundingClientRect()[edge] -
                settingsBox.getBoundingClientRect()[edge],
            ),
            0,
          );
        });
        await waitFor(() =>
          expect(settingsPane.querySelector('[data-overlayscrollbars-viewport]')).toBeTruthy(),
        );
        const settingsScroller = settingsPane.querySelector<HTMLElement>(
          '[data-overlayscrollbars-viewport]',
        )!;
        const previewTop = preview.getBoundingClientRect().top;
        const toolbarTop = shelves.getBoundingClientRect().top;
        settingsScroller.scrollTop = settingsScroller.scrollHeight;
        fireEvent.scroll(settingsScroller);
        await waitFor(() => expect(settingsScroller.scrollTop).toBeGreaterThan(0));
        expect(preview.getBoundingClientRect().top).toBe(previewTop);
        expect(shelves.getBoundingClientRect().top).toBe(toolbarTop);
        expect(preview.getBoundingClientRect().bottom).toBeLessThanOrEqual(900);
        expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight + 1);
        expect(queryByRole('separator', { name: 'Resize bookshelf preview' })).toBeNull();
        fireEvent.click(getByLabelText('Carousel layout'));
        await waitFor(() => {
          const row = preview.querySelector<HTMLElement>('[data-shelf-layout="grid"]')!;
          expect(row).toBeTruthy();
          expect(row.clientWidth / row.getBoundingClientRect().width).toBeCloseTo(2, 1);
          expect(row.children.length).toBe(3);
          const scroller = preview.querySelector<HTMLElement>('[data-virtuoso-scroller]')!;
          expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
          expect(row.getBoundingClientRect().width).toBeLessThanOrEqual(
            preview.getBoundingClientRect().width,
          );
        });
        act(() =>
          useSettingsStore.setState({
            settings: { ...useSettingsStore.getState().settings, libraryAutoColumns: true },
          }),
        );
        await waitFor(() =>
          expect(
            preview.querySelector<HTMLElement>('[data-shelf-layout="grid"]')!.children.length,
          ).toBe(width < 600 ? 4 : width < 1280 ? 6 : 8),
        );
        act(() =>
          useSettingsStore.setState({
            settings: { ...useSettingsStore.getState().settings, libraryViewMode: 'list' },
          }),
        );
        await waitFor(() =>
          expect(preview.querySelector('[data-shelf-layout="list"]')).toBeTruthy(),
        );
        expect(preview.querySelector('[inert]')).toBeTruthy();
        const rows = preview.querySelectorAll<HTMLElement>('[data-shelf-layout="list"]');
        await waitFor(() =>
          expect(
            Math.abs(
              rows[1]!.getBoundingClientRect().top - rows[0]!.getBoundingClientRect().bottom,
            ),
          ).toBeLessThan(2),
        );
        const previewScroller = preview.querySelector<HTMLElement>('[data-virtuoso-scroller]')!;
        const headingTop = previewHeading.getBoundingClientRect().top;
        await waitFor(() => {
          previewScroller.scrollTop = previewScroller.scrollHeight;
          fireEvent.scroll(previewScroller);
          expect(previewScroller.scrollTop).toBeGreaterThan(0);
          expect(within(preview).getByRole('heading', { name: 'Reading 1' })).toBeTruthy();
        });
        expect(previewHeading.getBoundingClientRect().top).toBe(headingTop);
        expect(shelves.getBoundingClientRect().top).toBe(toolbarTop);
        expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight + 1);
        await page.screenshot({ path: `../../../.next/bookshelf-editor-${width}-${dir}.png` });
      });
    }
  for (const dir of ['ltr', 'rtl']) {
    it(`reorders all shelf tabs and exclusive ownership in ${dir}`, async () => {
      await page.viewport(1440, 900);
      document.documentElement.dir = dir;
      const { getByRole, getByLabelText, getByText } = render(<BookshelvesDialog />);
      await act(async () => {
        await eventDispatcher.dispatch('show-bookshelves');
      });
      fireEvent.click(getByLabelText('Enabled'));
      fireEvent.click(getByLabelText(/^Exclusive/));
      fireEvent.click(getByRole('button', { name: 'Add bookshelf' }));
      fireEvent.click(getByRole('button', { name: 'Rename bookshelf' }));
      fireEvent.change(getByLabelText('Bookshelf name'), { target: { value: 'My shelf' } });
      fireEvent.keyDown(getByLabelText('Bookshelf name'), { key: 'Enter' });
      fireEvent.click(getByRole('button', { name: 'Add condition' }));
      fireEvent.change(getByLabelText('Filter value'), { target: { value: 'Reading' } });
      fireEvent.click(getByLabelText(/^Exclusive/));
      await waitFor(() =>
        expect(getByText('0 displayed · 24 matching · 24 excluded')).toBeTruthy(),
      );
      const shelf = getByRole('button', { name: 'My shelf' });
      const recent = getByRole('button', { name: 'Recently read' });
      const defaultTab = getByRole('button', { name: 'Default' });
      const order = () =>
        within(getByRole('group', { name: 'Bookshelves' }))
          .getAllByRole('button')
          .filter((tab) => tab.hasAttribute('aria-pressed'))
          .map((tab) => tab.textContent);
      await userEvent.dragAndDrop(shelf, recent, { steps: 10 });
      await waitFor(() =>
        expect(order()).toEqual([
          'My shelf',
          'Recently read',
          'Audiobooks',
          'Podcasts',
          'Default',
          'Finished books(Disabled)',
        ]),
      );
      await waitFor(() =>
        expect(getByText('24 displayed · 24 matching · 0 excluded')).toBeTruthy(),
      );
      await userEvent.dragAndDrop(defaultTab, shelf, { steps: 10 });
      await waitFor(() =>
        expect(order()).toEqual([
          'Default',
          'My shelf',
          'Recently read',
          'Audiobooks',
          'Podcasts',
          'Finished books(Disabled)',
        ]),
      );
      fireEvent.keyDown(shelf, { key: dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight', altKey: true });
      await waitFor(() =>
        expect(order()).toEqual([
          'Default',
          'Recently read',
          'My shelf',
          'Audiobooks',
          'Podcasts',
          'Finished books(Disabled)',
        ]),
      );
      for (let i = 0; i < 3; i++)
        fireEvent.keyDown(shelf, { key: dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight', altKey: true });
      expect(order()).toEqual([
        'Default',
        'Recently read',
        'Audiobooks',
        'Podcasts',
        'Finished books(Disabled)',
        'My shelf',
      ]);
      fireEvent.keyDown(shelf, { key: dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight', altKey: true });
      expect(order()).toEqual([
        'Default',
        'Recently read',
        'Audiobooks',
        'Podcasts',
        'Finished books(Disabled)',
        'My shelf',
      ]);
      await waitFor(() =>
        expect(saveDraft.mock.calls.at(-1)?.[2].map((s: { id: string }) => s.id)).toEqual([
          'default',
          'recent',
          'audiobooks',
          'podcasts',
          'finished',
          expect.any(String),
        ]),
      );
    });
  }
});
