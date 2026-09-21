import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';
import BookCover from '@/components/BookCover';
import BookshelfItem from '@/app/library/components/BookshelfItem';
import { createBookshelf } from '@/services/bookshelves/definitions';
import BookshelfStream, {
  BookshelfCarousel,
  type ShelfSection,
} from '@/app/library/components/BookshelfStream';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/library/hooks/useOpenBook', () => ({
  useOpenBook: () => ({ openBook: vi.fn() }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, values?: Record<string, unknown>) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));
await import('@/styles/globals.css');
afterEach(async () => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
  await page.viewport(1280, 900);
});
const books = (count: number): Book[] =>
  Array.from({ length: count }, (_, index) => ({
    hash: `${index}`,
    title: `Book ${index}`,
    author: 'Writer',
    format: 'EPUB',
    createdAt: index,
    updatedAt: index,
  }));
const section = (
  id: string,
  layout: ShelfSection['definition']['layout'],
  count: number,
): ShelfSection => ({ definition: { ...createBookshelf(id, id), layout }, items: books(count) });
const renderItem: React.ComponentProps<typeof BookshelfStream>['renderItem'] = (
  item,
  mode,
  shelf,
) => (
  <button
    tabIndex={0}
    data-book={'hash' in item ? item.hash : item.id}
    data-section={shelf.id}
    className='eink-bordered w-full border p-2'
    style={{ height: mode === 'grid' ? 180 : 64 }}
  >
    {'title' in item ? item.title : item.name}
  </button>
);
describe('mixed bookshelf stream in Chromium', () => {
  it('shows the library page controls only in e-ink mode', () => {
    const { queryByRole } = render(
      <div style={{ width: 900, height: 600 }}>
        <BookshelfStream
          pageNavigation
          sections={[section('books', 'grid', 30)]}
          autoColumns={false}
          fixedColumns={3}
          renderItem={renderItem}
        />
      </div>,
    );
    expect(queryByRole('button', { name: 'Next page' })).toBeNull();
    document.documentElement.setAttribute('data-eink', 'true');
    expect(queryByRole('button', { name: 'Next page' })).not.toBeNull();
    document.documentElement.setAttribute('data-eink', 'false');
    expect(queryByRole('button', { name: 'Next page' })).toBeNull();
    expect(queryByRole('button', { name: 'Previous page' })).toBeNull();
  });
  it('keeps a heading with its first grid row across mixed shelves and reaches the last page', async () => {
    document.documentElement.setAttribute('data-eink', 'true');
    const { container, getByRole } = render(
      <div style={{ width: 900, height: 600 }}>
        <BookshelfStream
          pageNavigation
          sections={[section('List', 'list', 5), section('Grid', 'grid', 18)]}
          autoColumns={false}
          fixedColumns={3}
          renderItem={renderItem}
        />
      </div>,
    );
    const scroller = container.querySelector<HTMLElement>('[data-virtuoso-scroller]')!;
    const next = getByRole('button', { name: 'Next page' });
    await waitFor(() => expect(next.hasAttribute('disabled')).toBe(false));
    // Use browser input so clicks do not outrun Virtuoso's layout/scroll updates.
    await userEvent.click(next);
    await waitFor(() => {
      const heading = getByRole('heading', { name: 'Grid' }).getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      expect(heading.top).toBeGreaterThanOrEqual(viewport.top);
      expect(heading.top - viewport.top).toBeLessThan(20);
      const first = container.querySelector('[data-section="Grid"]')!.getBoundingClientRect();
      expect(first.bottom).toBeLessThanOrEqual(viewport.bottom);
    });
    container.firstElementChild!.setAttribute('style', 'width: 700px; height: 450px');
    await waitFor(() => expect(scroller.clientHeight).toBeLessThan(450));
    for (let i = 0; i < 10 && !next.hasAttribute('disabled'); i++) {
      const before = scroller.scrollTop;
      await userEvent.click(next);
      await waitFor(() =>
        expect(scroller.scrollTop > before || next.hasAttribute('disabled')).toBe(true),
      );
    }
    await waitFor(() => expect(next.hasAttribute('disabled')).toBe(true));
    const last = container.querySelector('[data-section="Grid"][data-book="17"]')!;
    expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scroller.getBoundingClientRect().bottom,
    );
  });
  for (const layout of ['grid', 'list'] as const) {
    it(`pages ${layout} by complete rows and ignores keys in inputs and dialogs`, async () => {
      document.documentElement.setAttribute('data-eink', 'true');
      const { container, getByRole } = render(
        <div style={{ width: 900, height: 600 }}>
          <input aria-label='Search library' />
          <BookshelfStream
            pageNavigation
            sections={[section('books', layout, 120)]}
            autoColumns={false}
            fixedColumns={3}
            renderItem={renderItem}
          />
        </div>,
      );
      const next = getByRole('button', { name: 'Next page' });
      const previous = getByRole('button', { name: 'Previous page' });
      const scroller = container.querySelector<HTMLElement>('[data-virtuoso-scroller]')!;
      await waitFor(() => expect(next.hasAttribute('disabled')).toBe(false));
      expect(previous.hasAttribute('disabled')).toBe(true);
      await userEvent.click(next);
      await waitFor(() => {
        expect(scroller.scrollTop).toBeGreaterThan(0);
        expect(previous.hasAttribute('disabled')).toBe(false);
        const top = scroller.getBoundingClientRect().top;
        const row = Array.from(container.querySelectorAll('.bookshelf-items')).find(
          (el) => Math.abs(el.getBoundingClientRect().top - top) < 1,
        );
        expect(row).toBeTruthy();
        expect(next.getBoundingClientRect().top).toBeGreaterThanOrEqual(
          scroller.getBoundingClientRect().bottom,
        );
      });
      await userEvent.click(previous);
      await waitFor(() => expect(scroller.scrollTop).toBe(0));
      fireEvent.keyDown(window, { key: 'PageDown', code: 'PageDown' });
      await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));
      const offset = scroller.scrollTop;
      fireEvent.keyDown(getByRole('textbox'), { key: 'PageDown', code: 'PageDown' });
      expect(scroller.scrollTop).toBe(offset);
      const dialog = document.createElement('dialog');
      document.body.append(dialog);
      dialog.showModal();
      try {
        fireEvent.keyDown(window, { key: 'PageDown', code: 'PageDown' });
        expect(scroller.scrollTop).toBe(offset);
      } finally {
        dialog.remove();
      }
    });
  }
  for (const width of [375, 900]) {
    for (const scenario of ['carousel', 'grid', 'eink-carousel'] as const) {
      const eink = scenario === 'eink-carousel';
      const layout = scenario === 'grid' ? 'grid' : 'carousel';
      it(`matches divider gaps for ${scenario} shelves at ${width}px`, async () => {
        await page.viewport(width, 900);
        document.documentElement.setAttribute('data-eink', String(eink));
        const noop = () => {};
        const transfer = async () => true;
        const { container, getByRole } = render(
          <div style={{ width, height: 900 }}>
            <BookshelfStream
              sections={[
                section('First', layout, 3),
                section('Audiobooks', layout, 3),
                { ...section('Default', layout, 3), hideHeading: true },
              ]}
              autoColumns={false}
              fixedColumns={eink ? 2 : 3}
              renderItem={(item, mode) => (
                <BookshelfItem
                  item={item}
                  mode={mode}
                  coverFit='crop'
                  isSelectMode={false}
                  itemSelected={false}
                  transferProgress={null}
                  setLoading={noop}
                  toggleSelection={noop}
                  handleGroupBooks={noop}
                  handleBookDownload={transfer}
                  handleBookUpload={transfer}
                  handleBookDelete={transfer}
                  handleSetSelectMode={noop}
                  handleShowDetailsBook={noop}
                  handleLibraryNavigation={noop}
                  handleUpdateReadingStatus={noop}
                  showTimeRemaining={false}
                />
              )}
            />
          </div>,
        );
        await waitFor(() => {
          const cards = container.querySelectorAll('.book-item');
          expect(cards.length).toBeGreaterThan(0);
          const previousBottom = cards[0]!.getBoundingClientRect().bottom;
          if (eink) {
            const carousel = container.querySelector('[data-shelf-layout="carousel"]')!;
            const buttons = carousel.querySelectorAll('button');
            const previous = buttons[buttons.length - 2]!.getBoundingClientRect();
            const next = buttons[buttons.length - 1]!.getBoundingClientRect();
            const divider = container.querySelector('hr')!.getBoundingClientRect();
            expect(next.right).toBeCloseTo(divider.right, 1);
            expect(previous.top).toBe(next.top);
            expect(next.top - previousBottom).toBeGreaterThan(0);
            expect(divider.top - next.bottom).toBeCloseTo(next.top - previousBottom, 1);
            return;
          }
          expect(cards).toHaveLength(9);
          const coverTop = cards[3]!.querySelector('.bookitem-main')!.getBoundingClientRect().top;
          const heading = getByRole('heading', { name: 'Audiobooks' });
          const headingBounds = heading.getBoundingClientRect();
          const style = getComputedStyle(heading);
          const titleTop = headingBounds.top + parseFloat(style.paddingTop);
          const titleBottom = headingBounds.bottom - parseFloat(style.paddingBottom);
          const divider = container.querySelector('hr')!.getBoundingClientRect();
          const gap = coverTop - titleBottom;
          expect(gap).toBeGreaterThan(0);
          expect(divider.top - previousBottom).toBeCloseTo(gap, 1);
          expect(titleTop - divider.bottom).toBeCloseTo(gap, 1);
          const defaultCoverTop = cards[6]!
            .querySelector('.bookitem-main')!
            .getBoundingClientRect().top;
          const defaultDivider = container.querySelectorAll('hr')[1]!.getBoundingClientRect();
          // Untitled shelves also need the visual breathing room below the title's text.
          expect(defaultCoverTop - defaultDivider.bottom).toBeCloseTo(width < 640 ? 16 : 24, 1);
        });
      });
    }
  }
  for (const width of [375, 900]) {
    it(`insets list rows by the row's own responsive padding only at ${width}px`, async () => {
      await page.viewport(width, 900);
      const noop = () => {};
      const transfer = async () => true;
      const { container } = render(
        <div style={{ width, height: 900 }}>
          <BookshelfStream
            sections={[section('List', 'list', 2)]}
            autoColumns={false}
            fixedColumns={3}
            renderItem={(item, mode) => (
              <BookshelfItem
                item={item}
                mode={mode}
                coverFit='crop'
                isSelectMode={false}
                itemSelected={false}
                transferProgress={null}
                setLoading={noop}
                toggleSelection={noop}
                handleGroupBooks={noop}
                handleBookDownload={transfer}
                handleBookUpload={transfer}
                handleBookDelete={transfer}
                handleSetSelectMode={noop}
                handleShowDetailsBook={noop}
                handleLibraryNavigation={noop}
                handleUpdateReadingStatus={noop}
                showTimeRemaining={false}
              />
            )}
          />
        </div>,
      );
      await waitFor(() => {
        const row = container.querySelector('.book-item')!.getBoundingClientRect();
        const shelf = container
          .querySelector('[data-shelf-layout="list"]')!
          .getBoundingClientRect();
        const inset = width < 640 ? 16 : 24;
        expect(row.left - shelf.left).toBeCloseTo(inset, 1);
        expect(shelf.right - row.right).toBeCloseTo(inset, 1);
      });
    });
  }
  it('keeps virtual row measurements correct while scrolling a scaled preview', async () => {
    const { container } = render(
      <div style={{ width: 900, height: 600 }}>
        <BookshelfStream
          scale={0.5}
          sections={[section('scaled', 'list', 5000)]}
          autoColumns
          fixedColumns={6}
          renderItem={renderItem}
        />
      </div>,
    );
    const scroller = container.querySelector<HTMLElement>('[data-virtuoso-scroller]')!;
    await waitFor(() => expect(container.querySelector('[data-book="0"]')).toBeTruthy());
    await waitFor(() => {
      // Unseen rows start with estimated heights; keep scrolling to the updated end.
      scroller.scrollTop = scroller.scrollHeight;
      fireEvent.scroll(scroller);
      const last = container.querySelector<HTMLElement>('[data-book="4999"]')!;
      expect(last).toBeTruthy();
      expect(last.getBoundingClientRect().height).toBe(32);
      expect(
        Math.abs(
          last.getBoundingClientRect().bottom - (scroller.getBoundingClientRect().bottom - 34),
        ),
      ).toBeLessThan(2);
    });
    expect(container.querySelectorAll('[data-book]').length).toBeLessThan(100);
  });
  it('updates cover visibility independently in carousel and grid shelves', async () => {
    const items = books(6).map((book) => ({
      ...book,
      coverImageUrl:
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/%3E',
    }));
    const renderCovers = (hidden: boolean) => (
      <div style={{ width: 900, height: 900 }}>
        <BookshelfStream
          autoColumns
          fixedColumns={6}
          sections={[
            {
              definition: { ...createBookshelf('Carousel', 'carousel'), hideCovers: hidden },
              items,
            },
            {
              definition: {
                ...createBookshelf('Grid', 'grid'),
                layout: 'grid',
                hideCovers: !hidden,
              },
              items,
            },
          ]}
          renderItem={(item) => (
            <div style={{ height: 180 }}>{'hash' in item && <BookCover book={item} />}</div>
          )}
        />
      </div>
    );
    const { container, rerender } = render(renderCovers(true));
    await waitFor(() =>
      expect(container.querySelector('[data-shelf-layout="grid"] img')).toBeTruthy(),
    );
    expect(container.querySelector('[data-shelf-layout="carousel"] img')).toBeNull();
    rerender(renderCovers(false));
    await waitFor(() =>
      expect(container.querySelector('[data-shelf-layout="carousel"] img')).toBeTruthy(),
    );
    expect(container.querySelector('[data-shelf-layout="grid"] img')).toBeNull();
  });
  for (const eink of [false, true]) {
    it(`uses ${eink ? 'page buttons' : 'scroll arrows'} for carousel navigation`, async () => {
      document.documentElement.setAttribute('data-eink', String(eink));
      const { container, getByRole, queryByRole } = render(
        <div style={{ width: 900 }}>
          <BookshelfCarousel
            section={section('navigation', 'carousel', 12)}
            width={900}
            columns={6}
            renderItem={renderItem}
          />
          <button>Outside carousel</button>
        </div>,
      );
      expect(!!queryByRole('button', { name: 'Next books' })).toBe(eink);
      expect(!!queryByRole('button', { name: 'Scroll right' })).toBe(!eink);
      if (!eink) {
        const next = getByRole('button', { name: 'Scroll right' });
        await userEvent.click(getByRole('button', { name: 'Outside carousel' }));
        await waitFor(() => expect(getComputedStyle(next).opacity).toBe('0'));
        await page.getByRole('button', { name: 'Book 0', exact: true }).hover();
        await waitFor(() => expect(getComputedStyle(next).opacity).toBe('1'));
        await userEvent.click(next);
      } else {
        fireEvent.click(getByRole('button', { name: 'Next books' }));
      }
      await waitFor(() =>
        expect(
          container.querySelector<HTMLElement>('.overflow-x-auto')!.scrollLeft,
        ).toBeGreaterThan(0),
      );
      if (!eink) {
        const previous = await waitFor(() => getByRole('button', { name: 'Scroll left' }));
        const outside = getByRole('button', { name: 'Outside carousel' });
        await userEvent.hover(outside);
        await waitFor(() => expect(getComputedStyle(previous).opacity).toBe('0'));
        await userEvent.click(outside);
        await userEvent.tab({ shift: true });
        const next = getByRole('button', { name: 'Scroll right' });
        expect(document.activeElement).toBe(next);
        await waitFor(() => expect(getComputedStyle(next).opacity).toBe('1'));
      }
    });
  }
  for (const width of [375, 900, 1600]) {
    for (const dir of ['ltr', 'rtl']) {
      it(`virtualizes a large library at ${width}px in ${dir}`, async () => {
        const { container } = render(
          <div dir={dir} data-eink='true' style={{ width, height: 600 }}>
            <BookshelfStream
              sections={[
                section('carousel', 'carousel', 12),
                section('grid', 'grid', 3000),
                section('list', 'list', 3000),
                section('empty', 'list', 0),
              ]}
              autoColumns
              fixedColumns={3}
              renderItem={renderItem}
            />
          </div>,
        );
        await waitFor(() =>
          expect(container.querySelector('[data-shelf-id="carousel"]')).toBeTruthy(),
        );
        expect(container.querySelectorAll('[data-virtuoso-scroller]')).toHaveLength(1);
        expect(container.querySelectorAll('[data-book]').length).toBeLessThan(150);
        const scroller = container.querySelector<HTMLElement>('[data-virtuoso-scroller]')!;
        scroller.scrollTop = scroller.scrollHeight;
        fireEvent.scroll(scroller);
        await waitFor(() => expect(container.textContent).toContain('No books in empty'));
        expect(container.querySelectorAll('[data-book]').length).toBeLessThan(150);
        const root = container.querySelector<HTMLElement>('[data-testid="bookshelf-stream"]')!;
        expect(root.scrollWidth).toBeLessThanOrEqual(width + 1);
      });
    }
  }
  it('keeps very large carousels horizontally virtualized and scrollable', async () => {
    document.documentElement.setAttribute('data-eink', 'true');
    const { container, getByRole } = render(
      <div style={{ width: 900 }}>
        <BookshelfCarousel
          section={section('many', 'carousel', 10000)}
          width={900}
          columns={6}
          renderItem={renderItem}
        />
      </div>,
    );
    expect(container.querySelectorAll('[data-book]')).toHaveLength(18);
    fireEvent.click(getByRole('button', { name: 'Next books' }));
    await waitFor(() =>
      expect(container.querySelector<HTMLElement>('.overflow-x-auto')!.scrollLeft).toBeGreaterThan(
        0,
      ),
    );
    expect(container.querySelectorAll('[data-book]').length).toBeLessThanOrEqual(18);
  });
});
