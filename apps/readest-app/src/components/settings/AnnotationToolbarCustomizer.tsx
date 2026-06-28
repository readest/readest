import clsx from 'clsx';
import React, { useCallback, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCorners,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { saveViewSettings } from '@/helpers/settings';
import { AnnotationToolType } from '@/types/annotator';
import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';
import {
  ALL_ANNOTATION_TOOL_TYPES,
  getAvailableToolTypes,
  getToolbarToolTypes,
  addToolToToolbar,
  removeToolFromToolbar,
  reorderToolbar,
} from '@/utils/annotationToolbar';
import { canShareText } from '@/utils/share';
import SubPageHeader from './SubPageHeader';

type ZoneId = 'toolbar' | 'available';

interface AnnotationToolbarCustomizerProps {
  bookKey: string;
  onBack: () => void;
}

const toolButtonOf = (type: AnnotationToolType) =>
  annotationToolButtons.find((button) => button.type === type);

interface ToolChipProps {
  type: AnnotationToolType;
  label: string;
  variant: ZoneId;
  onActivate: () => void;
}

const ToolChip: React.FC<ToolChipProps> = ({ type, label, variant, onActivate }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: type,
  });
  const Icon = toolButtonOf(type)?.Icon;
  const style: React.CSSProperties = {
    // `transform` is a relative translate, so the chip tracks the pointer
    // correctly even though the settings dialog is a transformed container
    // (a `position: fixed` DragOverlay would be offset by that transform).
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };
  const isToolbar = variant === 'toolbar';
  return (
    <button
      ref={setNodeRef}
      type='button'
      style={style}
      // Tap = move between zones; press-and-drag = reorder/move (the sensors'
      // activation constraints distinguish the two). Keeps the action usable
      // on e-ink and for keyboard/AT users where drag is impractical.
      onClick={onActivate}
      className={clsx(
        'flex cursor-grab touch-none select-none items-center active:cursor-grabbing',
        isToolbar
          ? // Mirror the live toolbar's AnnotationToolButton: icon-only 32×32.
            'h-8 min-h-8 w-8 justify-center rounded-md p-0 not-eink:hover:bg-gray-500 eink:hover:border'
          : // Available tools are labeled so they're identifiable off the bar.
            'eink-bordered border-base-300 bg-base-100 gap-1.5 rounded-md border px-2.5 py-1.5 text-sm',
        isDragging && 'shadow-lg',
      )}
      aria-label={label}
      title={label}
      {...attributes}
      {...listeners}
    >
      {Icon ? <Icon className={isToolbar ? undefined : 'h-4 w-4 shrink-0'} /> : null}
      {isToolbar ? null : <span className='whitespace-nowrap'>{label}</span>}
    </button>
  );
};

const Zone: React.FC<{
  id: ZoneId;
  items: AnnotationToolType[];
  emptyHint: string;
  renderChip: (type: AnnotationToolType) => React.ReactNode;
}> = ({ id, items, emptyHint, renderChip }) => {
  const { setNodeRef } = useDroppable({ id });
  const isToolbar = id === 'toolbar';
  return (
    <SortableContext items={items} strategy={rectSortingStrategy}>
      <div
        ref={setNodeRef}
        className={clsx(
          'flex min-h-12 flex-wrap items-center gap-2 rounded-lg p-2',
          isToolbar
            ? // A faithful, content-width preview of the real popup, start-aligned
              // with the Available row below it. Off e-ink it mirrors the popup's
              // dark fill; in e-ink the dark fill is dropped entirely and
              // `eink-bordered` renders it as the popup's e-ink chrome instead
              // (.popup-container): a base-100 surface with a 1px base-content
              // border, so it doesn't paint as a solid black bar (#4839).
              'selection-popup eink-bordered w-fit max-w-full not-eink:bg-gray-600 not-eink:text-white'
            : 'bg-base-200/60',
        )}
      >
        {items.length === 0 ? (
          <span
            className={clsx(
              'px-1 text-sm',
              // In e-ink the toolbar surface turns base-100, so the white hint would
              // vanish; fall back to base-content there (#4839).
              isToolbar ? 'not-eink:text-white/70 eink:text-base-content' : 'text-base-content/50',
            )}
          >
            {emptyHint}
          </span>
        ) : (
          items.map((type) => <React.Fragment key={type}>{renderChip(type)}</React.Fragment>)
        )}
      </div>
    </SortableContext>
  );
};

const AnnotationToolbarCustomizer: React.FC<AnnotationToolbarCustomizerProps> = ({
  bookKey,
  onBack,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getViewSettings } = useReaderStore();
  const { settings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const canShare = canShareText(appService);

  // `share` is hidden on platforms that can't share (Windows/Linux desktop).
  // If the user enabled it on a share-capable device (e.g. their phone) and it
  // synced here, we must not drop it just because the user edits the toolbar on
  // this device — preserve it across persists so the capable device keeps it.
  const savedHasShare = getToolbarToolTypes(viewSettings.annotationToolbarItems, true).includes(
    'share',
  );
  const preserveHiddenShare = !canShare && savedHasShare;

  const [items, setItems] = useState<Record<ZoneId, AnnotationToolType[]>>(() => ({
    toolbar: getToolbarToolTypes(viewSettings.annotationToolbarItems, canShare),
    available: getAvailableToolTypes(viewSettings.annotationToolbarItems, canShare),
  }));
  // dnd-kit invokes onDragEnd with the handler captured at drag start, so the
  // closed-over `items` is stale by the time a cross-zone drag finishes. Read
  // the live value from this ref instead. Kept in sync on every render.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Snapshot taken on drag start so an aborted drag can be fully reverted —
  // onDragOver mutates `items` live as the pointer crosses zones.
  const beforeDragRef = useRef<Record<ZoneId, AnnotationToolType[]> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // closestCorners alone can't reliably target an empty container; prefer the
  // droppable under the pointer, and when that's a zone with items, snap to the
  // closest chip inside it. (dnd-kit multiple-containers recipe.)
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerCollisions = pointerWithin(args);
      const collisions = pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args);
      let overId = getFirstCollision(collisions, 'id');
      if (overId == null) return [];
      if (overId === 'toolbar' || overId === 'available') {
        const ids = items[overId];
        if (ids.length > 0) {
          const inner = closestCorners({
            ...args,
            droppableContainers: args.droppableContainers.filter(
              (c) => c.id !== overId && ids.includes(c.id as AnnotationToolType),
            ),
          });
          if (inner.length > 0) overId = inner[0]!.id;
        }
      }
      return [{ id: overId }];
    },
    [items],
  );

  const persist = (toolbar: AnnotationToolType[]) => {
    const toSave =
      preserveHiddenShare && !toolbar.includes('share')
        ? [...toolbar, 'share' as AnnotationToolType]
        : toolbar;
    saveViewSettings(envConfig, bookKey, 'annotationToolbarItems', toSave, false, true);
  };

  // Commit a new toolbar order: keep the user's arrangement, recompute the
  // available tray as its canonical-order complement, and persist.
  const commit = (toolbar: AnnotationToolType[]) => {
    setItems({ toolbar, available: getAvailableToolTypes(toolbar, canShare) });
    persist(toolbar);
  };

  const zoneOf = (id: string, state: Record<ZoneId, AnnotationToolType[]>): ZoneId | null => {
    if (id === 'toolbar' || id === 'available') return id;
    if (state.toolbar.includes(id as AnnotationToolType)) return 'toolbar';
    if (state.available.includes(id as AnnotationToolType)) return 'available';
    return null;
  };

  const moveToToolbar = (type: AnnotationToolType) =>
    commit(addToolToToolbar(itemsRef.current.toolbar, type));
  const moveToAvailable = (type: AnnotationToolType) =>
    commit(removeToolFromToolbar(itemsRef.current.toolbar, type));

  // "Add all" rebuilds the toolbar in the canonical predefined order (not the
  // user's prior arrangement); "Clear all" empties it.
  const addAll = () => commit(ALL_ANNOTATION_TOOL_TYPES.filter((t) => canShare || t !== 'share'));
  const clearAll = () => commit([]);

  const handleDragStart = () => {
    beforeDragRef.current = items;
  };

  // Live reparent across zones so chips reflow under the cursor.
  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as AnnotationToolType;
    const overId = over.id as string;
    setItems((prev) => {
      const from = zoneOf(activeId, prev);
      const to = zoneOf(overId, prev);
      if (!from || !to || from === to) return prev;
      const fromItems = prev[from].filter((t) => t !== activeId);
      const overIndex = prev[to].indexOf(overId as AnnotationToolType);
      const insertAt = overIndex >= 0 ? overIndex : prev[to].length;
      const toItems = [...prev[to]];
      toItems.splice(insertAt, 0, activeId);
      return { ...prev, [from]: fromItems, [to]: toItems } as Record<ZoneId, AnnotationToolType[]>;
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    beforeDragRef.current = null;
    const current = itemsRef.current;
    if (!over) {
      commit(current.toolbar);
      return;
    }
    const activeId = active.id as AnnotationToolType;
    const overId = over.id as string;
    // Reorder within the toolbar (cross-zone moves already applied in onDragOver).
    if (
      current.toolbar.includes(activeId) &&
      overId !== 'toolbar' &&
      overId !== 'available' &&
      zoneOf(overId, current) === 'toolbar'
    ) {
      commit(reorderToolbar(current.toolbar, activeId, overId as AnnotationToolType));
      return;
    }
    commit(current.toolbar);
  };

  const handleDragCancel = () => {
    if (beforeDragRef.current) setItems(beforeDragRef.current);
    beforeDragRef.current = null;
  };

  const renderToolbarChip = (type: AnnotationToolType) => (
    <ToolChip
      type={type}
      label={_(toolButtonOf(type)?.label ?? type)}
      variant='toolbar'
      onActivate={() => moveToAvailable(type)}
    />
  );
  const renderAvailableChip = (type: AnnotationToolType) => (
    <ToolChip
      type={type}
      label={_(toolButtonOf(type)?.label ?? type)}
      variant='available'
      onActivate={() => moveToToolbar(type)}
    />
  );

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Behavior')}
        currentLabel={_('Customize Toolbar')}
        description={_(
          'Drag tools between the rows to show or hide them and reorder the toolbar. You can also tap a tool to move it.',
        )}
        onBack={onBack}
        rightSlot={
          <div className='flex shrink-0 items-center gap-1'>
            <button
              type='button'
              className='btn btn-ghost btn-xs'
              onClick={addAll}
              disabled={items.available.length === 0}
            >
              {_('Add all')}
            </button>
            <button
              type='button'
              className='btn btn-ghost btn-xs'
              onClick={clearAll}
              disabled={items.toolbar.length === 0}
            >
              {_('Clear all')}
            </button>
          </div>
        }
      />
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* px-4 matches SubPageHeader so the zone labels align with the breadcrumb. */}
        <div className='my-4 space-y-5 px-4'>
          <div className='space-y-2'>
            <div className='text-base-content/70 text-sm font-medium'>{_('In toolbar')}</div>
            <Zone
              id='toolbar'
              items={items.toolbar}
              emptyHint={_('No tools, drag one here')}
              renderChip={renderToolbarChip}
            />
          </div>
          <div className='space-y-2'>
            <div className='text-base-content/70 text-sm font-medium'>{_('Available')}</div>
            <Zone
              id='available'
              items={items.available}
              emptyHint={_('All tools are in the toolbar.')}
              renderChip={renderAvailableChip}
            />
          </div>
        </div>
      </DndContext>
    </div>
  );
};

export default AnnotationToolbarCustomizer;
