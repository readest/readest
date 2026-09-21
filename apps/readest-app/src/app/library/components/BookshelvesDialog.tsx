import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import { useSearchParams } from 'next/navigation';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  MdAdd,
  MdCollectionsBookmark,
  MdEdit,
  MdHistory,
  MdHeadphones,
  MdPodcasts,
  MdLibraryBooks,
  MdTaskAlt,
} from 'react-icons/md';
import { OverlayScrollbarsComponent, useOverlayScrollbars } from 'overlayscrollbars-react';
import Dialog from '@/components/Dialog';
import BoxedList from '@/components/settings/primitives/BoxedList';
import SettingsRow from '@/components/settings/primitives/SettingsRow';
import SettingsSelect from '@/components/settings/primitives/SettingsSelect';
import SettingsSwitchRow from '@/components/settings/primitives/SettingsSwitchRow';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { isAbsBookOrphaned, useABSServerStore } from '@/store/absServerStore';
import { useMedianPageDurationsSecs } from '@/hooks/useMedianPageDurationSecs';
import { useBookshelfDate } from '@/hooks/useBookshelfDate';
import { useEnv } from '@/context/EnvContext';
import { eventDispatcher } from '@/utils/event';
import { getGlobalBookshelfSort, resolveBookshelfSort } from '@/services/bookshelves/sorting';
import { resolveBookshelfGroupBy } from '@/services/bookshelves/grouping';
import { ensureLibraryGroupByType } from '../utils/libraryUtils';
import {
  bookshelfName,
  resolveBookshelfLayout,
  bookshelfSchema,
  createBookshelf,
  defaultBookshelves,
  isBuiltinBookshelf,
  BOOKSHELF_SORT_LABELS,
  BOOKSHELF_GROUP_LABELS,
  RECENT_BOOKSHELF_ID,
  AUDIOBOOKS_BOOKSHELF_ID,
  PODCASTS_BOOKSHELF_ID,
  DEFAULT_BOOKSHELF_ID,
  FINISHED_BOOKSHELF_ID,
} from '@/services/bookshelves/definitions';
import { readBookshelves } from '@/services/bookshelves/state';
import { saveBookshelfDraft } from '@/services/bookshelves/persistence';
import { discoverBookshelfFields } from '@/services/bookshelves/fields';
import { evaluateBookshelves, matchBookshelves } from '@/services/bookshelves/evaluate';
import { presentBookshelf } from '@/services/bookshelves/presentation';
import type { BookshelfDefinition, BookshelfSort } from '@/types/bookshelf';
import BookshelfFilterEditor from './BookshelfFilterEditor';
import BookshelfStream, { type ShelfSection } from './BookshelfStream';
import BookshelfItem from './BookshelfItem';

const noop = () => {};
const noopAsync = async () => false;
function BookshelfTab({
  shelf,
  selected,
  onSelect,
  onMove,
  onRename,
}: {
  shelf: BookshelfDefinition;
  selected: boolean;
  onSelect: () => void;
  onMove: (direction: number) => void;
  onRename: (name: string) => void;
}) {
  const _ = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: shelf.id,
    disabled: editing,
    transition: null,
  });
  const name = shelf.name || _(bookshelfName(shelf));
  const Icon =
    shelf.id === RECENT_BOOKSHELF_ID
      ? MdHistory
      : shelf.id === DEFAULT_BOOKSHELF_ID
        ? MdLibraryBooks
        : shelf.id === AUDIOBOOKS_BOOKSHELF_ID
          ? MdHeadphones
          : shelf.id === PODCASTS_BOOKSHELF_ID
            ? MdPodcasts
            : shelf.id === FINISHED_BOOKSHELF_ID
              ? MdTaskAlt
              : MdCollectionsBookmark;
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  const rename = () => {
    onSelect();
    setEditName(name);
    setEditing(true);
  };
  const finishRename = () => {
    const value = editName.trim();
    if (value !== name && (value || isBuiltinBookshelf(shelf.id))) onRename(value);
    setEditing(false);
  };
  return (
    <div
      ref={setNodeRef}
      data-bookshelf-control
      className={`eink-bordered flex h-11 max-w-full shrink-0 items-center rounded-lg sm:max-w-64 ${selected ? 'bg-base-200' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), zIndex: isDragging ? 1 : undefined }}
    >
      {editing ? (
        <input
          ref={inputRef}
          aria-label={_('Bookshelf name')}
          className='input eink-bordered h-11 w-52 min-w-0 text-sm font-semibold'
          maxLength={120}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={finishRename}
          onKeyDownCapture={(e) => {
            if (e.nativeEvent.isComposing || !['Enter', 'Escape'].includes(e.key)) return;
            if (e.key === 'Enter') finishRename();
            else setEditing(false);
            e.preventDefault();
            e.stopPropagation();
            requestAnimationFrame(() => buttonRef.current?.focus());
          }}
        />
      ) : (
        <>
          <button
            ref={buttonRef}
            type='button'
            {...attributes}
            {...listeners}
            aria-pressed={selected}
            aria-keyshortcuts='F2 Alt+ArrowLeft Alt+ArrowRight'
            data-bookshelf-tab={shelf.id}
            title={
              shelf.enabled
                ? _('{{name}} · Drag to reorder', { name })
                : _('{{name}} (disabled) · Drag to reorder', { name })
            }
            className={`btn btn-ghost h-11 min-h-11 min-w-0 cursor-grab touch-pan-x select-none focus-visible:ring-2 focus-visible:ring-base-content/15 active:cursor-grabbing flex-1 px-3 ${selected ? 'eink:underline eink:underline-offset-4' : 'group-data-[collapsed=true]/bookshelf-tabs:w-11 group-data-[collapsed=true]/bookshelf-tabs:flex-none group-data-[collapsed=true]/bookshelf-tabs:px-0'}`}
            onClick={onSelect}
            onDoubleClick={rename}
            onTouchStartCapture={(e) => {
              listeners?.['onTouchStart']?.(e);
              e.stopPropagation();
            }}
            onKeyDownCapture={(e) => {
              if (e.key === 'F2') rename();
              else if (e.altKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
                const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
                onMove((e.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1));
              } else return;
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <Icon
              aria-hidden
              className={`h-5 w-5 shrink-0 ${shelf.enabled ? '' : 'opacity-50 eink:opacity-100'}`}
            />
            <span
              className={
                selected
                  ? 'truncate'
                  : 'truncate group-data-[collapsed=true]/bookshelf-tabs:sr-only'
              }
            >
              {name}
            </span>
            {!shelf.enabled && <span className='sr-only'>({_('Disabled')})</span>}
          </button>
          {selected && (
            <button
              type='button'
              aria-label={_('Rename bookshelf')}
              title={_('Rename bookshelf')}
              className='btn btn-ghost h-11 min-h-11 w-11 shrink-0 px-0 focus-visible:ring-2 focus-visible:ring-base-content/15'
              onClick={rename}
            >
              <MdEdit aria-hidden className='h-4 w-4' />
            </button>
          )}
        </>
      )}
    </div>
  );
}

export interface BookshelvesEditorHandle {
  flush: () => Promise<boolean>;
}
export function BookshelvesEditor({ ref }: { ref?: Ref<BookshelvesEditorHandle> }) {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const searchParams = useSearchParams();
  const settings = useSettingsStore((s) => s.settings);
  const viewMode = searchParams?.get('view') || settings.libraryViewMode;
  const globalSort = useMemo(
    () => getGlobalBookshelfSort(settings, searchParams),
    [settings, searchParams],
  );
  const globalGroupBy = ensureLibraryGroupByType(
    searchParams?.get('groupBy'),
    settings.libraryGroupBy,
  );
  const uiLanguage = localStorage.getItem('i18nextLng') || '';
  const library = useLibraryStore((s) => s.library);
  const servers = useABSServerStore((s) => s.servers);
  const [base] = useState(() => readBookshelves(settings));
  const [draft, setDraft] = useState(base);
  const [selectedId, setSelectedId] = useState(() => {
    const lastTab = localStorage.getItem('lastBookshelfTab');
    return base.find((shelf) => shelf.id === lastTab)?.id ?? base[0]!.id;
  });
  useEffect(() => {
    localStorage.setItem('lastBookshelfTab', selectedId);
  }, [selectedId]);
  const tabsRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const tabLabels = draft.map((s) => s.name || _(bookshelfName(s))).join('\0');
  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    const status = statusRef.current;
    if (!tabs || !status) return;
    const controls = Array.from(tabs.querySelectorAll<HTMLElement>('[data-bookshelf-control]'));
    const measure = () => {
      // Measure the expanded tabs before paint, even when currently collapsed.
      tabs.dataset['collapsed'] = 'false';
      const gap = parseFloat(getComputedStyle(tabs).columnGap) || 0;
      const spacerStyle = getComputedStyle(tabs.firstElementChild!);
      const spacerWidth =
        spacerStyle.display === 'none' ? 0 : parseFloat(spacerStyle.minWidth) || 0;
      const required =
        controls.reduce((width, tab) => width + tab.getBoundingClientRect().width, 0) +
        gap * controls.length +
        parseFloat(getComputedStyle(status).minWidth) +
        (spacerWidth ? spacerWidth + gap : 0);
      tabs.dataset['collapsed'] = String(required > tabs.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tabs);
    controls.forEach((control) => observer.observe(control));
    return () => observer.disconnect();
  }, [tabLabels, selectedId]);
  const [debounced, setDebounced] = useState(draft);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const saved = useRef(base);
  const latestValid = useRef(base);
  const lastValidShelf = useRef(new Map(base.map((s) => [s.id, s])));
  const includeBeforeExclusive = useRef(new Map<string, boolean>());
  const saveQueue = useRef(Promise.resolve(true));
  const mounted = useRef(true);
  const saveContext = useRef({ envConfig, _ });
  saveContext.current = { envConfig, _ };
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{
    shelf: BookshelfDefinition;
    action: 'reset' | 'delete';
  } | null>(null);
  const [previewScroller, setPreviewScroller] = useState<HTMLElement | null>(null);
  const [initializePreviewScroll, previewScrollInstance] = useOverlayScrollbars({
    defer: true,
    options: {
      overflow: { x: 'hidden', y: 'scroll' },
      scrollbars: { autoHide: 'scroll', clickScroll: true },
      showNativeOverlaidScrollbars: false,
    },
    events: {
      initialized(instance) {
        const { viewport } = instance.elements();
        viewport.style.overflowX = 'var(--os-viewport-overflow-x)';
        viewport.style.overflowY = 'var(--os-viewport-overflow-y)';
      },
    },
  });
  useEffect(() => {
    const root = previewScroller?.parentElement;
    if (previewScroller && root)
      initializePreviewScroll({ target: root, elements: { viewport: previewScroller } });
    return () => previewScrollInstance()?.destroy();
  }, [previewScroller, initializePreviewScroll, previewScrollInstance]);
  const handlePreviewScrollerRef = useCallback((element: HTMLElement | Window | null) => {
    setPreviewScroller(element instanceof HTMLElement ? element : null);
  }, []);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const cancelConfirmation = (focus?: HTMLElement | null) => {
    setConfirmation(null);
    (
      focus ?? (confirmation?.action === 'reset' ? resetButtonRef : deleteButtonRef).current
    )?.focus();
  };
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const tabName = (id: string | number) => {
    const shelf = draft.find((s) => s.id === id);
    return shelf ? shelf.name || _(bookshelfName(shelf)) : '';
  };
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(draft), 180);
    return () => clearTimeout(timer);
  }, [draft]);
  const selected = draft.find((s) => s.id === selectedId)!;
  const useGlobalGrouping = selected.useGlobalGrouping !== false;
  const selectedGroupBy = resolveBookshelfGroupBy(selected, globalGroupBy);
  const useGlobalSort = selected.useGlobalSort !== false;
  const selectedSort = resolveBookshelfSort(selected, globalSort);
  const fields = useMemo(() => discoverBookshelfFields(library), [library]);
  const books = useMemo(
    () => library.filter((b) => !b.deletedAt && !isAbsBookOrphaned(b)),
    [library, servers, settings],
  );
  const previewDefinitions = useMemo(
    () =>
      debounced.map((s) => ({
        ...s,
        enabled: s.id === selectedId || s.enabled,
        sort: resolveBookshelfSort(s, globalSort),
      })),
    [debounced, selectedId, globalSort],
  );
  const pageDurations = useMedianPageDurationsSecs(
    library,
    previewDefinitions.some(
      (s) => s.enabled && (s.sort.by === 'timeRemaining' || s.sort.thenBy === 'timeRemaining'),
    ),
  );
  const today = useBookshelfDate(previewDefinitions);
  const preview = useMemo(
    () =>
      evaluateBookshelves(
        books,
        previewDefinitions,
        uiLanguage,
        pageDurations,
        matchBookshelves(books, previewDefinitions, today),
      ).find((s) => s.definition.id === selectedId),
    [books, previewDefinitions, selectedId, uiLanguage, pageDurations, today],
  );
  const previewSections = useMemo<ShelfSection[]>(
    () =>
      preview
        ? [
            {
              definition: {
                ...preview.definition,
                layout: resolveBookshelfLayout(preview.definition, viewMode),
              },
              items: presentBookshelf(
                preview,
                { ...settings, libraryGroupBy: globalGroupBy },
                uiLanguage,
                pageDurations,
              ),
            },
          ]
        : [],
    [preview, settings, globalGroupBy, viewMode, uiLanguage, pageDurations],
  );
  const results = draft.map((s) => ({ shelf: s, result: bookshelfSchema.safeParse(s) }));
  const invalid = results.find((s) => !s.result.success);
  const enabledCount = draft.filter((s) => s.enabled).length;
  const priorityShelf = draft.find(
    (s) => s.id === FINISHED_BOOKSHELF_ID && s.enabled && s.exclusive,
  );
  const validation =
    invalid && !invalid.result.success
      ? `${invalid.shelf.name || _(bookshelfName(invalid.shelf))}: ${_(invalid.result.error.issues[0]?.message || 'Complete every filter condition.')}`
      : !enabledCount
        ? _('Keep at least one bookshelf enabled.')
        : '';
  const update = (patch: Partial<BookshelfDefinition>) => {
    setError('');
    setDraft((shelves) => shelves.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)));
  };
  const sort = (patch: Partial<BookshelfSort>) => update({ sort: { ...selected.sort, ...patch } });
  const move = (id: string, target: number) => {
    const index = draft.findIndex((s) => s.id === id);
    if (index < 0 || target < 0 || target >= draft.length) return;
    const next = arrayMove(draft, index, target);
    setDraft(next);
    setDebounced(next);
  };
  // One incomplete shelf must not freeze the others: each shelf falls back to its own last valid
  // version, and a shelf that was never valid is left out of the snapshot.
  results.forEach(({ shelf, result }) => {
    if (result.success) lastValidShelf.current.set(shelf.id, shelf);
  });
  const validDraft = draft.flatMap((s) => lastValidShelf.current.get(s.id) ?? []);
  if (enabledCount && validDraft.some((s) => s.enabled)) latestValid.current = validDraft;
  const flush = useCallback(() => {
    const snapshot = latestValid.current;
    const persist = async () => {
      if (JSON.stringify(saved.current) === JSON.stringify(snapshot)) return true;
      const { envConfig, _ } = saveContext.current;
      if (mounted.current) {
        setSaving(true);
        setSavedNotice(false);
        setError('');
      }
      try {
        await saveBookshelfDraft(envConfig, saved.current, snapshot);
        saved.current = snapshot;
        if (mounted.current) {
          setSavedNotice(true);
        }
        return true;
      } catch (cause) {
        if (mounted.current)
          setError(cause instanceof Error ? _(cause.message) : _('Failed to save bookshelves.'));
        return false;
      } finally {
        if (mounted.current) setSaving(false);
      }
    };
    saveQueue.current = saveQueue.current.then(persist, persist);
    return saveQueue.current;
  }, []);
  useImperativeHandle(ref, () => ({ flush }), [flush]);
  useEffect(() => {
    setSavedNotice(false);
    const timer = setTimeout(() => void flush(), 180);
    return () => clearTimeout(timer);
  }, [draft, flush]);
  useEffect(() => {
    if (!savedNotice) return;
    const timer = setTimeout(() => setSavedNotice(false), 2000);
    return () => clearTimeout(timer);
  }, [savedNotice]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void flush();
    };
  }, [flush]);
  const sortOptions = Object.entries(BOOKSHELF_SORT_LABELS)
    .filter(([value]) => value !== 'size')
    .map(([value, label]) => ({ value, label: _(label) }));
  const renderPreview = useCallback<React.ComponentProps<typeof BookshelfStream>['renderItem']>(
    (item, mode, shelf) => (
      <div inert className='pointer-events-none h-full select-none'>
        <BookshelfItem
          item={item}
          mode={mode}
          coverFit={shelf.coverFit || 'crop'}
          skeuomorphicCovers={shelf.skeuomorphicCovers}
          isSelectMode={false}
          itemSelected={false}
          transferProgress={null}
          setLoading={noop}
          toggleSelection={noop}
          handleGroupBooks={noop}
          handleBookUpload={noopAsync}
          handleBookDownload={noopAsync}
          handleBookDelete={noopAsync}
          handleSetSelectMode={noop}
          handleShowDetailsBook={noop}
          handleLibraryNavigation={noop}
          handleUpdateReadingStatus={noop}
          showTimeRemaining={
            shelf.sort.by === 'timeRemaining' || shelf.sort.thenBy === 'timeRemaining'
          }
        />
      </div>
    ),
    [],
  );
  return (
    <fieldset className='flex h-full min-h-0 min-w-0 flex-col gap-4'>
      <div
        ref={tabsRef}
        className='group/bookshelf-tabs bg-base-100 z-20 flex min-w-0 shrink-0 flex-wrap items-center justify-center gap-2 py-2'
        role='group'
        aria-label={_('Bookshelves')}
      >
        <div aria-hidden className='hidden min-w-16 flex-1 sm:block' />
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{
            announcements: {
              onDragStart: ({ active }) => _('Picked up {{name}}.', { name: tabName(active.id) }),
              onDragOver: ({ active, over }) =>
                over
                  ? _('{{name}}: position {{position}}.', {
                      name: tabName(active.id),
                      position: draft.findIndex((s) => s.id === over.id) + 1,
                    })
                  : undefined,
              onDragEnd: ({ active }) => _('Dropped {{name}}.', { name: tabName(active.id) }),
              onDragCancel: () => _('Reordering cancelled.'),
            },
            screenReaderInstructions: {
              draggable: _(
                'Drag to reorder, or use Alt + Left or Right arrow keys. Press F2 to rename.',
              ),
            },
          }}
          onDragEnd={({ active, over }) => {
            if (over && active.id !== over.id)
              move(
                String(active.id),
                draft.findIndex((s) => s.id === over.id),
              );
          }}
        >
          <SortableContext items={draft.map((s) => s.id)} strategy={rectSortingStrategy}>
            {draft.map((s, index) => (
              <BookshelfTab
                key={s.id}
                shelf={s}
                selected={s.id === selectedId}
                onSelect={() => setSelectedId(s.id)}
                onMove={(direction) => move(s.id, index + direction)}
                onRename={(name) =>
                  setDraft((shelves) =>
                    shelves.map((current) =>
                      current.id === s.id ? { ...current, name } : current,
                    ),
                  )
                }
              />
            ))}
          </SortableContext>
        </DndContext>
        <button
          type='button'
          data-bookshelf-control
          aria-label={_('Add bookshelf')}
          title={_('Add bookshelf')}
          className='btn btn-ghost eink-bordered border-base-200 h-11 min-h-11 w-11 shrink-0 rounded-full border px-0 focus-visible:ring-2 focus-visible:ring-base-content/15'
          onClick={() => {
            let number = 1;
            while (draft.some((s) => s.name === _('New bookshelf {{number}}', { number })))
              number++;
            const shelf = createBookshelf(_('New bookshelf {{number}}', { number }));
            const index = draft.findIndex((s) => s.id === RECENT_BOOKSHELF_ID) + 1;
            setDraft([...draft.slice(0, index), shelf, ...draft.slice(index)]);
            setSelectedId(shelf.id);
          }}
        >
          <MdAdd aria-hidden className='h-5 w-5' />
        </button>
        <div
          ref={statusRef}
          className='flex min-h-5 min-w-16 flex-1 basis-full items-center justify-end gap-2 text-end text-sm sm:basis-0'
        >
          <p
            role={error || validation ? 'alert' : 'status'}
            aria-label={_('Bookshelf status')}
            className={error || validation ? 'text-error' : 'text-base-content/65'}
          >
            {error || validation || (saving ? _('Saving...') : savedNotice ? _('Saved') : '')}
          </p>
          {error && (
            <button
              type='button'
              className='btn btn-ghost eink-bordered h-11 min-h-11'
              onClick={() => void flush()}
            >
              {_('Retry')}
            </button>
          )}
        </div>
      </div>
      <div className='grid min-h-0 min-w-0 flex-1 grid-rows-2 gap-4 lg:grid-cols-2 lg:grid-rows-1 lg:gap-6'>
        <OverlayScrollbarsComponent
          role='region'
          aria-label={_('Bookshelf settings')}
          className='-me-4 h-full min-h-0 min-w-0'
          options={{
            overflow: { x: 'hidden', y: 'scroll' },
            scrollbars: { autoHide: 'scroll', clickScroll: true },
            showNativeOverlaidScrollbars: false,
          }}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <div className='space-y-4 pb-2 pe-4'>
            <BoxedList>
              <SettingsSwitchRow
                label={_('Enabled')}
                checked={selected.enabled}
                disabled={selected.enabled && enabledCount === 1}
                onChange={() => update({ enabled: !selected.enabled })}
              />
              <SettingsSwitchRow
                label={_('Carousel layout')}
                checked={selected.layout === 'carousel'}
                onChange={() =>
                  update({
                    layout:
                      selected.layout === 'carousel'
                        ? viewMode === 'list'
                          ? 'list'
                          : 'grid'
                        : 'carousel',
                  })
                }
              />
              <SettingsSwitchRow
                label={_('Hide covers')}
                checked={!!selected.hideCovers}
                onChange={() => update({ hideCovers: !selected.hideCovers })}
              />
              <SettingsRow label={_('Book covers')}>
                <SettingsSelect
                  ariaLabel={_('Book covers')}
                  value={selected.coverFit || 'crop'}
                  options={[
                    { value: 'crop', label: _('Crop') },
                    { value: 'fit', label: _('Fit') },
                  ]}
                  onChange={(e) =>
                    update({ coverFit: e.target.value as BookshelfDefinition['coverFit'] })
                  }
                />
              </SettingsRow>
              <SettingsSwitchRow
                label={_('Skeuomorphic covers')}
                checked={!!selected.skeuomorphicCovers}
                onChange={() => update({ skeuomorphicCovers: !selected.skeuomorphicCovers })}
              />
            </BoxedList>
            <BookshelfFilterEditor
              group={selected.filters}
              fields={fields}
              onChange={(filters) => update({ filters })}
            />
            <fieldset className='eink-bordered border-base-200 min-w-0 rounded-lg border ps-4'>
              <legend className='-ms-1 px-1 text-sm'>{_('Grouping')}</legend>
              <div className='divide-base-200 divide-y'>
                <SettingsSwitchRow
                  label={_('Use global grouping')}
                  checked={useGlobalGrouping}
                  onChange={() => update({ useGlobalGrouping: !useGlobalGrouping })}
                />
                <SettingsRow label={_('Group by')} disabled={useGlobalGrouping}>
                  <SettingsSelect
                    ariaLabel={_('Group by')}
                    value={selectedGroupBy}
                    disabled={useGlobalGrouping}
                    options={Object.entries(BOOKSHELF_GROUP_LABELS).map(([value, label]) => ({
                      value,
                      label: _(label),
                    }))}
                    onChange={(e) =>
                      update({ groupBy: e.target.value as BookshelfDefinition['groupBy'] })
                    }
                  />
                </SettingsRow>
              </div>
            </fieldset>
            <fieldset className='eink-bordered border-base-200 min-w-0 rounded-lg border ps-4'>
              <legend className='-ms-1 px-1 text-sm'>{_('Sorting')}</legend>
              <div className='divide-base-200 divide-y'>
                <SettingsSwitchRow
                  label={_('Use global sorting')}
                  checked={useGlobalSort}
                  onChange={() => update({ useGlobalSort: !useGlobalSort })}
                />
                <SettingsRow label={_('Sort by')} disabled={useGlobalSort}>
                  <SettingsSelect
                    ariaLabel={_('Sort by')}
                    disabled={useGlobalSort}
                    value={selectedSort.by}
                    options={sortOptions}
                    onChange={(e) => sort({ by: e.target.value as BookshelfSort['by'] })}
                  />
                </SettingsRow>
                <SettingsSwitchRow
                  label={_('Ascending')}
                  disabled={useGlobalSort}
                  checked={selectedSort.ascending}
                  onChange={() => sort({ ascending: !selected.sort.ascending })}
                />
                <SettingsRow label={_('Then by')} disabled={useGlobalSort}>
                  <SettingsSelect
                    ariaLabel={_('Then by')}
                    disabled={useGlobalSort}
                    value={selectedSort.thenBy}
                    options={[{ value: 'none', label: _('None') }, ...sortOptions]}
                    onChange={(e) => sort({ thenBy: e.target.value as BookshelfSort['thenBy'] })}
                  />
                </SettingsRow>
                <SettingsSwitchRow
                  label={_('Secondary sort ascending')}
                  disabled={useGlobalSort || selectedSort.thenBy === 'none'}
                  checked={selectedSort.thenAscending}
                  onChange={() => sort({ thenAscending: !selected.sort.thenAscending })}
                />
              </div>
            </fieldset>
            <BoxedList>
              <SettingsSwitchRow
                label={_('Exclusive')}
                description={
                  selected.id === FINISHED_BOOKSHELF_ID
                    ? _('Matching books take priority over other exclusive shelves')
                    : priorityShelf
                      ? _('“{{name}}” takes priority, then exclusive shelves follow tab order', {
                          name: priorityShelf.name || _(bookshelfName(priorityShelf)),
                        })
                      : _('Matching books belong to the first enabled exclusive shelf')
                }
                checked={selected.exclusive}
                disabled={
                  !selected.exclusive &&
                  !bookshelfSchema.safeParse({
                    ...selected,
                    exclusive: true,
                    includeExclusiveBooks: false,
                  }).success
                }
                onChange={() => {
                  // Exclusive shelves cannot include other exclusive shelves, so remember the
                  // choice while it is forced off and restore it when Exclusive goes off again.
                  if (selected.exclusive)
                    update({
                      exclusive: false,
                      includeExclusiveBooks:
                        includeBeforeExclusive.current.get(selected.id) ??
                        selected.includeExclusiveBooks,
                    });
                  else {
                    includeBeforeExclusive.current.set(selected.id, selected.includeExclusiveBooks);
                    update({ exclusive: true, includeExclusiveBooks: false });
                  }
                }}
              />
              <SettingsSwitchRow
                label={_('Include books from exclusive shelves')}
                checked={selected.includeExclusiveBooks}
                disabled={selected.exclusive}
                onChange={() => update({ includeExclusiveBooks: !selected.includeExclusiveBooks })}
              />
            </BoxedList>
            <div className='me-px flex justify-end gap-8 pe-4'>
              <button
                type='button'
                ref={resetButtonRef}
                className='min-h-11 min-w-11 cursor-pointer text-end text-sm focus-visible:outline-2 focus-visible:outline-offset-2'
                onClick={() => setConfirmation({ shelf: selected, action: 'reset' })}
              >
                {_('Reset')}
              </button>
              {!isBuiltinBookshelf(selected.id) && (
                <button
                  type='button'
                  ref={deleteButtonRef}
                  className='text-error min-h-11 min-w-11 cursor-pointer text-end text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-40'
                  disabled={selected.enabled && enabledCount === 1}
                  onClick={() => setConfirmation({ shelf: selected, action: 'delete' })}
                >
                  {_('Delete')}
                </button>
              )}
            </div>
          </div>
        </OverlayScrollbarsComponent>
        <section
          aria-label={_('Bookshelf preview')}
          className='eink-bordered border-base-200 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border'
          onTouchStart={(e) => e.stopPropagation()}
        >
          <div className='shrink-0 space-y-1 px-4 pt-4'>
            <h3 className='font-semibold'>{_('Live preview')}</h3>
            <p aria-live='polite' className='text-base-content/70 text-sm'>
              {_('{{displayed}} displayed · {{matching}} matching · {{excluded}} excluded', {
                displayed: preview?.books.length || 0,
                matching: preview?.matching || 0,
                excluded: preview?.excluded || 0,
              })}
            </p>
          </div>
          <div className='min-h-0 flex-1 px-2 sm:px-1'>
            <BookshelfStream
              scale={0.5}
              onScrollerRef={handlePreviewScrollerRef}
              pageDurations={pageDurations}
              sections={previewSections}
              autoColumns={settings.libraryAutoColumns}
              fixedColumns={settings.libraryColumns || 3}
              renderItem={renderPreview}
            />
          </div>
        </section>
      </div>
      {confirmation && (
        <Dialog
          id='bookshelf-action-confirm'
          isOpen
          title={confirmation.action === 'reset' ? _('Reset bookshelf?') : _('Delete bookshelf?')}
          className='z-[60]'
          boxClassName='h-auto! max-h-[80vh]! sm:max-w-md'
          onClose={() => cancelConfirmation()}
        >
          <p className='text-sm'>
            {confirmation.action === 'reset'
              ? _(
                  'Restore the settings for “{{name}}”? Its name and position will stay the same. Your books will not change.',
                  {
                    name: confirmation.shelf.name || _(bookshelfName(confirmation.shelf)),
                  },
                )
              : _('Delete “{{name}}”? Your books will stay in the library.', {
                  name: confirmation.shelf.name,
                })}
          </p>
          <div className='mt-6 flex justify-end gap-2 pb-2'>
            <button
              type='button'
              className='btn btn-ghost eink-bordered min-h-11'
              autoFocus
              onClick={() => cancelConfirmation()}
            >
              {_('Cancel')}
            </button>
            <button
              type='button'
              className={`btn min-h-11 ${confirmation.action === 'reset' ? 'btn-contrast' : 'btn-error eink-contrast'}`}
              onClick={() => {
                const { shelf, action } = confirmation;
                let nextFocus: HTMLElement | null = null;
                if (action === 'delete') {
                  setDraft((shelves) => shelves.filter((s) => s.id !== shelf.id));
                  setSelectedId(DEFAULT_BOOKSHELF_ID);
                  // The Delete button goes away with the shelf, so hand focus to the new selection.
                  nextFocus =
                    tabsRef.current?.querySelector<HTMLElement>(
                      `[data-bookshelf-tab='${DEFAULT_BOOKSHELF_ID}']`,
                    ) ?? null;
                } else {
                  const builtin = defaultBookshelves({}).find((s) => s.id === shelf.id);
                  setDraft((shelves) =>
                    shelves.map((s) => {
                      if (s.id !== shelf.id) return s;
                      // A custom shelf is defined by its filters; only its display settings reset.
                      const defaults = builtin || {
                        ...createBookshelf(s.name, s.id),
                        filters: s.filters,
                        exclusive: s.exclusive,
                        includeExclusiveBooks: s.includeExclusiveBooks,
                      };
                      return {
                        ...defaults,
                        name: s.name,
                        enabled:
                          defaults.enabled ||
                          !shelves.some((other) => other.id !== s.id && other.enabled),
                      };
                    }),
                  );
                }
                setError('');
                cancelConfirmation(nextFocus);
              }}
            >
              {confirmation.action === 'reset' ? _('Reset') : _('Delete')}
            </button>
          </div>
        </Dialog>
      )}
    </fieldset>
  );
}
export default function BookshelvesDialog() {
  const _ = useTranslation();
  const [open, setOpen] = useState(false);
  const editor = useRef<BookshelvesEditorHandle>(null);
  const close = async () => {
    // The controls stay live while the first save runs, so flush again for anything edited
    // meanwhile; the second flush is a no-op when nothing changed.
    if ((await editor.current?.flush()) && (await editor.current?.flush())) setOpen(false);
  };
  useEffect(() => {
    const show = () => setOpen(true);
    eventDispatcher.on('show-bookshelves', show);
    return () => eventDispatcher.off('show-bookshelves', show);
  }, []);
  return (
    <Dialog
      isOpen={open}
      title={_('Manage Bookshelves')}
      onClose={() => void close()}
      fullScreen
      contentClassName='min-h-0 flex-1 overflow-hidden! sm:px-6!'
    >
      {open && <BookshelvesEditor ref={editor} />}
    </Dialog>
  );
}
