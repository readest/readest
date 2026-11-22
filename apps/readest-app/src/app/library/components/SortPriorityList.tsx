import clsx from 'clsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MdDragIndicator } from 'react-icons/md';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import type { LibraryMetadataSortByType, LibrarySortCriterion } from '@/types/settings';

interface SortPriorityListProps {
  items: LibrarySortCriterion[];
  labels: Record<LibraryMetadataSortByType, string>;
  dimmed?: boolean;
  autoLabel?: string;
  /** Criteria picked by the smart default rather than the user, shown as "(Auto)". */
  autoKeys?: LibraryMetadataSortByType[];
  onReorder: (next: LibrarySortCriterion[]) => void;
  onToggleDirection: (by: LibraryMetadataSortByType) => void;
}

interface SortableSortRowProps {
  item: LibrarySortCriterion;
  label: string;
  dimmed?: boolean;
  isAnyDragging?: boolean;
  isJustDropped?: boolean;
  autoLabel?: string;
  onToggleDirection: (by: LibraryMetadataSortByType) => void;
}

const SortableSortRow: React.FC<SortableSortRowProps> = ({
  item,
  label,
  dimmed = false,
  isAnyDragging = false,
  isJustDropped = false,
  autoLabel,
  onToggleDirection,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(16);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.by,
  });

  // Restrict to vertical translation so Dropdown's horizontal viewport clamp never offsets drags.
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform ? { ...transform, x: 0 } : null),
    transition,
  };

  const displayLabel = autoLabel ? `${label} (${autoLabel})` : label;

  return (
    <div
      ref={setNodeRef}
      role='listitem'
      style={style}
      className={clsx(
        'text-base-content flex min-h-8 w-full min-w-0 flex-row items-center rounded-md py-1 pe-1 ps-0 transition-colors duration-200',
        isDragging
          ? 'bg-base-300 z-10 shadow-sm'
          : isJustDropped
            ? 'bg-base-300/80'
            : !isAnyDragging && '[@media(hover:hover)]:hover:bg-base-300',
        dimmed && 'opacity-50',
      )}
    >
      <button
        type='button'
        data-dnd-sortable-handle='true'
        className='text-base-content/45 hover:text-base-content flex shrink-0 cursor-grab touch-none items-center justify-center self-stretch pe-2 ps-1 active:cursor-grabbing'
        aria-label={_('Drag to reorder {{label}}', { label })}
        title={_('Drag to reorder')}
        {...attributes}
        {...listeners}
      >
        <span style={{ minWidth: `${iconSize}px` }} className='flex items-center justify-center'>
          <MdDragIndicator size={iconSize} aria-hidden='true' />
        </span>
      </button>
      <button
        type='button'
        role='menuitem'
        onClick={() => onToggleDirection(item.by)}
        aria-label={`${label} (${item.ascending ? _('Ascending') : _('Descending')})`}
        className='flex min-w-0 flex-1 items-center justify-between text-start'
      >
        <span
          className='me-2 flex-1 break-words text-pretty text-start text-base font-normal sm:text-sm'
          style={{ minWidth: 0 }}
        >
          {displayLabel}
        </span>
        <span
          aria-hidden='true'
          style={{ minWidth: `${iconSize}px` }}
          className='text-base-content/85 shrink-0 text-center text-sm font-normal'
        >
          {item.ascending ? '↑' : '↓'}
        </span>
      </button>
    </div>
  );
};

/**
 * Priority-ordered sort list supporting mouse, touch-handle drag, and keyboard reordering.
 * Only the left drag handle claims `touch-none` so vertical swipes over row labels still scroll the menu.
 */
const SortPriorityList: React.FC<SortPriorityListProps> = ({
  items,
  labels,
  dimmed = false,
  autoLabel,
  autoKeys,
  onReorder,
  onToggleDirection,
}) => {
  const _ = useTranslation();
  const [localItems, setLocalItems] = useState<LibrarySortCriterion[]>(items);
  const [activeId, setActiveId] = useState<LibraryMetadataSortByType | null>(null);
  const [justDroppedId, setJustDroppedId] = useState<LibraryMetadataSortByType | null>(null);
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const itemsSignature = items.map((item) => `${item.by}:${item.ascending ? 1 : 0}`).join(',');
  useEffect(() => {
    setLocalItems(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsSignature]);

  useEffect(
    () => () => {
      if (dropTimerRef.current) clearTimeout(dropTimerRef.current);
    },
    [],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemIds = useMemo(() => localItems.map((item) => item.by), [localItems]);

  const handleDragStart = (event: DragStartEvent) => {
    if (dropTimerRef.current) clearTimeout(dropTimerRef.current);
    setJustDroppedId(null);
    setActiveId(event.active.id as LibraryMetadataSortByType);
  };

  const finishDrag = (droppedId: LibraryMetadataSortByType | null) => {
    setActiveId(null);
    if (droppedId) {
      setJustDroppedId(droppedId);
      if (dropTimerRef.current) clearTimeout(dropTimerRef.current);
      dropTimerRef.current = setTimeout(() => {
        setJustDroppedId(null);
      }, 350);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const draggedKey = active.id as LibraryMetadataSortByType;
    finishDrag(draggedKey);
    if (!over || active.id === over.id) return;
    const oldIndex = localItems.findIndex((item) => item.by === active.id);
    const newIndex = localItems.findIndex((item) => item.by === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(localItems, oldIndex, newIndex);
    setLocalItems(next);
    onReorder(next);
  };

  const handleDragCancel = () => {
    finishDrag(null);
  };

  const handleToggleRowDirection = (by: LibraryMetadataSortByType) => {
    setLocalItems((prev) =>
      prev.map((criterion) =>
        criterion.by === by ? { ...criterion, ascending: !criterion.ascending } : criterion,
      ),
    );
    onToggleDirection(by);
  };

  const getCriterionLabel = (id: string | number) =>
    labels[id as LibraryMetadataSortByType] ?? String(id);

  const accessibility = useMemo(
    () => ({
      screenReaderInstructions: {
        draggable: _(
          'To pick up a sort criterion, press space or enter. Use the up and down arrow keys to reorder, then press space or enter to drop, or escape to cancel.',
        ),
      },
      announcements: {
        onDragStart({ active }: DragStartEvent) {
          return _('Picked up {{label}}.', { label: getCriterionLabel(active.id) });
        },
        onDragOver({
          active,
          over,
        }: {
          active: { id: string | number };
          over: { id: string | number } | null;
        }) {
          if (over) {
            return _('{{label}} moved over {{target}}.', {
              label: getCriterionLabel(active.id),
              target: getCriterionLabel(over.id),
            });
          }
          return _('{{label}} is no longer over a droppable position.', {
            label: getCriterionLabel(active.id),
          });
        },
        onDragEnd({ active, over }: DragEndEvent) {
          if (over) {
            return _('Dropped {{label}} at {{target}}.', {
              label: getCriterionLabel(active.id),
              target: getCriterionLabel(over.id),
            });
          }
          return _('Dropped {{label}}.', { label: getCriterionLabel(active.id) });
        },
        onDragCancel({ active }: { active: { id: string | number } }) {
          return _('Reordering {{label}} cancelled.', { label: getCriterionLabel(active.id) });
        },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels, _],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={accessibility}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div
          role='list'
          data-dnd-dragging={activeId !== null ? 'true' : undefined}
          className='flex min-w-0 flex-1 flex-col'
        >
          {localItems.map((item) => (
            <SortableSortRow
              key={item.by}
              item={item}
              label={labels[item.by]}
              dimmed={dimmed}
              isAnyDragging={activeId !== null}
              isJustDropped={justDroppedId === item.by}
              autoLabel={autoKeys?.includes(item.by) ? autoLabel : undefined}
              onToggleDirection={handleToggleRowDirection}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
};

export default SortPriorityList;
