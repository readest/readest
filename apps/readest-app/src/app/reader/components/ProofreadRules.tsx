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
import { Toggle } from '@/components/primitives/toggle';
import {
  BoxedList,
  SectionTitle,
  SettingsInput,
  SettingsRow,
  SettingsSelect,
  SettingsSwitchRow,
} from '@/components/settings/primitives';

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

// Attribute chips on a rule row. Only the attributes that are actually on get
// a chip — a "Case sensitive: No · Only for TTS: No" ledger reads as noise and
// leans on `/50`-opacity text that e-ink can't render (DESIGN.md §10.5).
const RuleChip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className='badge badge-sm badge-ghost eink-bordered shrink-0'>{children}</span>
);

type RuleEditingData = {
  pattern: string;
  replacement: string;
  enabled: boolean;
  isRegex: boolean;
  caseSensitive: boolean;
  onlyForTTS: boolean;
};

const RuleItem: React.FC<{
  rule: ProofreadRule;
  scope: ProofreadScope;
  isEditing: boolean;
  editingData: RuleEditingData;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onSave: () => void;
  onCancel: () => void;
  onEditChange: (patch: Partial<Omit<RuleEditingData, 'enabled'>>) => void;
}> = ({
  rule,
  scope,
  isEditing,
  editingData,
  onEdit,
  onDelete,
  onToggle,
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
    const isSelection = scope === 'selection';
    return (
      <div className='flex flex-col gap-3 p-3'>
        <div className='flex flex-col gap-1.5'>
          <SectionTitle as='label' className='block ps-0'>
            {isSelection ? _('Selected text') : _('Find')}
          </SectionTitle>
          <input
            className={clsx(
              'input settings-content eink-bordered h-11 w-full focus:outline-hidden',
              isSelection && 'bg-base-200 opacity-60',
            )}
            value={editingData.pattern}
            disabled={isSelection}
            spellCheck='false'
            onChange={isSelection ? undefined : (e) => onEditChange({ pattern: e.target.value })}
          />
        </div>

        <div className='flex flex-col gap-1.5'>
          <SectionTitle as='label' className='block ps-0'>
            {_('Replace with')}
          </SectionTitle>
          <input
            className='input settings-content eink-bordered h-11 w-full focus:outline-hidden'
            value={editingData.replacement}
            spellCheck='false'
            onChange={(e) => onEditChange({ replacement: e.target.value })}
          />
        </div>

        {!isSelection && (
          <div className='flex flex-wrap items-center gap-x-5 gap-y-3'>
            <label className='flex cursor-pointer items-center gap-2'>
              <span>{_('Regex')}</span>
              <Toggle
                className='toggle-sm'
                checked={editingData.isRegex}
                onChange={(e) => onEditChange({ isRegex: e.target.checked })}
              />
            </label>
            <label className='flex cursor-pointer items-center gap-2'>
              <span>{_('Case sensitive')}</span>
              <Toggle
                className='toggle-sm'
                checked={editingData.caseSensitive}
                onChange={(e) => onEditChange({ caseSensitive: e.target.checked })}
              />
            </label>
            <label className='flex cursor-pointer items-center gap-2'>
              <span>{_('Only for TTS')}</span>
              <Toggle
                className='toggle-sm'
                checked={editingData.onlyForTTS}
                onChange={(e) => onEditChange({ onlyForTTS: e.target.checked })}
              />
            </label>
          </div>
        )}

        {/* Ghost cancel + solid submit: on e-ink the pair still reads as
            secondary vs. primary once the solid button inverts. */}
        <div className='mt-1 flex gap-2'>
          <button className='btn btn-ghost btn-sm flex-1' onClick={onCancel}>
            {_('Cancel')}
          </button>
          <button className='btn btn-contrast btn-sm flex-1' onClick={onSave}>
            {_('Save')}
          </button>
        </div>
      </div>
    );
  }

  const isDisabled = rule.enabled === false;
  const scopeLabel =
    scope === 'selection' ? _('Selection') : scope === 'book' ? _('Book') : _('Library');

  return (
    <div className='relative flex items-start justify-between gap-3 p-3'>
      <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
        <div
          className={clsx(
            'break-words pe-28 font-medium leading-snug',
            isDisabled && 'text-base-content/60',
          )}
        >
          {rule.pattern}
        </div>
        <div className='text-base-content/80 break-words text-[0.85em]'>
          <span className='me-1.5 font-medium'>{_('Replace with:')}</span>
          {!rule.replacement ? (
            // An empty replacement deletes the match. Rendering it as a blank
            // gap leaves the row looking broken, so name the behaviour.
            <span className='text-base-content/70 italic'>{_('(removes the text)')}</span>
          ) : rule.replacement.trim() ? (
            <span>{rule.replacement}</span>
          ) : (
            // Whitespace-only (collapsing double spaces, say) is invisible on
            // its own -- quote it, and keep the runs from collapsing in HTML.
            <span className='whitespace-pre'>{`'${rule.replacement}'`}</span>
          )}
        </div>
        <div className='flex flex-wrap items-center gap-1.5'>
          {scope === 'selection' ? (
            <button
              type='button'
              onClick={navigateToSelection}
              className='badge badge-sm badge-ghost eink-bordered hover:bg-base-300 shrink-0 transition-colors duration-150'
            >
              {scopeLabel}
            </button>
          ) : (
            <RuleChip>{scopeLabel}</RuleChip>
          )}
          {rule.isRegex && <RuleChip>{_('Regex')}</RuleChip>}
          {rule.caseSensitive !== false && <RuleChip>{_('Case sensitive')}</RuleChip>}
          {rule.onlyForTTS && <RuleChip>{_('Only for TTS')}</RuleChip>}
        </div>
      </div>
      <div className='absolute end-2 top-2 flex items-center gap-1'>
        <Toggle
          className='toggle-sm'
          checked={!isDisabled}
          onChange={onToggle}
          aria-label={isDisabled ? _('Enable rule') : _('Disable rule')}
        />
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

  // Merge book-scoped rules with global (library) rules. Keep disabled rules so
  // the per-rule enable/disable toggle can turn them back on; book and library
  // ids never collide (ensureRuleId folds scope into the id), so dedup-by-id
  // here only guards a legacy shared id from listing the same rule twice.
  // Sort by `order` so a drag-to-reorder (which rewrites the order field)
  // persists visually; the stable sort keeps insertion order while every rule
  // still shares the default order.
  const mergedBookRules = bookScopedRules
    .concat(
      globalRules.filter(
        (gr: ProofreadRule) => !bookScopedRules.find((br: ProofreadRule) => br.id === gr.id),
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
  const { addRule, updateRule, removeRule, reorderRules, toggleRule } = useProofreadStore();

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
  const [addOnlyForTTS, setAddOnlyForTTS] = useState(false);
  const [editing, setEditing] = useState<
    RuleEditingData & {
      id: string | null;
      scope: ProofreadScope | null;
      // The flag as it was when the edit started. A rule that leaves (or never
      // had) TTS-only status changes the rendered text, so the viewer has to be
      // rebuilt; only a TTS-only → TTS-only edit can skip it.
      wasOnlyForTTS: boolean;
    }
  >({
    id: null,
    scope: null,
    pattern: '',
    replacement: '',
    enabled: true,
    isRegex: false,
    caseSensitive: true,
    onlyForTTS: false,
    wasOnlyForTTS: false,
  });

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
      isRegex: !!rule.isRegex,
      caseSensitive: rule.caseSensitive !== false,
      onlyForTTS: !!rule.onlyForTTS,
      wasOnlyForTTS: !!rule.onlyForTTS,
    });
  };

  const cancelEdit = () => {
    setEditing({
      id: null,
      scope: null,
      pattern: '',
      replacement: '',
      enabled: true,
      isRegex: false,
      caseSensitive: true,
      onlyForTTS: false,
      wasOnlyForTTS: false,
    });
  };

  const saveEdit = async () => {
    if (!editing.id || !editing.scope || !sideBarBookKey) return;

    // Selection rules keep a read-only Find (anchored to the selected text), so
    // only validate the pattern when the user can actually edit it.
    const isSelection = editing.scope === 'selection';
    const pattern = isSelection ? editing.pattern : editing.pattern.trim();
    if (!isSelection) {
      const validation = validateReplacementRulePattern(pattern, editing.isRegex);
      if (!validation.valid) {
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: pattern ? _('Invalid regular expression') : _('Find pattern cannot be empty'),
          timeout: 3000,
        });
        return;
      }
    }

    await updateRule(envConfig, sideBarBookKey, editing.id, {
      scope: editing.scope,
      pattern,
      replacement: editing.replacement,
      isRegex: editing.isRegex,
      caseSensitive: editing.caseSensitive,
      enabled: editing.enabled,
      onlyForTTS: editing.onlyForTTS,
    });

    cancelEdit();

    if (!editing.onlyForTTS || !editing.wasOnlyForTTS) {
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

  const handleToggle = async (rule: ProofreadRule) => {
    if (!sideBarBookKey) return;
    await toggleRule(envConfig, sideBarBookKey, rule.id);
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
      onlyForTTS: addOnlyForTTS,
    });

    setAddPattern('');
    setAddReplacement('');
    setAddIsRegex(false);
    setAddOnlyForTTS(false);
    // A TTS-only rule never touches the rendered text, so the (expensive)
    // viewer rebuild would be pure churn.
    if (!addOnlyForTTS) {
      recreateViewer(envConfig, sideBarBookKey);
    }
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
        <div className='border-base-300 bg-base-200/30 eink-bordered rounded-lg border border-dashed p-6 text-center'>
          <p className='text-base-content/65 text-[0.85em]'>{emptyMessage}</p>
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
                  onToggle={() => handleToggle(rule)}
                  onSave={saveEdit}
                  onCancel={cancelEdit}
                  onEditChange={(patch) => setEditing((prev) => ({ ...prev, ...patch }))}
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
      boxClassName='sm:min-w-[560px]! sm:max-w-[640px]! sm:h-auto sm:max-h-[80vh]!'
      // Drop the body's default horizontal padding so the scrollbar rides the
      // modal's right edge (the inner `p-4 sm:p-6` keeps content off it), and
      // `min-h-0` lets the flex-grow body shrink-to-scroll inside the capped
      // modal instead of overflowing.
      contentClassName='px-0! min-h-0'
    >
      {isOpen && (
        <div className='flex flex-col gap-6 p-4 sm:p-6'>
          <p className='text-base-content/70 leading-relaxed'>
            {_('Replace text automatically as you read or listen, in this book or your library.')}
          </p>
          <div className='flex flex-col gap-3'>
            <BoxedList title={_('Add Rule')}>
              <SettingsRow label={_('Find')}>
                <SettingsInput
                  placeholder={_('Find...')}
                  spellCheck='false'
                  value={addPattern}
                  onChange={(e) => setAddPattern(e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label={_('Replace with')}>
                <SettingsInput
                  placeholder={_('Replace with...')}
                  spellCheck='false'
                  value={addReplacement}
                  onChange={(e) => setAddReplacement(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddRule();
                  }}
                />
              </SettingsRow>
              <SettingsRow label={_('Scope')}>
                <SettingsSelect
                  value={addScope}
                  ariaLabel={_('Scope')}
                  onChange={(e) =>
                    setAddScope(e.target.value as Exclude<ProofreadScope, 'selection'>)
                  }
                  options={[
                    { value: 'book', label: _('Book') },
                    { value: 'library', label: _('Library') },
                  ]}
                />
              </SettingsRow>
              <SettingsSwitchRow
                label={_('Regex')}
                checked={addIsRegex}
                onChange={() => setAddIsRegex(!addIsRegex)}
              />
              <SettingsSwitchRow
                label={_('Case sensitive')}
                checked={addCaseSensitive}
                onChange={() => setAddCaseSensitive(!addCaseSensitive)}
              />
              <SettingsSwitchRow
                label={_('Only for TTS')}
                description={_('Changes the spoken text only')}
                checked={addOnlyForTTS}
                onChange={() => setAddOnlyForTTS(!addOnlyForTTS)}
              />
            </BoxedList>
            <div className='flex justify-end'>
              <button
                className={clsx(
                  'btn btn-contrast h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
                  'focus-visible:ring-base-content/40 focus-visible:outline-hidden focus-visible:ring-2',
                  'disabled:opacity-40',
                )}
                onClick={handleAddRule}
                disabled={!addPattern.trim()}
              >
                {_('Add Rule')}
              </button>
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
