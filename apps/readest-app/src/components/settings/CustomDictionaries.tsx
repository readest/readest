import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { MdAdd, MdDelete, MdDragIndicator, MdInfoOutline } from 'react-icons/md';
import { IoMdCloseCircleOutline } from 'react-icons/io';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useFileSelector } from '@/hooks/useFileSelector';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { eventDispatcher } from '@/utils/event';
import { evictProvider } from '@/services/dictionaries/registry';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';
import type { ImportedDictionary } from '@/services/dictionaries/types';

interface CustomDictionariesProps {
  onBack: () => void;
}

interface ProviderRow {
  id: string;
  label: string;
  kind: 'builtin' | 'stardict' | 'mdict';
  badge: string;
  imported?: ImportedDictionary;
  disabled?: boolean;
  reason?: string;
}

const builtinLabel = (id: string, _: (key: string) => string): string => {
  if (id === BUILTIN_PROVIDER_IDS.wiktionary) return _('Wiktionary');
  if (id === BUILTIN_PROVIDER_IDS.wikipedia) return _('Wikipedia');
  return id;
};

interface SortableRowProps {
  row: ProviderRow;
  enabled: boolean;
  isDeleteMode: boolean;
  onToggle: (id: string, next: boolean) => void;
  onDelete: (row: ProviderRow) => void;
  _: (key: string, options?: Record<string, number | string>) => string;
}

const SortableRow: React.FC<SortableRowProps> = ({
  row,
  enabled,
  isDeleteMode,
  onToggle,
  onDelete,
  _,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Keep the row visible while dragging; use a slight opacity dip so the
    // user can tell it's the moving one.
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'flex items-center gap-2 px-3 py-2',
        isDragging && 'bg-base-200 z-10 shadow-md',
      )}
    >
      {/* Drag handle (left). Always present so reorder works for built-ins
          and imported alike. The handle is the only element that registers
          drag listeners — clicks on the rest of the row don't initiate a
          drag, which keeps the toggle and delete buttons clickable. */}
      <button
        type='button'
        className='btn btn-ghost btn-xs h-7 w-5 cursor-grab touch-none p-0 active:cursor-grabbing'
        aria-label={_('Drag to reorder')}
        title={_('Drag to reorder')}
        {...attributes}
        {...listeners}
      >
        <MdDragIndicator className='text-base-content/60 h-4 w-4' />
      </button>

      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span
            className={clsx('truncate font-medium', row.disabled && 'text-base-content/60')}
            title={row.label}
          >
            {row.label}
          </span>
          <span className='badge badge-sm badge-ghost shrink-0'>{row.badge}</span>
        </div>
        {row.reason && (
          <div className='text-warning mt-1 flex items-start gap-1 text-xs'>
            <MdInfoOutline className='mt-0.5 h-3.5 w-3.5 shrink-0' />
            <span>{row.reason}</span>
          </div>
        )}
      </div>

      <input
        type='checkbox'
        className='toggle toggle-sm shrink-0'
        checked={enabled}
        onChange={() => onToggle(row.id, !enabled)}
        disabled={row.disabled}
        aria-label={enabled ? _('Disable') : _('Enable')}
      />

      {/* Delete X — only for imported rows, only in delete mode. Built-ins
          never show it; imported rows reserve no width when not in delete
          mode so their toggle aligns with the built-ins'. */}
      {row.imported && isDeleteMode && (
        <button
          type='button'
          onClick={() => onDelete(row)}
          className='btn btn-ghost btn-sm shrink-0 px-1'
          aria-label={_('Delete')}
          title={_('Delete')}
        >
          <IoMdCloseCircleOutline className='text-base-content/75 h-5 w-5' />
        </button>
      )}
    </div>
  );
};

const CustomDictionaries: React.FC<CustomDictionariesProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const {
    dictionaries,
    settings,
    addDictionary,
    removeDictionary,
    reorder,
    setEnabled,
    saveCustomDictionaries,
    loadCustomDictionaries,
  } = useCustomDictionaryStore();

  useEffect(() => {
    void loadCustomDictionaries(envConfig).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { selectFiles } = useFileSelector(appService, _);
  const [importing, setImporting] = useState(false);
  const [isDeleteMode, setIsDeleteMode] = useState(false);

  const buildRows = (): ProviderRow[] => {
    const dictById = new Map(dictionaries.map((d) => [d.id, d]));
    const rows: ProviderRow[] = [];
    for (const id of settings.providerOrder) {
      if (id.startsWith('builtin:')) {
        rows.push({
          id,
          label: builtinLabel(id, _),
          kind: 'builtin',
          badge: _('Built-in'),
        });
        continue;
      }
      const dict = dictById.get(id);
      if (!dict || dict.deletedAt) continue;
      let reason: string | undefined;
      let disabled = false;
      if (dict.unavailable) {
        reason = _('Bundle is missing on this device. Re-import to use it.');
        disabled = true;
      } else if (dict.unsupported) {
        reason = dict.unsupportedReason || _('This dictionary format is not supported.');
        disabled = true;
      }
      rows.push({
        id,
        label: dict.name,
        kind: dict.kind,
        badge: dict.kind === 'mdict' ? _('MDict') : _('StarDict'),
        imported: dict,
        disabled,
        reason,
      });
    }
    return rows;
  };

  const rows = buildRows();
  const hasImported = rows.some((r) => r.imported);

  // dnd-kit sensors. PointerSensor with a small distance gate avoids
  // hijacking simple clicks on the drag handle. TouchSensor with a delay
  // matches mobile UX (long-press to drag). Keyboard support gives drag
  // accessibility for free.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const result = await selectFiles({ type: 'dictionaries', multiple: true });
      if (result.error || result.files.length === 0) return;
      const importResult = await appService?.importDictionaries(result.files);
      if (!importResult) return;
      let added = 0;
      for (const dict of importResult.imported) {
        addDictionary(dict);
        added += 1;
      }
      await saveCustomDictionaries(envConfig);
      if (added > 0) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Imported {{count}} dictionary', { count: added }),
          timeout: 2500,
        });
      }
      if (importResult.orphanFiles.length > 0) {
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: _('Skipped incomplete bundles: {{names}}', {
            names: importResult.orphanFiles.join(', '),
          }),
          timeout: 4000,
        });
      }
    } catch (err) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to import dictionary: {{message}}', {
          message: err instanceof Error ? err.message : String(err),
        }),
        timeout: 4000,
      });
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (row: ProviderRow) => {
    if (!row.imported) return;
    const dict = row.imported;
    try {
      await appService?.deleteDictionary(dict);
    } catch (err) {
      console.warn('Failed to delete dictionary files:', err);
    }
    removeDictionary(dict.id);
    evictProvider(dict.id);
    await saveCustomDictionaries(envConfig);
    // Auto-leave delete mode when the last imported entry is gone — there's
    // nothing left to delete.
    if (rows.filter((r) => r.imported).length <= 1) {
      setIsDeleteMode(false);
    }
  };

  const handleToggle = async (id: string, next: boolean) => {
    setEnabled(id, next);
    await saveCustomDictionaries(envConfig);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const order = [...settings.providerOrder];
    const fromIdx = order.indexOf(String(active.id));
    const toIdx = order.indexOf(String(over.id));
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = order.splice(fromIdx, 1);
    if (!moved) return;
    order.splice(toIdx, 0, moved);
    reorder(order);
    await saveCustomDictionaries(envConfig);
  };

  return (
    <div className='w-full'>
      <div className='mb-6 flex h-8 items-center justify-between'>
        <div className='breadcrumbs py-1'>
          <ul>
            <li>
              <button className='font-semibold' onClick={onBack}>
                {_('Language')}
              </button>
            </li>
            <li className='font-medium'>{_('Dictionaries')}</li>
          </ul>
        </div>
        {hasImported && (
          <button
            onClick={() => setIsDeleteMode((v) => !v)}
            className='btn btn-ghost btn-sm text-base-content gap-2'
            title={isDeleteMode ? _('Cancel Delete') : _('Delete Dictionary')}
          >
            {isDeleteMode ? (
              <>{_('Cancel')}</>
            ) : (
              <>
                <MdDelete className='h-4 w-4' />
                {_('Delete')}
              </>
            )}
          </button>
        )}
      </div>

      <div className='card border-primary/50 hover:border-primary/75 group mb-4 border-2 transition-colors'>
        <button
          type='button'
          className='card-body flex cursor-pointer items-center justify-center p-3 text-center'
          onClick={handleImport}
          disabled={importing}
        >
          <div className='flex items-center gap-2'>
            <MdAdd className='text-primary/85 group-hover:text-primary h-6 w-6' />
            <div className='text-primary/85 group-hover:text-primary line-clamp-1 font-medium'>
              {importing ? _('Importing…') : _('Import Dictionary')}
            </div>
          </div>
        </button>
      </div>

      <div className='card border-base-200 bg-base-100 border shadow'>
        <div className='divide-base-200 divide-y'>
          {rows.length === 0 && (
            <div className='text-base-content/60 px-4 py-6 text-center text-sm'>
              {_('No dictionaries available.')}
            </div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              {rows.map((row) => (
                <SortableRow
                  key={row.id}
                  row={row}
                  enabled={settings.providerEnabled[row.id] !== false}
                  isDeleteMode={isDeleteMode}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  _={_}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </div>

      <div className='bg-base-200/30 my-6 rounded-lg p-4'>
        <div className='text-base-content/70 text-sm sm:text-xs'>
          <div className='mb-1 indent-2 font-medium'>{_('Tips')}:</div>
          <ul className='list-outside list-disc space-y-1 ps-2'>
            <li>{_('Drag the handle on the left to reorder.')}</li>
            <li>{_('StarDict bundles need .ifo, .idx, and .dict.dz files (.syn optional).')}</li>
            <li>{_('MDict bundles use .mdx files; companion .mdd files are optional.')}</li>
            <li>{_('Select all the bundle files together when importing.')}</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default CustomDictionaries;
