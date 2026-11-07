import clsx from 'clsx';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
  type DragMoveEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, type SortingStrategy } from '@dnd-kit/sortable';
import { CSS as DndCSS } from '@dnd-kit/utilities';
import { MdDragIndicator, MdArrowUpward, MdOutlineFolder, MdFolder, MdCheck } from 'react-icons/md';
import BookCover from '@/components/BookCover';
import { useTranslation } from '@/hooks/useTranslation';
import type { Book, BooksGroup } from '@/types/book';
import type { BookshelfDefinition } from '@/types/bookshelf';
import { resolveBookshelfGroupBy } from '@/services/bookshelves/grouping';
import { bookshelfItemId } from '@/services/bookshelves/ordering';
import type { LibraryGroupByType } from '@/types/settings';
import type { ShelfSection } from './BookshelfStream';

type DropMode = 'before' | 'after' | 'group';
export type BookshelfDrop = {
  source: Book | BooksGroup;
  shelf: BookshelfDefinition;
} & ({ target: Book | BooksGroup; mode: DropMode } | { target?: never; mode: 'parent' });
interface DragItem {
  item: Book | BooksGroup;
  shelf: BookshelfDefinition;
}
interface Intent {
  id: string;
  mode: DropMode | 'group-pending' | 'parent';
}
const dragId = (shelf: BookshelfDefinition, item: Book | BooksGroup) =>
  JSON.stringify([shelf.id, bookshelfItemId(item)]);
const parentDropId = (shelf: BookshelfDefinition) => `parent:${shelf.id}`;
const motionAllowed = (element: HTMLElement | null) =>
  !!element &&
  !element.closest('[data-eink="true"]') &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DropContext = createContext<{
  intent: Intent | null;
  move: (shelf: BookshelfDefinition, item: Book | BooksGroup, step: number) => void;
  moveParent?: (shelf: BookshelfDefinition, item: Book | BooksGroup) => void;
}>({ intent: null, move: () => {} });

export const BookshelfDragDrop = ({
  sections,
  groupBy,
  disabled,
  onDrop,
  children,
  parentGroupName = '',
}: {
  sections: ShelfSection[];
  groupBy: LibraryGroupByType;
  disabled: boolean;
  onDrop: (drop: BookshelfDrop) => void | Promise<void>;
  children: ReactNode;
  parentGroupName?: string;
}) => {
  const _ = useTranslation();
  const [active, setActive] = useState<(DragItem & { width: number }) | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const intentRef = useRef<Intent | null>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const skipReturnAnimation = useRef(false);
  const fadingOverlays = useRef(new Set<{ node: HTMLElement; animation: Animation }>());
  const fadeIntoDestination = () => {
    const current = overlay.current;
    if (!current || !motionAllowed(root.current) || typeof current.animate !== 'function') return;
    const rect = current.getBoundingClientRect();
    const node = current.cloneNode(true) as HTMLElement;
    node.setAttribute('aria-hidden', 'true');
    // Viewport rectangles use physical coordinates even in RTL layouts.
    Object.assign(node.style, {
      position: 'fixed',
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      transform: 'none',
      zIndex: '80',
    });
    document.body.append(node);
    const animation = node.animate(
      [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(0.9)' },
      ],
      { duration: 140, easing: 'ease-out' },
    );
    const entry = { node, animation };
    fadingOverlays.current.add(entry);
    const cleanup = () => {
      node.remove();
      fadingOverlays.current.delete(entry);
    };
    void animation.finished.then(cleanup, cleanup);
  };
  const settling = useRef<{ rects: Map<string, DOMRect>; sourceId: string } | null>(null);
  const captureLayout = (sourceId: string) => {
    if (!motionAllowed(root.current)) return;
    settling.current = {
      sourceId,
      rects: new Map(
        Array.from(root.current!.querySelectorAll<HTMLElement>('[data-bookshelf-drag-id]')).map(
          (node) => [node.dataset['bookshelfDragId']!, node.getBoundingClientRect()],
        ),
      ),
    };
  };
  useLayoutEffect(() => {
    if (disabled || !settling.current || !root.current) return;
    const snapshot = settling.current;
    settling.current = null;
    if (!motionAllowed(root.current)) return;
    const animations: Animation[] = [];
    root.current.querySelectorAll<HTMLElement>('[data-bookshelf-drag-id]').forEach((node) => {
      const id = node.dataset['bookshelfDragId']!;
      if (id === snapshot.sourceId || typeof node.animate !== 'function') return;
      const before = snapshot.rects.get(id);
      const after = node.getBoundingClientRect();
      if (before && (Math.abs(before.x - after.x) > 1 || Math.abs(before.y - after.y) > 1))
        animations.push(
          node.animate(
            [
              { transform: `translate(${before.x - after.x}px, ${before.y - after.y}px)` },
              { transform: 'translate(0px, 0px)' },
            ],
            { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
          ),
        );
      else if (!before)
        animations.push(node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 }));
    });
    return () => animations.forEach((animation) => animation.cancel());
  }, [sections, disabled]);
  const items = useMemo(
    () =>
      new Map(
        sections.flatMap(({ definition: shelf, items }) =>
          items.map((item) => [dragId(shelf, item), { shelf, item }] as const),
        ),
      ),
    [sections],
  );
  const itemIds = useMemo(() => [...items.keys()], [items]);
  const itemIndexes = useMemo(() => new Map(itemIds.map((id, index) => [id, index])), [itemIds]);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
  );
  const clearPending = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      fadingOverlays.current.forEach(({ node, animation }) => {
        animation.cancel();
        node.remove();
      });
      fadingOverlays.current.clear();
    },
    [],
  );
  const showIntent = (next: Intent | null) => {
    intentRef.current = next;
    setIntent((current) =>
      current?.id === next?.id && current?.mode === next?.mode ? current : next,
    );
  };
  const reset = () => {
    clearPending();
    showIntent(null);
    setActive(null);
  };
  const collisionDetection: CollisionDetection = (args) => {
    pointer.current = args.pointerCoordinates;
    const source = items.get(String(args.active.id));
    const eligible = args.droppableContainers.filter(
      (container) =>
        container.id !== args.active.id &&
        (items.get(String(container.id))?.shelf.id === source?.shelf.id ||
          (!!source && !!parentGroupName && container.id === parentDropId(source.shelf))),
    );
    const options = { ...args, droppableContainers: eligible };
    const hits = args.pointerCoordinates ? pointerWithin(options) : closestCenter(options);
    const parent = source && hits.find((hit) => hit.id === parentDropId(source.shelf));
    return parent ? [parent] : hits;
  };
  const updateIntent = (event: DragMoveEvent) => {
    const source = items.get(String(event.active.id));
    if (
      source &&
      parentGroupName &&
      Math.hypot(event.delta.x, event.delta.y) > 10 &&
      event.over?.id === parentDropId(source.shelf)
    ) {
      clearPending();
      showIntent({ id: String(event.over.id), mode: 'parent' });
      return;
    }
    const target = event.over && items.get(String(event.over.id));
    if (!source || !target || source.shelf.id !== target.shelf.id || disabled) {
      clearPending();
      showIntent(null);
      return;
    }
    const rect = event.over!.rect;
    const point = pointer.current;
    if (!point) return;
    const layout = target.shelf.layout;
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
    const after =
      layout === 'list'
        ? point.y > rect.top + rect.height / 2
        : point.x > rect.left + rect.width / 2 !== rtl;
    const center =
      point.x > rect.left + rect.width * 0.25 &&
      point.x < rect.right - rect.width * 0.25 &&
      point.y > rect.top + rect.height * 0.2 &&
      point.y < rect.bottom - rect.height * 0.2;
    const id = String(event.over!.id);
    const canGroup =
      center && 'hash' in source.item && resolveBookshelfGroupBy(target.shelf, groupBy) === 'group';
    if (!canGroup) {
      clearPending();
      showIntent({ id, mode: after ? 'after' : 'before' });
      return;
    }
    if (pending.current === id) return;
    clearPending();
    pending.current = id;
    showIntent({ id, mode: 'group-pending' });
    timer.current = setTimeout(() => showIntent({ id, mode: 'group' }), 450);
  };
  const move = (shelf: BookshelfDefinition, item: Book | BooksGroup, step: number) => {
    if (disabled || active) return;
    const section = sections.find((section) => section.definition.id === shelf.id);
    const index =
      section?.items.findIndex(
        (candidate) => bookshelfItemId(candidate) === bookshelfItemId(item),
      ) ?? -1;
    const target = section?.items[index + step];
    if (index >= 0 && target) {
      captureLayout(dragId(shelf, item));
      void Promise.resolve(
        onDrop({ source: item, target, shelf, mode: step < 0 ? 'before' : 'after' }),
      ).then(() => {
        requestAnimationFrame(() => {
          const cell = root.current?.querySelector<HTMLElement>(
            `[data-bookshelf-drag-id="${CSS.escape(dragId(shelf, item))}"] [role="button"]`,
          );
          cell?.focus({ preventScroll: true });
          cell?.scrollIntoView({ block: 'nearest' });
        });
      });
    }
  };
  const moveParent = (shelf: BookshelfDefinition, item: Book | BooksGroup) => {
    if (
      !disabled &&
      !active &&
      parentGroupName &&
      resolveBookshelfGroupBy(shelf, groupBy) === 'group'
    ) {
      captureLayout(dragId(shelf, item));
      void onDrop({ source: item, shelf, mode: 'parent' });
    }
  };
  const strategy: SortingStrategy = (args) => {
    if (!intent || !active || (intent.mode !== 'before' && intent.mode !== 'after')) return null;
    const target = itemIndexes.get(intent.id) ?? -1;
    const direction = intent.mode === 'before' ? 1 : -1;
    const offset =
      args.index === target
        ? direction * 6
        : args.index === target - direction
          ? -direction * 6
          : 0;
    if (!offset || items.get(itemIds[args.index]!)?.shelf.id !== active.shelf.id) return null;
    const list = items.get(intent.id)?.shelf.layout === 'list';
    const rtl = root.current && getComputedStyle(root.current).direction === 'rtl';
    return { x: list ? 0 : offset * (rtl ? -1 : 1), y: list ? offset : 0, scaleX: 1, scaleY: 1 };
  };
  const parentName = parentGroupName.slice(0, Math.max(0, parentGroupName.lastIndexOf('/')));
  const grouping = intent?.mode === 'group' || intent?.mode === 'group-pending';
  const ActionIcon =
    intent?.mode === 'parent' ? MdArrowUpward : grouping ? MdOutlineFolder : MdDragIndicator;
  const actionLabel =
    intent?.mode === 'parent'
      ? _('Move to parent group')
      : grouping
        ? _('Group Books')
        : _('Drag to reorder');
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{
        screenReaderInstructions: { draggable: _('Drag to reorder') },
        announcements: {
          onDragStart: () => _('Drag to reorder'),
          onDragOver: ({ over }) => {
            const item = over && items.get(String(over.id))?.item;
            return item ? ('hash' in item ? item.title : item.displayName) : undefined;
          },
          onDragEnd: ({ over }) => (over ? _('Done') : _('Reordering cancelled.')),
          onDragCancel: () => _('Reordering cancelled.'),
        },
      }}
      onDragStart={(event) => {
        skipReturnAnimation.current = false;
        const data = items.get(String(event.active.id));
        if (data && !disabled)
          setActive({ ...data, width: event.active.rect.current.initial?.width ?? 120 });
      }}
      onDragMove={updateIntent}
      onDragOver={updateIntent}
      onDragCancel={reset}
      onDragEnd={(event) => {
        const source = items.get(String(event.active.id));
        const target = event.over && items.get(String(event.over.id));
        const drop = intentRef.current;
        skipReturnAnimation.current = drop?.mode === 'group' || drop?.mode === 'parent';
        if (skipReturnAnimation.current) fadeIntoDestination();
        reset();
        if (
          !disabled &&
          source &&
          parentGroupName &&
          event.over?.id === parentDropId(source.shelf) &&
          drop?.mode === 'parent'
        ) {
          captureLayout(String(event.active.id));
          void onDrop({ source: source.item, shelf: source.shelf, mode: 'parent' });
          return;
        }
        if (
          !disabled &&
          source &&
          target &&
          source.shelf.id === target.shelf.id &&
          drop?.id === String(event.over?.id) &&
          drop.mode !== 'group-pending' &&
          drop.mode !== 'parent'
        ) {
          captureLayout(String(event.active.id));
          onDrop({
            source: source.item,
            target: target.item,
            shelf: source.shelf,
            mode: drop.mode,
          });
        }
      }}
    >
      <DropContext.Provider value={{ intent, move, moveParent }}>
        <SortableContext items={itemIds} disabled={disabled} strategy={strategy}>
          <div ref={root} className='contents' data-dragging={active ? 'true' : undefined}>
            {active &&
              parentGroupName &&
              resolveBookshelfGroupBy(active.shelf, groupBy) === 'group' && (
                <BookshelfParentDrop
                  shelf={active.shelf}
                  name={parentName ? parentName.split('/').at(-1)! : _('Library')}
                />
              )}
            {children}
          </div>
        </SortableContext>
      </DropContext.Provider>
      <DragOverlay
        dropAnimation={
          !skipReturnAnimation.current && motionAllowed(root.current)
            ? { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
            : null
        }
        zIndex={80}
      >
        {active && (
          <div
            ref={overlay}
            className='bookshelf-drag-preview pointer-events-none relative mx-auto'
            data-grouping={grouping || undefined}
            style={{ width: Math.min(active.width * 0.86, 164) }}
          >
            <div
              className={clsx(
                'bookshelf-drag-cover bg-base-100 aspect-28/41 w-full overflow-hidden rounded-sm',
                'books' in active.item && 'bg-base-200 grid grid-cols-2 grid-rows-2 gap-1 p-1',
              )}
            >
              {('hash' in active.item ? [active.item] : active.item.books.slice(0, 4)).map(
                (book) => (
                  <BookCover
                    key={book.hash}
                    book={book}
                    isPreview={'books' in active.item}
                    imageClassName='shadow-none!'
                  />
                ),
              )}
            </div>
            <p
              role='status'
              className='bookshelf-drag-action eink-bordered bg-base-100 border-base-content/15 absolute start-1/2 top-full mt-2 flex w-max max-w-60 -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium rtl:translate-x-1/2'
            >
              <ActionIcon aria-hidden className='size-4 shrink-0' />
              <span className='truncate'>{actionLabel}</span>
            </p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
};

const BookshelfParentDrop = ({ shelf, name }: { shelf: BookshelfDefinition; name: string }) => {
  const _ = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: parentDropId(shelf) });
  return (
    <div
      ref={setNodeRef}
      role='group'
      aria-label={_('Move to parent group')}
      data-parent-drop
      data-over={isOver || undefined}
      className='bookshelf-parent-drop eink-bordered bg-base-100 border-base-content/15 absolute inset-x-4 top-2 z-30 mx-auto flex min-h-16 max-w-sm items-center gap-3 rounded-xl border px-4 py-2 text-sm'
    >
      <span className='bg-base-200 flex size-8 shrink-0 items-center justify-center rounded-full'>
        <MdArrowUpward aria-hidden className='size-5' />
      </span>
      <span className='min-w-0 flex-1'>
        <span className='block font-medium'>{_('Move to parent group')}</span>
        <span className='text-base-content/60 block truncate text-xs' dir='auto'>
          {name}
        </span>
      </span>
      {isOver && <MdCheck aria-hidden className='size-5' />}
    </div>
  );
};

export const BookshelfDragItem = ({
  item,
  shelf,
  disabled,
  children,
}: DragItem & {
  disabled: boolean;
  children: ReactNode;
}) => {
  const id = dragId(shelf, item);
  const { setNodeRef, listeners, isDragging, transform } = useSortable({ id, disabled });
  const { intent, move, moveParent } = useContext(DropContext);
  const target = intent?.id === id ? intent.mode : null;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if (
          !(event.target as HTMLElement).closest(
            'button,a,input,select,textarea,[contenteditable="true"]',
          )
        )
          listeners?.['onMouseDown']?.(event);
      }}
      onTouchStart={(event) => {
        if (
          !(event.target as HTMLElement).closest(
            'button,a,input,select,textarea,[contenteditable="true"]',
          )
        )
          listeners?.['onTouchStart']?.(event);
      }}
      data-bookshelf-drag-id={id}
      data-drop-intent={target ?? undefined}
      style={{
        transform: !isDragging
          ? DndCSS.Transform.toString(transform ? { ...transform, scaleX: 1, scaleY: 1 } : null)
          : undefined,
      }}
      className={clsx(
        'bookshelf-drag-item group/drag relative h-full min-w-0',
        isDragging && 'opacity-30 eink:opacity-100',
      )}
      onDragStart={(event) => event.preventDefault()}
      onContextMenuCapture={(event) => {
        if (isDragging) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDownCapture={(event) => {
        if (disabled || !event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.shiftKey && event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          moveParent?.(shelf, item);
          return;
        }
        const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
        const step =
          event.key === 'ArrowUp'
            ? -1
            : event.key === 'ArrowDown'
              ? 1
              : event.key === 'ArrowLeft'
                ? rtl
                  ? 1
                  : -1
                : event.key === 'ArrowRight'
                  ? rtl
                    ? -1
                    : 1
                  : 0;
        if (step) {
          event.preventDefault();
          event.stopPropagation();
          move(shelf, item, step);
        }
      }}
    >
      {children}
      {!disabled && (
        <MdDragIndicator
          aria-hidden
          className='text-base-content/60 pointer-events-none absolute start-1 top-3 size-5 opacity-0 group-hover/drag:opacity-100 group-focus-within/drag:opacity-100'
        />
      )}
      {(target === 'before' || target === 'after') && (
        <div
          aria-hidden
          className={clsx(
            'bookshelf-drop-marker bg-base-content pointer-events-none absolute rounded-full',
            shelf.layout === 'list'
              ? `inset-x-2 h-0.5 ${target === 'before' ? 'top-0' : 'bottom-0'}`
              : `inset-y-3 w-0.5 ${target === 'before' ? '-start-1' : '-end-1'}`,
          )}
        />
      )}
      {(target === 'group' || target === 'group-pending') && (
        <div
          aria-hidden
          className='bookshelf-group-target eink-bordered border-base-content/25 pointer-events-none absolute inset-1 rounded-xl border'
        >
          <span className='bookshelf-group-hint eink-bordered bg-base-100 border-base-content/15 absolute end-2 top-2 flex size-10 items-center justify-center overflow-hidden rounded-full border'>
            {target === 'group' ? (
              <MdFolder className='size-5' />
            ) : (
              <MdOutlineFolder className='size-5' />
            )}
            {target === 'group-pending' && (
              <span className='bookshelf-group-progress bg-base-content absolute inset-x-1 bottom-1 h-0.5 rounded-full' />
            )}
          </span>
        </div>
      )}
    </div>
  );
};
