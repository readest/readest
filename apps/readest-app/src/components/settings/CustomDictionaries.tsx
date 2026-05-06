import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { MdAdd, MdDelete, MdDragIndicator, MdEdit, MdInfoOutline } from 'react-icons/md';
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
import { queueDictionaryBinaryUpload } from '@/services/sync/replicaBinaryUpload';
import type { ImportedDictionary, WebSearchEntry } from '@/services/dictionaries/types';
import {
  getBuiltinWebSearch,
  isValidUrlTemplate,
} from '@/services/dictionaries/webSearchTemplates';

interface CustomDictionariesProps {
  onBack: () => void;
}

interface ProviderRow {
  id: string;
  label: string;
  kind: 'builtin' | 'stardict' | 'mdict' | 'dict' | 'slob' | 'web';
  badge: string;
  imported?: ImportedDictionary;
  /** Set on `kind: 'web'` rows. The shape distinguishes deletable custom
   *  entries (when `builtinWeb` is false) from immutable built-ins. */
  webSearch?: WebSearchEntry;
  builtinWeb?: boolean;
  disabled?: boolean;
  reason?: string;
}

const builtinWebLabel = (id: string, _: (key: string) => string): string => {
  const tpl = getBuiltinWebSearch(id);
  if (!tpl) return id;
  return _(tpl.nameKey);
};

const builtinLabel = (id: string, _: (key: string) => string): string => {
  if (id === BUILTIN_PROVIDER_IDS.wiktionary) return _('Wiktionary');
  if (id === BUILTIN_PROVIDER_IDS.wikipedia) return _('Wikipedia');
  return id;
};

interface SortableRowProps {
  row: ProviderRow;
  enabled: boolean;
  isDeleteMode: boolean;
  isEditMode: boolean;
  onToggle: (id: string, next: boolean) => void;
  onDelete: (row: ProviderRow) => void;
  onEditWebSearch?: (entry: WebSearchEntry) => void;
  onEditDict?: (dict: ImportedDictionary) => void;
  _: (key: string, options?: Record<string, number | string>) => string;
}

const SortableRow: React.FC<SortableRowProps> = ({
  row,
  enabled,
  isDeleteMode,
  isEditMode,
  onToggle,
  onDelete,
  onEditWebSearch,
  onEditDict,
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
        'flex items-center gap-2 px-3 py-2 transition-colors',
        isDragging ? 'bg-base-200 z-10 shadow-md' : 'hover:bg-base-200/40',
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
        </div>
        {row.reason && (
          <div className='text-warning mt-1 flex items-start gap-1 text-xs'>
            <MdInfoOutline className='mt-0.5 h-3.5 w-3.5 shrink-0' />
            <span>{row.reason}</span>
          </div>
        )}
      </div>

      {/* End-aligned type badge. Sits just before the toggle so all
          badges form a uniform column regardless of name length, instead
          of trailing the truncated name at a ragged x position. */}
      <span className='badge badge-sm badge-ghost shrink-0'>{row.badge}</span>

      <input
        type='checkbox'
        className='toggle toggle-sm shrink-0'
        checked={enabled}
        onChange={() => onToggle(row.id, !enabled)}
        disabled={row.disabled}
        aria-label={enabled ? _('Disable') : _('Enable')}
      />

      {/* Edit pencil — parity with the trailing delete X, but for the
          rename / re-template flow. Visible only in edit mode for rows
          backed by user-mutable metadata (imported dicts and custom web
          searches; built-ins are immutable). */}
      {(row.imported || (row.kind === 'web' && !row.builtinWeb)) && isEditMode && (
        <button
          type='button'
          onClick={() => {
            if (row.imported && onEditDict) onEditDict(row.imported);
            else if (row.kind === 'web' && row.webSearch && onEditWebSearch) {
              onEditWebSearch(row.webSearch);
            }
          }}
          className='btn btn-ghost btn-sm shrink-0 px-1'
          aria-label={_('Edit')}
          title={_('Edit')}
        >
          <MdEdit className='text-base-content/75 h-4 w-4' />
        </button>
      )}

      {/* Delete X — for imported dictionaries and custom web searches, only
          in delete mode. Built-ins (incl. built-in web searches) never show
          it; deletable rows reserve no width when not in delete mode so the
          toggles align across the list. */}
      {(row.imported || (row.kind === 'web' && !row.builtinWeb)) && isDeleteMode && (
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
    replaceDictionaries,
    removeDictionary,
    updateDictionary,
    reorder,
    setEnabled,
    addWebSearch,
    updateWebSearch,
    removeWebSearch,
    saveCustomDictionaries,
    loadCustomDictionaries,
  } = useCustomDictionaryStore();

  useEffect(() => {
    void loadCustomDictionaries(envConfig).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { selectFiles } = useFileSelector(appService, _);
  const [importing, setImporting] = useState(false);
  // Edit and Delete are mutually-exclusive row affordances. Toggling one on
  // turns the other off so the trailing column never shows two icons at once.
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const toggleDeleteMode = () =>
    setIsDeleteMode((v) => {
      const next = !v;
      if (next) setIsEditMode(false);
      return next;
    });
  const toggleEditMode = () =>
    setIsEditMode((v) => {
      const next = !v;
      if (next) setIsDeleteMode(false);
      return next;
    });

  // Add/edit web-search modal state. `editingId` is `null` for "add", a
  // custom entry's id for "edit".
  const [webModal, setWebModal] = useState<null | {
    editingId: string | null;
    name: string;
    urlTemplate: string;
  }>(null);
  const openAddWebSearch = () => setWebModal({ editingId: null, name: '', urlTemplate: '' });
  const openEditWebSearch = (entry: WebSearchEntry) =>
    setWebModal({ editingId: entry.id, name: entry.name, urlTemplate: entry.urlTemplate });
  const closeWebModal = () => setWebModal(null);
  const submitWebModal = async () => {
    if (!webModal) return;
    const name = webModal.name.trim();
    const url = webModal.urlTemplate.trim();
    if (!name || !isValidUrlTemplate(url)) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('URL template must start with http(s):// and contain %WORD%.'),
        timeout: 4000,
      });
      return;
    }
    if (webModal.editingId) {
      updateWebSearch(webModal.editingId, { name, urlTemplate: url });
      // Re-create the cached provider so the new template + label take effect.
      evictProvider(webModal.editingId);
    } else {
      addWebSearch(name, url);
    }
    await saveCustomDictionaries(envConfig);
    setWebModal(null);
  };

  // Edit-imported-dict modal. Only the display `name` is editable; the
  // bundle on disk is untouched.
  const [dictModal, setDictModal] = useState<null | { id: string; name: string }>(null);
  const openEditDict = (dict: ImportedDictionary) => setDictModal({ id: dict.id, name: dict.name });
  const closeDictModal = () => setDictModal(null);
  const submitDictModal = async () => {
    if (!dictModal) return;
    const name = dictModal.name.trim();
    if (!name) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('Name cannot be empty.'),
        timeout: 4000,
      });
      return;
    }
    updateDictionary(dictModal.id, { name });
    // Provider instances cache the dict's `label` from `dict.name`; evict
    // so the next lookup picks up the new name in tabs / source labels.
    evictProvider(dictModal.id);
    await saveCustomDictionaries(envConfig);
    setDictModal(null);
  };

  const buildRows = (): ProviderRow[] => {
    const dictById = new Map(dictionaries.map((d) => [d.id, d]));
    const webById = new Map((settings.webSearches ?? []).map((w) => [w.id, w]));
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
      if (id.startsWith('web:builtin:')) {
        const tpl = getBuiltinWebSearch(id);
        if (!tpl) continue;
        rows.push({
          id,
          label: builtinWebLabel(id, _),
          kind: 'web',
          badge: _('Web'),
          webSearch: tpl,
          builtinWeb: true,
        });
        continue;
      }
      if (id.startsWith('web:')) {
        const w = webById.get(id);
        if (!w || w.deletedAt) continue;
        rows.push({
          id,
          label: w.name,
          kind: 'web',
          badge: _('Web'),
          webSearch: w,
          builtinWeb: false,
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
        badge:
          dict.kind === 'mdict'
            ? _('MDict')
            : dict.kind === 'dict'
              ? _('DICT')
              : dict.kind === 'slob'
                ? _('Slob')
                : _('StarDict'),
        imported: dict,
        disabled,
        reason,
      });
    }
    return rows;
  };

  const rows = buildRows();
  const hasDeletable = rows.some((r) => r.imported || (r.kind === 'web' && !r.builtinWeb));

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
      const importResult = await appService?.importDictionaries(result.files, dictionaries);
      if (!importResult) return;
      let added = 0;
      for (const dict of importResult.imported) {
        addDictionary(dict);
        if (appService) void queueDictionaryBinaryUpload(dict, appService);
        added += 1;
      }
      let replaced = 0;
      for (const { oldIds, newDict } of importResult.replacements) {
        replaceDictionaries(oldIds, newDict);
        if (appService) void queueDictionaryBinaryUpload(newDict, appService);
        // Invalidate any cached provider instances for the replaced ids so
        // their next lookup picks up the new bundle's files.
        for (const oldId of oldIds) evictProvider(oldId);
        replaced += 1;
      }
      await saveCustomDictionaries(envConfig);
      if (added > 0) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Imported {{count}} dictionary', { count: added }),
          timeout: 2500,
        });
      }
      if (replaced > 0) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Replaced {{count}} existing dictionary', { count: replaced }),
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
    if (row.imported) {
      const dict = row.imported;
      try {
        await appService?.deleteDictionary(dict);
      } catch (err) {
        console.warn('Failed to delete dictionary files:', err);
      }
      removeDictionary(dict.id);
      evictProvider(dict.id);
    } else if (row.kind === 'web' && !row.builtinWeb && row.webSearch) {
      removeWebSearch(row.webSearch.id);
      evictProvider(row.id);
    } else {
      return;
    }
    await saveCustomDictionaries(envConfig);
    // Auto-leave delete mode when the last deletable entry is gone — there's
    // nothing left to delete (edit mode is gated on the same row set).
    const remaining = rows.filter(
      (r) => r.id !== row.id && (r.imported || (r.kind === 'web' && !r.builtinWeb)),
    );
    if (remaining.length === 0) {
      setIsDeleteMode(false);
      setIsEditMode(false);
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
      <div className='mb-4 flex h-8 items-center justify-between'>
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
        {hasDeletable && (
          <div className='flex items-center gap-1'>
            <button
              onClick={toggleEditMode}
              className='btn btn-ghost btn-sm text-base-content gap-2'
              title={isEditMode ? _('Cancel Edit') : _('Edit Dictionary')}
            >
              {isEditMode ? (
                <>{_('Cancel')}</>
              ) : (
                <>
                  <MdEdit className='h-4 w-4' />
                  {/* Hide label on very narrow screens so the icon-only
                      button keeps the breadcrumb readable. */}
                  <span className='hidden min-[400px]:inline'>{_('Edit')}</span>
                </>
              )}
            </button>
            <button
              onClick={toggleDeleteMode}
              className='btn btn-ghost btn-sm text-base-content gap-2'
              title={isDeleteMode ? _('Cancel Delete') : _('Delete Dictionary')}
            >
              {isDeleteMode ? (
                <>{_('Cancel')}</>
              ) : (
                <>
                  <MdDelete className='h-4 w-4' />
                  <span className='hidden min-[400px]:inline'>{_('Delete')}</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      <div className='card border-base-200 bg-base-100 overflow-hidden border'>
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
                  isEditMode={isEditMode}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onEditWebSearch={openEditWebSearch}
                  onEditDict={openEditDict}
                  _={_}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </div>

      <div className='mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2'>
        <button
          type='button'
          onClick={handleImport}
          disabled={importing}
          className='btn btn-outline btn-primary gap-2 normal-case [--animation-btn:0s]'
        >
          <MdAdd className='h-5 w-5' />
          <span className='line-clamp-1'>
            {importing ? _('Importing…') : _('Import Dictionary')}
          </span>
        </button>
        <button
          type='button'
          onClick={openAddWebSearch}
          className='btn btn-outline btn-primary gap-2 normal-case [--animation-btn:0s]'
        >
          <MdAdd className='h-5 w-5' />
          <span className='line-clamp-1'>{_('Add Web Search')}</span>
        </button>
      </div>

      <div className='bg-base-200/40 mt-4 rounded-lg p-3'>
        <div className='text-base-content/70 text-xs'>
          <div className='mb-1.5 flex items-center gap-1.5 font-medium'>
            <MdInfoOutline className='h-3.5 w-3.5' />
            {_('Tips')}
          </div>
          <ul className='list-outside list-disc space-y-0.5 ps-4'>
            <li>{_('StarDict bundles need .ifo, .idx, and .dict.dz files (.syn optional).')}</li>
            <li>
              {_('MDict bundles use .mdx files; companion .mdd and .css files are optional.')}
            </li>
            <li>{_('DICT bundles need a .index file and a .dict.dz file.')}</li>
            <li>{_('Slob bundles need a .slob file.')}</li>
            <li>{_('Select all the bundle files together when importing.')}</li>
          </ul>
        </div>
      </div>

      {/* Add / edit web-search modal. Lightweight inline `<dialog>` (daisyUI
          modal classes); the heavier `Dialog.tsx` is overkill for a 2-field
          form. */}
      {webModal && (
        <div className='modal modal-open' role='dialog'>
          <div className='modal-box w-11/12 max-w-md'>
            <h3 className='text-base font-semibold'>
              {webModal.editingId ? _('Edit Web Search') : _('Add Web Search')}
            </h3>
            <div className='mt-4 space-y-3'>
              <label className='form-control w-full'>
                <span className='label-text text-sm'>{_('Name')}</span>
                <input
                  type='text'
                  className='input input-bordered input-sm w-full'
                  value={webModal.name}
                  placeholder={_('e.g. Google')}
                  onChange={(e) => setWebModal((m) => (m ? { ...m, name: e.target.value } : m))}
                />
              </label>
              <label className='form-control w-full'>
                <span className='label-text text-sm'>{_('URL Template')}</span>
                <input
                  type='url'
                  className='input input-bordered input-sm w-full'
                  value={webModal.urlTemplate}
                  placeholder='https://www.google.com/search?q=%WORD%'
                  onChange={(e) =>
                    setWebModal((m) => (m ? { ...m, urlTemplate: e.target.value } : m))
                  }
                />
                <span className='label-text-alt text-base-content/60 mt-1 text-xs'>
                  {_('Use %WORD% where the looked-up word should appear.')}
                </span>
              </label>
            </div>
            <div className='modal-action'>
              <button type='button' onClick={closeWebModal} className='btn btn-ghost btn-sm'>
                {_('Cancel')}
              </button>
              <button type='button' onClick={submitWebModal} className='btn btn-primary btn-sm'>
                {_('Save')}
              </button>
            </div>
          </div>
          {/* Click-outside dismiss. */}
          <button
            type='button'
            aria-label={_('Close')}
            className='modal-backdrop'
            onClick={closeWebModal}
          />
        </div>
      )}

      {/* Edit-imported-dict modal. Single field for the display name; the
          on-disk bundle is untouched. */}
      {dictModal && (
        <div className='modal modal-open' role='dialog'>
          <div className='modal-box w-11/12 max-w-md'>
            <h3 className='text-base font-semibold'>{_('Edit Dictionary')}</h3>
            <div className='mt-4 space-y-3'>
              <label className='form-control w-full'>
                <span className='label-text text-sm'>{_('Name')}</span>
                <input
                  type='text'
                  className='input input-bordered input-sm w-full'
                  value={dictModal.name}
                  placeholder={_('Dictionary name')}
                  onChange={(e) => setDictModal((m) => (m ? { ...m, name: e.target.value } : m))}
                />
              </label>
            </div>
            <div className='modal-action'>
              <button type='button' onClick={closeDictModal} className='btn btn-ghost btn-sm'>
                {_('Cancel')}
              </button>
              <button type='button' onClick={submitDictModal} className='btn btn-primary btn-sm'>
                {_('Save')}
              </button>
            </div>
          </div>
          <button
            type='button'
            aria-label={_('Close')}
            className='modal-backdrop'
            onClick={closeDictModal}
          />
        </div>
      )}
    </div>
  );
};

export default CustomDictionaries;
