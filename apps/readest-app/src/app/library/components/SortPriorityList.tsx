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
import { useTranslation } from '@/hooks/useTranslation';
import type { LibraryMetadataSortByType, LibrarySortCriterion } from '@/types/settings';

interface SortPriorityListProps {
  items: LibrarySortCriterion[];
  labels: Record<LibraryMetadataSortByType, string>;
  dimmed?: boolean;
  primaryAutoLabel?: string;
  onReorder: (next: LibrarySortCriterion[]) => void;
  onToggleDirection: (by: LibraryMetadataSortByType) => void;
}

interface SortableSortRowProps {
  item: LibrarySortCriterion;
  index: number;
  label: string;
  dimmed?: boolean;
  isAnyDragging?: boolean;
  isJustDropped?: boolean;
  primaryAutoLabel?: string;
  onToggleDirection: (by: LibraryMetadataSortByType) => void;
}

const SortableSortRow: React.FC<SortableSortRowProps> = ({
  item,
  index,
  label,
  dimmed = false,
  isAnyDragging = false,
  isJustDropped = false,
  primaryAutoLabel,
  onToggleDirection,
}) => {
  const _ = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.by,
  });

  // Restrict to vertical translation so Dropdown's horizontal viewport clamp never offsets drags.
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform ? { ...transform, x: 0 } : null),
    transition,
  };

  const isPrimary = index === 0 && !dimmed;
  const displayLabel = index === 0 && primaryAutoLabel ? `${label} (${primaryAutoLabel})` : label;

  return (
    <div
      ref={setNodeRef}
      role='listitem'
      style={style}
      className={clsx(
        'flex flex-row items-center rounded-md transition-colors duration-200',
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
        className='text-base-content/45 hover:text-base-content flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-s-md active:cursor-grabbing'
        aria-label={_('Drag to reorder {{label}}', { label })}
        title={_('Drag to reorder')}
        {...attributes}
        {...listeners}
      >
        <MdDragIndicator className='h-4 w-4' aria-hidden='true' />
      </button>
      <button
        type='button'
        role='menuitem'
        onClick={() => onToggleDirection(item.by)}
        aria-label={`${label} (${item.ascending ? _('Ascending') : _('Descending')})`}
        className='flex min-h-8 min-w-0 flex-1 items-center gap-1.5 py-1 pe-2 ps-0.5 text-start'
      >
        <span
          className={clsx(
            'text-base-content min-w-0 flex-1 truncate text-base sm:text-sm',
            isPrimary ? 'font-semibold' : 'font-normal',
          )}
        >
          {displayLabel}
        </span>
        <span
          aria-hidden='true'
          className={clsx(
            'w-5 shrink-0 text-center text-sm',
            isPrimary ? 'text-base-content font-bold' : 'text-base-content/85 font-normal',
          )}
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
  primaryAutoLabel,
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

  return (
    <div className='flex flex-col'>
      <div className='text-base-content/50 px-2 pb-0.5 text-[11px] font-medium'>
        {_('Priority')}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className='relative flex'>
            <div
              aria-hidden='true'
              className={clsx(
                'from-base-content via-base-content/35 to-base-content/5 my-1.5 ms-1 w-[2px] shrink-0 rounded-full bg-linear-to-b',
                dimmed && 'opacity-30',
              )}
            />
            <div role='list' className='flex min-w-0 flex-1 flex-col gap-0.5 px-0 py-0.5'>
              {localItems.map((item, index) => (
                <SortableSortRow
                  key={item.by}
                  item={item}
                  index={index}
                  label={labels[item.by]}
                  dimmed={dimmed}
                  isAnyDragging={activeId !== null}
                  isJustDropped={justDroppedId === item.by}
                  primaryAutoLabel={primaryAutoLabel}
                  onToggleDirection={onToggleDirection}
                />
              ))}
            </div>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
};

export default SortPriorityList;
