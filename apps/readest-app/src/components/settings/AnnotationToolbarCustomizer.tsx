import clsx from 'clsx';
import React, { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { saveViewSettings } from '@/helpers/settings';
import { AnnotationToolType } from '@/types/annotator';
import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';
import {
  getAvailableToolTypes,
  getToolbarToolTypes,
  addToolToToolbar,
  removeToolFromToolbar,
  reorderToolbar,
} from '@/utils/annotationToolbar';
import { canShareText } from '@/utils/share';
import SubPageHeader from './SubPageHeader';

interface AnnotationToolbarCustomizerProps {
  bookKey: string;
  onBack: () => void;
}

const toolButtonOf = (type: AnnotationToolType) =>
  annotationToolButtons.find((button) => button.type === type);

interface ToolChipProps {
  type: AnnotationToolType;
  label: string;
  hint: string;
  onActivate: () => void;
}

const ToolChip: React.FC<ToolChipProps> = ({ type, label, hint, onActivate }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: type,
  });
  const Icon = toolButtonOf(type)?.Icon;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
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
        'eink-bordered flex touch-none select-none items-center gap-1.5 rounded-md px-2.5 py-1.5',
        'cursor-grab text-sm active:cursor-grabbing',
        isDragging ? 'z-10 shadow-md' : '',
      )}
      aria-label={label}
      title={hint}
      {...attributes}
      {...listeners}
    >
      {Icon ? <Icon className='h-4 w-4 shrink-0' /> : null}
      <span className='whitespace-nowrap'>{label}</span>
    </button>
  );
};

const Zone: React.FC<{
  id: 'toolbar' | 'available';
  items: AnnotationToolType[];
  emptyHint: string;
  renderChip: (type: AnnotationToolType) => React.ReactNode;
}> = ({ id, items, emptyHint, renderChip }) => {
  const { setNodeRef } = useDroppable({ id });
  return (
    <SortableContext items={items} strategy={horizontalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={clsx('bg-base-200/60 flex min-h-14 flex-wrap items-center gap-2 rounded-lg p-2')}
      >
        {items.length === 0 ? (
          <span className='text-base-content/50 px-1 text-sm'>{emptyHint}</span>
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

  const [toolbar, setToolbar] = useState<AnnotationToolType[]>(() =>
    getToolbarToolTypes(viewSettings.annotationToolbarItems, canShare),
  );
  const [available, setAvailable] = useState<AnnotationToolType[]>(() =>
    getAvailableToolTypes(viewSettings.annotationToolbarItems, canShare),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const persist = (nextToolbar: AnnotationToolType[]) => {
    const toSave =
      preserveHiddenShare && !nextToolbar.includes('share')
        ? [...nextToolbar, 'share' as AnnotationToolType]
        : nextToolbar;
    saveViewSettings(envConfig, bookKey, 'annotationToolbarItems', toSave, false, true);
  };

  const containerOf = (id: string): 'toolbar' | 'available' | null => {
    if (id === 'toolbar' || toolbar.includes(id as AnnotationToolType)) return 'toolbar';
    if (id === 'available' || available.includes(id as AnnotationToolType)) return 'available';
    return null;
  };

  const moveToToolbar = (type: AnnotationToolType, atIndex?: number) => {
    const next = addToolToToolbar(toolbar, type, atIndex);
    setToolbar(next);
    setAvailable(getAvailableToolTypes(next, canShare));
    persist(next);
  };

  const moveToAvailable = (type: AnnotationToolType) => {
    const next = removeToolFromToolbar(toolbar, type);
    setToolbar(next);
    setAvailable(getAvailableToolTypes(next, canShare));
    persist(next);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as AnnotationToolType;
    const overId = over.id as string;
    const from = containerOf(active.id as string);
    const to = containerOf(overId);
    if (!from || !to) return;

    if (from === 'toolbar' && to === 'toolbar') {
      if (overId === 'toolbar' || overId === activeId) return;
      const next = reorderToolbar(toolbar, activeId, overId as AnnotationToolType);
      if (next !== toolbar) {
        setToolbar(next);
        persist(next);
      }
      return;
    }
    if (from === 'available' && to === 'toolbar') {
      const insertAt =
        overId === 'toolbar'
          ? toolbar.length
          : Math.max(0, toolbar.indexOf(overId as AnnotationToolType));
      moveToToolbar(activeId, insertAt);
      return;
    }
    if (from === 'toolbar' && to === 'available') {
      moveToAvailable(activeId);
      return;
    }
    // from === 'available' && to === 'available': display-only, ignore.
  };

  const renderToolbarChip = (type: AnnotationToolType) => (
    <ToolChip
      type={type}
      label={_(toolButtonOf(type)?.label ?? type)}
      hint={_('Drag to reorder, tap to remove')}
      onActivate={() => moveToAvailable(type)}
    />
  );
  const renderAvailableChip = (type: AnnotationToolType) => (
    <ToolChip
      type={type}
      label={_(toolButtonOf(type)?.label ?? type)}
      hint={_('Drag to toolbar, tap to add')}
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
      />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className='my-4 space-y-5'>
          <div className='space-y-2'>
            <div className='text-base-content/70 text-sm font-medium'>{_('In toolbar')}</div>
            <Zone
              id='toolbar'
              items={toolbar}
              emptyHint={_('No tools — drag one here.')}
              renderChip={renderToolbarChip}
            />
          </div>
          <div className='space-y-2'>
            <div className='text-base-content/70 text-sm font-medium'>{_('Available')}</div>
            <Zone
              id='available'
              items={available}
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
