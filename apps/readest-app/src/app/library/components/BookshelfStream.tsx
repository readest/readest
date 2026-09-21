import { LibraryPageDurationsContext } from '@/hooks/useMedianPageDurationSecs';
import { HideBookCoversContext } from '@/components/BookCover';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Virtuoso, type Components, type ItemProps } from 'react-virtuoso';
import { MdChevronLeft, MdChevronRight } from 'react-icons/md';
import type { Book, BooksGroup } from '@/types/book';
import type { BookshelfDefinition } from '@/types/bookshelf';
import { bookshelfName } from '@/services/bookshelves/definitions';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryPagination } from '../hooks/useLibraryPagination';

export interface ShelfSection {
  definition: BookshelfDefinition;
  items: (Book | BooksGroup)[];
  hideHeading?: boolean;
}
interface StreamProps {
  sections: ShelfSection[];
  pageDurations?: Readonly<Record<string, number>>;
  scale?: number;
  autoColumns: boolean;
  fixedColumns: number;
  renderItem: (
    item: Book | BooksGroup,
    layout: 'grid' | 'list',
    shelf: BookshelfDefinition,
  ) => ReactNode;
  footerHeight?: number;
  onScrollerRef?: (element: HTMLElement | Window | null) => void;
  importAction?: ReactNode;
  importTile?: ReactNode;
  pageNavigation?: boolean;
  navigationBottomInset?: number;
}
type StreamRow = {
  key: string;
  section: ShelfSection;
  type: 'divider' | 'heading' | 'empty' | 'carousel' | 'items';
  items?: (Book | BooksGroup)[];
  hasImport?: boolean;
};
export const bookshelfColumns = (width: number, auto: boolean, fixed: number) =>
  auto
    ? width >= 1536
      ? 12
      : width >= 1280
        ? 8
        : width >= 768
          ? 6
          : width >= 640
            ? 4
            : 3
    : Math.max(1, Math.min(24, Math.floor(fixed || 3)));
export const buildBookshelfRows = (
  sections: ShelfSection[],
  columns: number,
  includeImport = false,
): StreamRow[] =>
  sections.flatMap((section, index) => {
    const hasImport =
      includeImport && index === sections.length - 1 && section.definition.layout !== 'carousel';
    const rows: StreamRow[] = index
      ? [{ key: `${section.definition.id}:divider`, section, type: 'divider' }]
      : [];
    if (!section.hideHeading)
      rows.push({ key: `${section.definition.id}:heading`, section, type: 'heading' });
    if (!section.items.length) {
      rows.push({ key: `${section.definition.id}:empty`, section, type: 'empty' });
      if (!hasImport) return rows;
    }
    if (section.definition.layout === 'carousel')
      return [...rows, { key: `${section.definition.id}:carousel`, section, type: 'carousel' }];
    const count = section.definition.layout === 'grid' ? columns : 1;
    for (let i = 0; i < section.items.length + Number(hasImport); i += count)
      rows.push({
        key: `${section.definition.id}:row:${i}`,
        section,
        type: 'items',
        items: section.items.slice(i, i + count),
        hasImport: hasImport && i + count > section.items.length,
      });
    return rows;
  });
const itemKey = (item: Book | BooksGroup) => ('hash' in item ? item.hash : item.id);

/** A bounded horizontal window; vertical scrolling belongs only to the parent stream. */
export const BookshelfCarousel = ({
  section,
  columns,
  width,
  renderItem,
}: {
  section: ShelfSection;
  columns: number;
  width: number;
  renderItem: StreamProps['renderItem'];
}) => {
  const _ = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [coverCenter, setCoverCenter] = useState<number | null>(null);
  const compact = typeof window !== 'undefined' && window.innerWidth < 640;
  const gap = compact ? 16 : 0;
  const itemWidth = Math.max(40, (width - (compact ? 32 : 16) + gap) / columns);
  // Clamped to the list: a shelf that shrinks while scrolled to the end would
  // otherwise leave `start` past `end` and render no cards.
  const windowStart = (value: number) =>
    Math.min(
      Math.max(0, Math.floor(value / itemWidth) - columns),
      Math.max(0, section.items.length - columns * 3),
    );
  const showPrevious = (value: number) => value > 1;
  const showNext = (value: number) =>
    viewportWidth > 0 && value + viewportWidth < itemWidth * section.items.length - 1;
  const start = windowStart(offset);
  const end = Math.min(section.items.length, start + columns * 3);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => {
      setViewportWidth(element.clientWidth);
      const cover = element.querySelector('.bookitem-main');
      if (cover) {
        const bounds = cover.getBoundingClientRect();
        const viewport = element.getBoundingClientRect();
        const scale = viewport.width / element.offsetWidth || 1;
        setCoverCenter((bounds.top - viewport.top + bounds.height / 2) / scale);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width, columns, section.items]);
  const scrollPage = (direction: number, smooth = false) => {
    const element = scroller.current;
    if (!element) return;
    const rtl = getComputedStyle(element).direction === 'rtl';
    element.scrollBy({
      left: direction * (rtl ? -1 : 1) * (smooth ? element.clientWidth * 0.8 : itemWidth * columns),
      behavior: smooth ? 'smooth' : 'instant',
    });
  };
  return (
    <HideBookCoversContext.Provider value={section.definition.hideCovers}>
      <div className='group/carousel relative px-4 sm:px-2' data-shelf-layout='carousel'>
        <div
          ref={scroller}
          onScroll={(e) => {
            const next = Math.abs(e.currentTarget.scrollLeft);
            // Every raw scroll event would otherwise re-render the whole
            // window; only a changed window or edge arrow is visible.
            setOffset((current) =>
              windowStart(next) === windowStart(current) &&
              showPrevious(next) === showPrevious(current) &&
              showNext(next) === showNext(current)
                ? current
                : next,
            );
          }}
          className='no-scrollbar overflow-x-auto overflow-y-hidden overscroll-x-contain'
          tabIndex={0}
          aria-label={_('Scroll books')}
        >
          <div className='flex items-stretch' style={{ width: itemWidth * section.items.length }}>
            <div aria-hidden style={{ width: start * itemWidth, flexShrink: 0 }} />
            {section.items.slice(start, end).map((item) => (
              <div
                key={itemKey(item)}
                className='min-w-0 shrink-0'
                style={{ width: itemWidth, paddingInlineEnd: gap }}
              >
                {renderItem(item, 'grid', section.definition)}
              </div>
            ))}
            <div
              aria-hidden
              style={{ width: (section.items.length - end) * itemWidth, flexShrink: 0 }}
            />
          </div>
        </div>
        {[-1, 1].map((direction) => {
          if (!(direction < 0 ? showPrevious(offset) : showNext(offset))) return null;
          const Icon = direction < 0 ? MdChevronLeft : MdChevronRight;
          return (
            <button
              key={direction}
              type='button'
              aria-label={direction < 0 ? _('Scroll left') : _('Scroll right')}
              onClick={() => scrollPage(direction, true)}
              style={{ top: coverCenter ?? '50%' }}
              className={`eink:hidden bg-base-100 border-base-content/10 hover:border-base-content/30 pointer-events-none absolute -translate-y-1/2 rounded-full border p-1 opacity-0 shadow-xs transition-[opacity,border-color] duration-200 group-hover/carousel:pointer-events-auto group-hover/carousel:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 ${direction < 0 ? 'start-2' : 'end-2'}`}
            >
              <Icon
                size={20}
                className='text-base-content/60 hover:text-base-content/80 rtl:rotate-180'
              />
            </button>
          );
        })}
        {section.items.length > columns && (
          <div className='not-eink:hidden flex justify-end gap-2 pb-1 sm:px-4 sm:pb-3'>
            {[-1, 1].map((direction) => (
              <button
                key={direction}
                type='button'
                className='btn btn-ghost eink-bordered min-h-11'
                aria-label={direction < 0 ? _('Previous books') : _('Next books')}
                onClick={() => scrollPage(direction)}
              >
                {direction < 0 ? _('Previous') : _('Next')}
              </button>
            ))}
          </div>
        )}
      </div>
    </HideBookCoversContext.Provider>
  );
};
interface StreamContext {
  height: number;
  action?: ReactNode;
  scale: number;
}
const StreamItem = ({
  children,
  context,
  item,
  ...props
}: ItemProps<StreamRow> & { context?: StreamContext }) => (
  <div {...props} data-page-row={item.type}>
    {context && context.scale !== 1 ? (
      // Scale row content only: Virtuoso's viewport and spacers stay in screen pixels.
      <div style={{ zoom: context.scale }}>{children}</div>
    ) : (
      children
    )}
  </div>
);
const StreamFooter = ({ context }: { context?: StreamContext }) => (
  <div style={{ paddingBottom: context?.height || 34 }}>{context?.action}</div>
);
const COMPONENTS: Components<StreamRow, StreamContext> = {
  Item: StreamItem,
  Footer: StreamFooter,
};
export default function BookshelfStream({
  sections,
  autoColumns,
  fixedColumns,
  renderItem,
  footerHeight = 34,
  onScrollerRef,
  importAction,
  importTile,
  pageDurations,
  scale = 1,
  pageNavigation = false,
  navigationBottomInset = 0,
}: StreamProps) {
  const _ = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const handleScrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      setScroller(element instanceof HTMLElement ? element : null);
      onScrollerRef?.(element);
    },
    [onScrollerRef],
  );
  const [start, setStart] = useState(true);
  const [end, setEnd] = useState(true);
  const turnPage = useLibraryPagination(scroller, pageNavigation);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      setWidth(element.clientWidth);
      setHeight(element.clientHeight);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  const columns = bookshelfColumns(width / scale, autoColumns, fixedColumns);
  const includeImport = !!importTile;
  const rows = useMemo(
    () => buildBookshelfRows(sections, columns, includeImport),
    [sections, columns, includeImport],
  );
  const context = useMemo(
    () => ({ height: footerHeight, action: importAction, scale }),
    [footerHeight, importAction, scale],
  );
  return (
    <LibraryPageDurationsContext.Provider value={pageDurations || {}}>
      <div
        ref={root}
        className='flex h-full min-h-0 w-full flex-col'
        data-testid='bookshelf-stream'
      >
        <div className='min-h-0 flex-1'>
          <Virtuoso
            style={scale !== 1 ? { overflowX: 'hidden' } : undefined}
            data={rows}
            overscan={pageNavigation ? Math.max(400, height) : 400}
            defaultItemHeight={200}
            context={context}
            components={COMPONENTS}
            scrollerRef={handleScrollerRef}
            atTopStateChange={setStart}
            atBottomStateChange={setEnd}
            atTopThreshold={1}
            atBottomThreshold={1}
            computeItemKey={(_, row) => row.key}
            itemContent={(_index, row) => {
              const { definition } = row.section;
              const name = definition.name || _(bookshelfName(definition));
              if (row.type === 'divider')
                return (
                  <div
                    aria-hidden='true'
                    className={`transform-wrapper px-4 pt-1 sm:px-6 ${row.section.hideHeading ? 'pb-2' : 'pb-1'}`}
                  >
                    <hr className='border-base-content/10 eink:border-base-content border-t' />
                  </div>
                );
              if (row.type === 'heading')
                return (
                  <h2
                    data-shelf-id={definition.id}
                    className='transform-wrapper px-4 pb-1 pt-2 text-sm font-semibold sm:px-6 sm:pt-4'
                  >
                    {name}
                  </h2>
                );
              if (row.type === 'empty')
                return (
                  <p className='text-base-content/60 transform-wrapper px-4 py-8 text-sm sm:px-6'>
                    {row.section.hideHeading ? _('No books') : _('No books in {{name}}', { name })}
                  </p>
                );
              if (row.type === 'carousel')
                return (
                  <div className='transform-wrapper'>
                    <BookshelfCarousel
                      section={row.section}
                      columns={columns}
                      width={width / scale}
                      renderItem={renderItem}
                    />
                  </div>
                );
              return (
                <HideBookCoversContext.Provider value={definition.hideCovers}>
                  <div
                    data-shelf-layout={definition.layout}
                    className='bookshelf-items transform-wrapper grid gap-x-4 px-4 sm:gap-x-0 sm:px-2'
                    style={{
                      gridTemplateColumns: `repeat(${definition.layout === 'grid' ? columns : 1}, minmax(0, 1fr))`,
                    }}
                  >
                    {row.items!.map((item) => (
                      <div key={`${definition.id}:${itemKey(item)}`} className='min-w-0'>
                        {renderItem(
                          item,
                          definition.layout === 'list' ? 'list' : 'grid',
                          definition,
                        )}
                      </div>
                    ))}
                    {row.hasImport && <div className='min-w-0'>{importTile}</div>}
                  </div>
                </HideBookCoversContext.Provider>
              );
            }}
          />
        </div>
        {pageNavigation && (
          <nav
            aria-label={_('Pagination')}
            className='not-eink:hidden bg-base-100 border-base-content shrink-0 border-t px-4 sm:px-6'
            style={{ paddingBottom: navigationBottomInset }}
          >
            <div className='flex justify-end gap-2 py-2'>
              <button
                type='button'
                className='btn btn-ghost eink-bordered min-h-11'
                aria-label={_('Previous page')}
                disabled={start}
                onClick={() => turnPage(-1)}
              >
                {_('Previous')}
              </button>
              <button
                type='button'
                className='btn btn-ghost eink-bordered min-h-11'
                aria-label={_('Next page')}
                disabled={end}
                onClick={() => turnPage(1)}
              >
                {_('Next')}
              </button>
            </div>
          </nav>
        )}
      </div>
    </LibraryPageDurationsContext.Provider>
  );
}
