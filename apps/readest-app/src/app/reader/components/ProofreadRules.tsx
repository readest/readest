import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { RiEditLine, RiDeleteBin7Line } from 'react-icons/ri';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useProofreadStore } from '@/store/proofreadStore';
import { ProofreadRule, ProofreadScope } from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import Dialog from '@/components/Dialog';

const dialogId = 'proofread_rules_window';

export const setProofreadRulesVisibility = (visible: boolean) => {
  const dialog = document.getElementById(dialogId);
  if (dialog) {
    dialog.dispatchEvent(new CustomEvent('setProofreadRulesVisibility', { detail: { visible } }));
  }
};

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
    <div className='flex items-start justify-between gap-3 p-3'>
      <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
        <div className='break-words text-base font-medium leading-snug'>{rule.pattern}</div>
        <div className='text-base-content/70 break-words text-sm'>
          <span className='text-base-content/80 mr-1.5 text-xs font-medium'>
            {_('Replace with:')}
          </span>
          <span className='text-base-content/90'>{rule.replacement}</span>
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
        </div>
      </div>
      <div className='flex shrink-0 items-center gap-1'>
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

// Hook to manage rules logic
const useReplacementRules = (bookKey: string | null) => {
  const { settings } = useSettingsStore();
  const { getViewSettings } = useReaderStore();
  const { getConfig } = useBookDataStore();

  const viewSettings = bookKey ? getViewSettings(bookKey) : null;
  const inMemoryRules = viewSettings?.proofreadRules || [];
  const persistedConfig = bookKey ? getConfig(bookKey) : null;
  const persistedBookRules = persistedConfig?.viewSettings?.proofreadRules || [];

  // Prefer persisted rules; fall back to in-memory
  const bookRuleSource = persistedBookRules.length ? persistedBookRules : inMemoryRules;

  const singleRules = bookRuleSource.filter((r: ProofreadRule) => r.scope === 'selection');
  const bookScopedRules = bookRuleSource.filter((r: ProofreadRule) => r.scope === 'book');
  const globalRules = settings?.globalViewSettings?.proofreadRules || [];

  // Merge book-scoped and global rules
  const globalRuleIds = new Set(globalRules.map((gr: ProofreadRule) => gr.id));

  // Remove orphaned overrides (disabled global rules that no longer exist)
  const validBookRules = bookScopedRules.filter(
    (br: ProofreadRule) => br.enabled !== false || globalRuleIds.has(br.id),
  );

  const mergedBookRules = validBookRules.concat(
    globalRules.filter(
      (gr: ProofreadRule) => !validBookRules.find((br: ProofreadRule) => br.id === gr.id),
    ),
  );

  return { singleRules, bookRules: mergedBookRules };
};

export const ProofreadRulesManager: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { recreateViewer } = useReaderStore();
  const { sideBarBookKey } = useSidebarStore();
  const { updateRule, removeRule } = useProofreadStore();

  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<{
    id: string | null;
    scope: ProofreadScope | null;
    pattern: string;
    replacement: string;
    enabled: boolean;
  }>({ id: null, scope: null, pattern: '', replacement: '', enabled: true });

  const { singleRules, bookRules } = useReplacementRules(sideBarBookKey);

  useEffect(() => {
    const handleVisibility = (event: CustomEvent) => setIsOpen(!!event.detail?.visible);
    const el = document.getElementById(dialogId);
    el?.addEventListener('setProofreadRulesVisibility', handleVisibility as EventListener);
    return () =>
      el?.removeEventListener('setProofreadRulesVisibility', handleVisibility as EventListener);
  }, []);

  const startEdit = (rule: ProofreadRule, scope: ProofreadScope) => {
    setEditing({
      id: rule.id,
      scope,
      pattern: rule.pattern,
      replacement: rule.replacement,
      enabled: !!rule.enabled,
    });
  };

  const cancelEdit = () => {
    setEditing({ id: null, scope: null, pattern: '', replacement: '', enabled: true });
  };

  const saveEdit = async () => {
    if (!editing.id || !editing.scope || !sideBarBookKey) return;

    await updateRule(envConfig, sideBarBookKey, editing.id, {
      scope: editing.scope,
      pattern: editing.pattern,
      replacement: editing.replacement,
      enabled: editing.enabled,
    });

    cancelEdit();
    recreateViewer(envConfig, sideBarBookKey);
  };

  const deleteRule = async (ruleId: string, scope: ProofreadScope) => {
    if (!sideBarBookKey) return;
    await removeRule(envConfig, sideBarBookKey, ruleId, scope);
    recreateViewer(envConfig, sideBarBookKey);
  };

  const renderRuleList = (
    rules: ProofreadRule[],
    scopeType: ProofreadScope,
    title: string,
    emptyMessage: string,
  ) => (
    <div className='flex flex-col gap-3'>
      <h3 className='text-base-content/90 text-sm font-semibold'>{title}</h3>
      {rules.length === 0 ? (
        <div className='border-base-content/10 bg-base-200/30 rounded-lg border border-dashed p-6 text-center'>
          <p className='text-base-content/50 text-sm'>{emptyMessage}</p>
        </div>
      ) : (
        <ul className='flex flex-col gap-2'>
          {rules.map((rule) => (
            <li
              key={rule.id}
              className='border-base-content/10 bg-base-100 hover:border-base-content/20 rounded-lg border transition-colors'
            >
              <RuleItem
                rule={rule}
                scope={scopeType === 'selection' ? 'selection' : rule.scope}
                isEditing={
                  editing.id === rule.id &&
                  editing.scope === (scopeType === 'selection' ? 'selection' : rule.scope)
                }
                editingData={editing}
                onEdit={() => startEdit(rule, scopeType === 'selection' ? 'selection' : rule.scope)}
                onDelete={() =>
                  deleteRule(rule.id, scopeType === 'selection' ? 'selection' : rule.scope)
                }
                onSave={saveEdit}
                onCancel={cancelEdit}
                onEditChange={(_, value) => setEditing({ ...editing, replacement: value })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Dialog
      id={dialogId}
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title={_('Proofread Replacement Rules')}
      boxClassName='sm:!min-w-[560px] sm:!max-w-[640px] sm:h-auto'
    >
      {isOpen && (
        <div className='flex max-h-[70vh] flex-col gap-6 p-4 sm:p-6'>
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
