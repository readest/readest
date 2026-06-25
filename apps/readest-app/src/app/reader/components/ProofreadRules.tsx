import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { RiEditLine, RiDeleteBin7Line } from 'react-icons/ri';
import { MdDragIndicator } from 'react-icons/md';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
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
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useProofreadStore, validateReplacementRulePattern } from '@/store/proofreadStore';
import { ProofreadRule, ProofreadScope } from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import Dialog from '@/components/Dialog';
import { SectionTitle } from '@/components/settings/primitives';

const dialogId = 'proofread_rules_window';

export const setProofreadRulesVisibility = (visible: boolean) => {
  const dialog = document.getElementById(dialogId);
  if (dialog) {
    dialog.dispatchEvent(new CustomEvent('setProofreadRulesVisibility', { detail: { visible } }));
  }
};

const byOrder = (a: ProofreadRule, b: ProofreadRule): number => (a.order ?? 0) - (b.order ?? 0);

// Lock drag travel to the vertical axis — the lists are vertical, so any
// horizontal motion just lets the drag preview drift out from under the row.
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

// Clamp the drag preview to the list container so a row can't be dragged out.
const restrictToParentElement: Modifier = ({ containerNodeRect, draggingNodeRect, transform }) => {
  if (!draggingNodeRect || !containerNodeRect) return transform;
  const value = { ...transform };
  if (draggingNodeRect.top + transform.y < containerNodeRect.top) {
    value.y = containerNodeRect.top - draggingNodeRect.top;
  } else if (
    draggingNodeRect.bottom + transform.y >
    containerNodeRect.top + containerNodeRect.height
  ) {
    value.y = containerNodeRect.top + containerNodeRect.height - draggingNodeRect.bottom;
  }
  return value;
};

const dragModifiers: Modifier[] = [restrictToVerticalAxis, restrictToParentElement];

const RuleItem: React.FC<{
  rule: ProofreadRule;
  scope: ProofreadScope;
  isEditing: boolean;
  editingData: { pattern: string; replacement: string; enabled: boolean };
  onEdit: () => void;
  onDelete: () => void;
  onSave: () => void;
  onCancel: () => void;
  onEditChange: (field: 'replacement', value: string) => void;
}> = ({
  rule,
  scope,
  isEditing,
  editingData,
  onEdit,
  onDelete,
  onSave,
  onCancel,
  onEditChange,
}) => {
  const _ = useTranslation();
  const { sideBarBookKey } = useSidebarStore();
  const { getView } = useReaderStore();

  const navigateToSelection = () => {
    if (!sideBarBookKey || !rule.cfi) return;
    eventDispatcher.dispatch('navigate', { bookKey: sideBarBookKey, cfi: rule.cfi });
    getView(sideBarBookKey)?.goTo(rule.cfi);
  };

  if (isEditing) {
    return (
      <div className='flex flex-col gap-3 p-3'>
        <div className='flex flex-col gap-1.5'>
          <label className='text-base-content/70 text-xs font-medium'>{_('Selected text:')}</label>
          <input
            className='input input-sm bg-base-200 text-sm opacity-60'
            value={editingData.pattern}
            disabled
          />
        </div>

        <div className='flex flex-col gap-1.5'>
          <label className='text-base-content/70 text-xs font-medium'>{_('Replace with:')}</label>
          <input
            className='input input-sm text-sm'
            value={editingData.replacement}
            onChange={(e) => onEditChange('replacement', e.target.value)}
          />
        </div>

        <div className='mt-1 flex gap-2'>
          <button className='btn btn-primary btn-sm flex-1' onClick={onSave}>
            {_('Save')}
          </button>
          <button className='btn btn-sm flex-1' onClick={onCancel}>
            {_('Cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='relative flex items-start justify-between gap-3 p-3'>
      <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
        <div className='break-words pe-20 text-base font-medium leading-snug'>{rule.pattern}</div>
        <div className='text-base-content/70 break-words text-sm'>
          <span className='text-base-content/80 mr-1.5 text-xs font-medium'>
            {_('Replace with:')}
          </span>
          <span className='text-base-content/90 text-xs'>{"'" + rule.replacement + "'"}</span>
        </div>
        <div className='text-base-content/60 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
          <span className='inline-flex items-center gap-1'>
            <span className='text-base-content/50'>{_('Scope:')}</span>
            <span
              role='none'
              className={clsx(
                'text-base-content/70 font-medium',
                scope === 'selection' && 'cursor-pointer text-blue-400 hover:text-blue-500',
              )}
              onClick={scope === 'selection' ? navigateToSelection : undefined}
            >
              {scope === 'selection' ? _('Selection') : scope === 'book' ? _('Book') : _('Library')}
            </span>
          </span>
          <span className='text-base-content/30'>•</span>
          <span className='inline-flex items-center gap-1'>
            <span className='text-base-content/50'>{_('Case sensitive:')}</span>
            <span className='text-base-content/70 font-medium'>
              {rule.caseSensitive !== false ? _('Yes') : _('No')}
            </span>
          </span>
          <span className='text-base-content/30'>•</span>
          <span className='inline-flex items-center gap-1'>
            <span className='text-base-content/50'>{_('Only for TTS:')}</span>
            <span className='text-base-content/70 font-medium'>
              {rule.onlyForTTS === true ? _('Yes') : _('No')}
            </span>
          </span>
        </div>
      </div>
      <div className='absolute right-2 top-2 flex items-center gap-1'>
        <button
          className='btn btn-ghost btn-sm h-8 w-8 p-0'
          onClick={onEdit}
          aria-label={_('Edit')}
        >
          <RiEditLine className='h-4 w-4' />
        </button>
        <button
          className='btn btn-ghost btn-sm h-8 w-8 p-0'
          onClick={onDelete}
          aria-label={_('Delete')}
        >
          <RiDeleteBin7Line className='h-4 w-4' />
        </button>
      </div>
    </div>
  );
};

// Sortable wrapper: the draggable `<li>` chassis + a left drag handle around
// the existing RuleItem. The handle is the only drag-listener surface so the
// edit/delete buttons stay clickable; it's hidden while the row is in edit mode.
const SortableRuleItem: React.FC<React.ComponentProps<typeof RuleItem>> = (props) => {
  const _ = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.rule.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={clsx(
        'card eink-bordered border-base-200 bg-base-100 border transition-colors',
        isDragging ? 'z-10 shadow-md' : 'hover:border-base-300',
      )}
    >
      <div className='flex items-stretch'>
        {!props.isEditing && (
          <button
            type='button'
            className={clsx(
              'touch-target text-base-content/35 hover:text-base-content/70 flex w-7 shrink-0',
              'cursor-grab touch-none items-center justify-center active:cursor-grabbing',
            )}
            aria-label={_('Drag to reorder')}
            title={_('Drag to reorder')}
            {...attributes}
            {...listeners}
          >
            <MdDragIndicator className='h-4 w-4' />
          </button>
        )}
        <div className='min-w-0 flex-1'>
          <RuleItem {...props} />
        </div>
      </div>
    </li>
  );
};

// Hook to manage rules logic
const useReplacementRules = (bookKey: string | null) => {
  const { settings } = useSettingsStore();
  const { getViewSettings } = useReaderStore();
  const { getConfig } = useBookDataStore();

  const viewSettings = bookKey ? getViewSettings(bookKey) : null;
  const inMemoryRules = viewSettings?.proofreadRules || [];
  const persistedConfig = bookKey ? getConfig(bookKey) : null;
  const persistedBookRules = persistedConfig?.viewSettings?.proofreadRules || [];

  // Prefer persisted rules; fall back to in-memory. Drop tombstoned rules
  // (deletedAt set) — deletion is a soft tombstone now so it can sync across
  // devices (see store/proofreadStore.ts), but it must not show in the list.
  const bookRuleSource = (persistedBookRules.length ? persistedBookRules : inMemoryRules).filter(
    (r: ProofreadRule) => !r.deletedAt,
  );

  const singleRules = bookRuleSource
    .filter((r: ProofreadRule) => r.scope === 'selection')
    .sort(byOrder);
  const bookScopedRules = bookRuleSource.filter((r: ProofreadRule) => r.scope === 'book');
  const globalRules = (settings?.globalViewSettings?.proofreadRules || []).filter(
    (r: ProofreadRule) => !r.deletedAt,
  );

  // Merge book-scoped and global rules
  const globalRuleIds = new Set(globalRules.map((gr: ProofreadRule) => gr.id));

  // Remove orphaned overrides (disabled global rules that no longer exist)
  const validBookRules = bookScopedRules.filter(
    (br: ProofreadRule) => br.enabled !== false || globalRuleIds.has(br.id),
  );

  // Sort by `order` so a drag-to-reorder (which rewrites the order field)
  // persists visually; the stable sort keeps insertion order while every
  // rule still shares the default order.
  const mergedBookRules = validBookRules
    .concat(
      globalRules.filter(
        (gr: ProofreadRule) => !validBookRules.find((br: ProofreadRule) => br.id === gr.id),
      ),
    )
    .sort(byOrder);

  return { singleRules, bookRules: mergedBookRules };
};

export const ProofreadRulesManager: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { recreateViewer } = useReaderStore();
  const { sideBarBookKey } = useSidebarStore();
  const { addRule, updateRule, removeRule, reorderRules } = useProofreadStore();

  // dnd-kit sensors mirror the dictionaries reorder list: a small pointer
  // distance gate avoids hijacking handle clicks, a touch delay gives mobile
  // long-press-to-drag, and the keyboard sensor makes reordering accessible.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [isOpen, setIsOpen] = useState(false);
  const [addPattern, setAddPattern] = useState('');
  const [addReplacement, setAddReplacement] = useState('');
  const [addScope, setAddScope] = useState<Exclude<ProofreadScope, 'selection'>>('book');
  const [addIsRegex, setAddIsRegex] = useState(false);
  const [addCaseSensitive, setAddCaseSensitive] = useState(true);
  const [editing, setEditing] = useState<{
    id: string | null;
    scope: ProofreadScope | null;
    pattern: string;
    replacement: string;
    enabled: boolean;
    onlyForTTS: boolean;
  }>({ id: null, scope: null, pattern: '', replacement: '', enabled: true, onlyForTTS: false });

  const { singleRules, bookRules } = useReplacementRules(sideBarBookKey);

  useEffect(() => {
    const handleVisibility = (event: CustomEvent) => setIsOpen(!!event.detail?.visible);
    const el = document.getElementById(dialogId);
    el?.addEventListener('setProofreadRulesVisibility', handleVisibility as EventListener);
    return () =>
      el?.removeEventListener('setProofreadRulesVisibility', handleVisibility as EventListener);
  }, []);

  const startEdit = (rule: ProofreadRule) => {
    setEditing({
      id: rule.id,
      scope: rule.scope,
      pattern: rule.pattern,
      replacement: rule.replacement,
      enabled: !!rule.enabled,
      onlyForTTS: !!rule.onlyForTTS,
    });
  };

  const cancelEdit = () => {
    setEditing({
      id: null,
      scope: null,
      pattern: '',
      replacement: '',
      enabled: true,
      onlyForTTS: false,
    });
  };

  const saveEdit = async () => {
    if (!editing.id || !editing.scope || !sideBarBookKey) return;

    await updateRule(envConfig, sideBarBookKey, editing.id, {
      scope: editing.scope,
      pattern: editing.pattern,
      replacement: editing.replacement,
      enabled: editing.enabled,
      onlyForTTS: editing.onlyForTTS,
    });

    cancelEdit();

    if (!editing.onlyForTTS) {
      recreateViewer(envConfig, sideBarBookKey);
    }
  };

  const deleteRule = async (rule: ProofreadRule) => {
    if (!sideBarBookKey) return;
    await removeRule(envConfig, sideBarBookKey, rule.id, rule.scope);
    if (!rule.onlyForTTS) {
      recreateViewer(envConfig, sideBarBookKey);
    }
  };

  const handleAddRule = async () => {
    if (!sideBarBookKey) return;
    const pattern = addPattern.trim();
    const validation = validateReplacementRulePattern(pattern, addIsRegex);
    if (!validation.valid) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: pattern ? _('Invalid regular expression') : _('Find pattern cannot be empty'),
        timeout: 3000,
      });
      return;
    }

    await addRule(envConfig, sideBarBookKey, {
      scope: addScope,
      pattern,
      replacement: addReplacement.trim(),
      isRegex: addIsRegex,
      caseSensitive: addCaseSensitive,
      enabled: true,
    });

    setAddPattern('');
    setAddReplacement('');
    setAddIsRegex(false);
    recreateViewer(envConfig, sideBarBookKey);
  };

  const handleDragEnd = async (event: DragEndEvent, list: ProofreadRule[]) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !sideBarBookKey) return;
    const ids = list.map((r) => r.id);
    const fromIdx = ids.indexOf(String(active.id));
    const toIdx = ids.indexOf(String(over.id));
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = ids.splice(fromIdx, 1);
    if (!moved) return;
    ids.splice(toIdx, 0, moved);
    await reorderRules(envConfig, sideBarBookKey, ids);
    recreateViewer(envConfig, sideBarBookKey);
  };

  const renderRuleList = (
    rules: ProofreadRule[],
    scopeType: ProofreadScope,
    title: string,
    emptyMessage: string,
  ) => (
    <div className='flex flex-col gap-2'>
      <SectionTitle>{title}</SectionTitle>
      {rules.length === 0 ? (
        <div className='border-base-300 bg-base-200/30 rounded-xl border border-dashed p-6 text-center'>
          <p className='text-base-content/50 text-sm'>{emptyMessage}</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={dragModifiers}
          onDragEnd={(event) => handleDragEnd(event, rules)}
        >
          <SortableContext items={rules.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <ul className='flex flex-col gap-2'>
              {rules.map((rule) => (
                <SortableRuleItem
                  key={rule.id}
                  rule={rule}
                  scope={scopeType === 'selection' ? 'selection' : rule.scope}
                  isEditing={
                    editing.id === rule.id &&
                    editing.scope === (scopeType === 'selection' ? 'selection' : rule.scope)
                  }
                  editingData={editing}
                  onEdit={() => startEdit(rule)}
                  onDelete={() => deleteRule(rule)}
                  onSave={saveEdit}
                  onCancel={cancelEdit}
                  onEditChange={(_, value) => setEditing({ ...editing, replacement: value })}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );

  return (
    <Dialog
      id={dialogId}
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title={_('Proofread Replacement Rules')}
      // Cap the height on desktop (where the modal is auto-height) so the body
      // scrolls; on mobile the modal is full-height and the body fills it.
      boxClassName='sm:!min-w-[560px] sm:!max-w-[640px] sm:h-auto sm:!max-h-[80vh]'
      // Drop the body's default horizontal padding so the scrollbar rides the
      // modal's right edge (the inner `p-4 sm:p-6` keeps content off it), and
      // `min-h-0` lets the flex-grow body shrink-to-scroll inside the capped
      // modal instead of overflowing.
      contentClassName='!px-0 min-h-0'
    >
      {isOpen && (
        <div className='flex flex-col gap-6 p-4 sm:p-6'>
          <div className='flex flex-col gap-2'>
            <SectionTitle>{_('Add Rule')}</SectionTitle>
            <div className='card eink-bordered border-base-200 bg-base-100 gap-3 border p-4'>
              <input
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                placeholder={_('Find...')}
                spellCheck='false'
                value={addPattern}
                onChange={(e) => setAddPattern(e.target.value)}
              />
              <input
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                placeholder={_('Replace with...')}
                spellCheck='false'
                value={addReplacement}
                onChange={(e) => setAddReplacement(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddRule();
                }}
              />
              <div className='flex flex-wrap items-center gap-x-5 gap-y-3 pt-0.5'>
                <label className='flex items-center gap-2'>
                  <span className='text-base-content/70 text-sm'>{_('Scope:')}</span>
                  <select
                    className='select select-sm select-bordered eink-bordered min-h-9 h-9'
                    value={addScope}
                    onChange={(e) =>
                      setAddScope(e.target.value as Exclude<ProofreadScope, 'selection'>)
                    }
                  >
                    <option value='book'>{_('Book')}</option>
                    <option value='library'>{_('Library')}</option>
                  </select>
                </label>
                <label className='flex cursor-pointer items-center gap-2'>
                  <span className='text-base-content/70 text-sm'>{_('Regex:')}</span>
                  <input
                    type='checkbox'
                    className='toggle toggle-sm'
                    checked={addIsRegex}
                    onChange={(e) => setAddIsRegex(e.target.checked)}
                  />
                </label>
                <label className='flex cursor-pointer items-center gap-2'>
                  <span className='text-base-content/70 text-sm'>{_('Case sensitive:')}</span>
                  <input
                    type='checkbox'
                    className='toggle toggle-sm'
                    checked={addCaseSensitive}
                    onChange={(e) => setAddCaseSensitive(e.target.checked)}
                  />
                </label>
              </div>
              <div className='border-base-200 mt-1 flex justify-end border-t pt-3'>
                <button
                  className='btn btn-contrast h-10 min-h-10 rounded-lg px-5 text-sm font-medium disabled:opacity-40'
                  onClick={handleAddRule}
                  disabled={!addPattern.trim()}
                >
                  {_('Add Rule')}
                </button>
              </div>
            </div>
          </div>
          {renderRuleList(
            singleRules,
            'selection',
            _('Selected Text Rules'),
            _('No selected text replacement rules'),
          )}
          {renderRuleList(
            bookRules,
            'book',
            _('Book Specific Rules'),
            _('No book-level replacement rules'),
          )}
          <div className='p-1'></div>
        </div>
      )}
    </Dialog>
  );
};

export default ProofreadRulesManager;
