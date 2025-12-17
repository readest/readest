import React, { useEffect, useState } from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { ReplacementRule } from '@/types/book';
import environmentConfig from '@/services/environment';
import { updateReplacementRule, removeReplacementRule } from '@/services/transformers/replacement';
import { eventDispatcher } from '@/utils/event';
import { RiEditLine, RiDeleteBin7Line } from 'react-icons/ri';

export const setReplacementRulesWindowVisible = (visible: boolean) => {
  const dialog = document.getElementById('replacement_rules_window');
  if (dialog) {
    const event = new CustomEvent('setReplacementRulesVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

export const ReplacementRulesWindow: React.FC = () => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { getViewSettings } = useReaderStore();
  const { sideBarBookKey } = useSidebarStore();
  const { getConfig } = useBookDataStore();

  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(!!event.detail?.visible);
    };

    const el = document.getElementById('replacement_rules_window');
    el?.addEventListener('setReplacementRulesVisibility', handleCustomEvent as EventListener);

    return () => {
      el?.removeEventListener('setReplacementRulesVisibility', handleCustomEvent as EventListener);
    };
  }, []);

  const viewSettings = sideBarBookKey ? getViewSettings(sideBarBookKey) : null;
  const inMemoryRules = viewSettings?.replacementRules || [];
  const persistedConfig = sideBarBookKey ? getConfig(sideBarBookKey) : null;
  const persistedBookRules = persistedConfig?.viewSettings?.replacementRules || [];

  // Prefer persisted rules; fall back to in-memory so we show unsaved edits in tests/dev
  const bookRuleSource = persistedBookRules.length ? persistedBookRules : inMemoryRules;

  const singleRules = bookRuleSource.filter((r: ReplacementRule) => !!r.singleInstance);
  const bookScopedRules = bookRuleSource.filter((r: ReplacementRule) => !r.singleInstance);

  // Book rules = book-scoped rules + global rules (merged for display)
  // Merge logic:
  // 1. Include all book-scoped rules (including disabled overrides of global rules)
  // 2. Include global rules that aren't overridden at book level
  // 3. Filter out orphaned overrides (disabled global rules that no longer exist globally)
  const globalRules = settings?.globalViewSettings?.replacementRules || [];

  // Create a map of global rule IDs to identify overridden rules
  const globalRuleIds = new Set(globalRules.map((gr: ReplacementRule) => gr.id));

  // Filter out book rules that are disabled overrides of non-existent global rules
  const validBookRules = bookScopedRules.filter((br: ReplacementRule) => {
    // If it's enabled, it's a real book rule
    if (br.enabled !== false) return true;
    // If it's disabled and the global rule still exists, keep it (it's an override)
    // If the global rule doesn't exist, filter it out (orphaned override)
    return globalRuleIds.has(br.id);
  });

  const mergedRules = validBookRules.concat(
    globalRules.filter(
      (gr: ReplacementRule) => !validBookRules.find((br: ReplacementRule) => br.id === gr.id),
    ),
  );

  // Create a map to track the scope of each rule for editing/deleting
  const getRuleScope = (rule: ReplacementRule): 'single' | 'book' | 'global' => {
    if (rule.singleInstance) return 'single';
    // If the rule is in validBookRules and originates from global, it's an override
    return globalRuleIds.has(rule.id) ? 'global' : 'book';
  };

  const bookRules = mergedRules;

  const [editing, setEditing] = useState<{
    id: string | null;
    scope: 'single' | 'book' | 'global' | null;
    pattern: string;
    replacement: string;
    enabled: boolean;
  }>({ id: null, scope: null, pattern: '', replacement: '', enabled: true });

  // Track when a delete/edit operation is in progress to prevent rapid successive operations
  const [isReloading, setIsReloading] = useState(false);

  const startEdit = (r: ReplacementRule, scope: 'single' | 'book' | 'global') => {
    setEditing({
      id: r.id,
      scope,
      pattern: r.pattern,
      replacement: r.replacement,
      enabled: !!r.enabled,
    });
  };

  const cancelEdit = () =>
    setEditing({ id: null, scope: null, pattern: '', replacement: '', enabled: true });

  const saveEdit = async () => {
    if (!editing.id || !editing.scope) return;

    // Prevent rapid successive operations
    if (isReloading) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('Please wait for the current operation to complete.'),
        timeout: 3000,
      });
      return;
    }
    setIsReloading(true);
    try {
      const bookKey = sideBarBookKey || '';
      if (editing.scope === 'global') {
        await updateReplacementRule(
          environmentConfig,
          bookKey,
          editing.id,
          {
            pattern: editing.pattern,
            replacement: editing.replacement,
            enabled: editing.enabled,
          },
          'global',
        );
      } else if (editing.scope === 'book' && sideBarBookKey) {
        await updateReplacementRule(
          environmentConfig,
          sideBarBookKey,
          editing.id,
          {
            pattern: editing.pattern,
            replacement: editing.replacement,
            enabled: editing.enabled,
          },
          'book',
        );
      } else if (editing.scope === 'single' && sideBarBookKey) {
        await updateReplacementRule(
          environmentConfig,
          sideBarBookKey,
          editing.id,
          {
            pattern: editing.pattern,
            replacement: editing.replacement,
            enabled: editing.enabled,
          },
          'single',
        );
      }
      cancelEdit();
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Replacement rule updated. Reloading book to apply changes...'),
        timeout: 3000,
      });
      if (sideBarBookKey) {
        const { clearViewState, initViewState } = useReaderStore.getState();
        const id = sideBarBookKey.split('-')[0]!;
        // Hard reload: clear and reinit viewer to load from original source
        clearViewState(sideBarBookKey);
        await initViewState(environmentConfig, id, sideBarBookKey, true, true);
      }
    } catch (err) {
      console.error('Failed to save replacement rule', err);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to update replacement rule'),
        timeout: 3000,
      });
    } finally {
      setIsReloading(false);
    }
  };

  const deleteRule = async (ruleId: string, scope: 'single' | 'book' | 'global') => {
    console.log('Deleting rule', ruleId, 'scope', scope);

    // Prevent rapid successive deletions
    if (isReloading) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        message: _('Please wait for the book to finish reloading.'),
        timeout: 3000,
      });
      return;
    }
    setIsReloading(true);

    try {
      const bookKey = sideBarBookKey || '';

      if (scope === 'global') {
        // delete global rule for all books
        await removeReplacementRule(environmentConfig, '', ruleId, 'global');
      } else {
        await removeReplacementRule(environmentConfig, bookKey, ruleId, scope);
      }
      const successMessage =
        scope === 'global'
          ? _(
              'Global replacement rule deleted for all books in the library. Reloading book to apply changes...',
            )
          : _('Replacement rule deleted. Reloading book to apply changes...');

      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: successMessage,
        timeout: 3000,
      });
      if (sideBarBookKey) {
        const { clearViewState, initViewState } = useReaderStore.getState();
        const id = sideBarBookKey.split('-')[0]!;
        // Hard reload: clear and reinit viewer to load from original source
        clearViewState(sideBarBookKey);
        await initViewState(environmentConfig, id, sideBarBookKey, true, true);
      }
    } catch (err) {
      console.error('Failed to delete replacement rule', err);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to delete replacement rule'),
        timeout: 3000,
      });
    } finally {
      setIsReloading(false);
    }
  };

  return (
    <Dialog
      id='replacement_rules_window'
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title={_('Replacement Rules')}
      boxClassName='sm:!min-w-[520px] sm:h-auto'
    >
      {isOpen && (
        <div className='mb-4 mt-0 flex flex-col gap-4 p-2 sm:p-4'>
          <div>
            <h3 className='text-sm font-semibold'>{_('Single Instance Rules')}</h3>
            {singleRules.length === 0 ? (
              <p className='text-base-content/70 mt-2 text-sm'>
                {_('No single replacement rules')}
              </p>
            ) : (
              <ul className='mt-2 space-y-2'>
                {singleRules.map((r) => (
                  <li key={r.id} className='rounded border p-2'>
                    {editing.id === r.id && editing.scope === 'single' ? (
                      <div className='flex flex-col gap-2'>
                        <div className='flex items-center gap-2'>
                          <label className='text-base-content/70 whitespace-nowrap text-xs'>
                            {_('Selected phrase:')}
                          </label>
                          <input
                            className='input input-sm flex-1 text-sm opacity-60'
                            value={editing.pattern}
                            disabled
                          />
                        </div>

                        <div className='flex items-center gap-2'>
                          <label className='text-base-content/70 whitespace-nowrap text-xs'>
                            {_('Replace with:')}
                          </label>
                          <input
                            className='input input-sm flex-1'
                            value={editing.replacement}
                            onChange={(e) =>
                              setEditing({ ...editing, replacement: e.target.value })
                            }
                          />
                        </div>

                        <div className='flex gap-2'>
                          <button className='btn btn-sm btn-primary' onClick={saveEdit}>
                            {_('Save')}
                          </button>
                          <button className='btn btn-sm' onClick={cancelEdit}>
                            {_('Cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className='flex items-center justify-between'>
                        <div className='flex flex-col'>
                          <div className='text-base font-medium leading-tight'>{r.pattern}</div>
                          <div className='text-base-content/70 mt-1 break-all text-sm'>
                            <span className='text-base-content/80 mr-2 text-xs font-medium'>
                              {_('Replace with:')}
                            </span>
                            {r.replacement}
                          </div>
                          <div className='text-base-content/60 mt-1 text-xs'>
                            {_('Scope:')}&nbsp;<span className='font-medium'>Single Instance</span>
                            &nbsp;|&nbsp;{_('Case sensitive:')}&nbsp;
                            <span className='font-medium'>
                              {r.caseSensitive !== false ? _('Yes') : _('No')}
                            </span>
                          </div>
                        </div>
                        <div className='flex items-center gap-2'>
                          <button
                            className='btn btn-ghost btn-xs p-1'
                            onClick={() => startEdit(r, 'single')}
                            aria-label={_('Edit')}
                          >
                            <RiEditLine />
                          </button>
                          <button
                            className='btn btn-ghost btn-xs p-1'
                            onClick={() => deleteRule(r.id, 'single')}
                            aria-label={_('Delete')}
                          >
                            <RiDeleteBin7Line />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <h3 className='mt-4 text-sm font-semibold'>{_('Book Specific Rules')}</h3>
            {bookRules.length === 0 ? (
              <p className='text-base-content/70 mt-2 text-sm'>
                {_('No book-level replacement rules')}
              </p>
            ) : (
              <ul className='mt-2 space-y-2'>
                {bookRules.map((r) => {
                  const ruleScope = getRuleScope(r);
                  const isEditing = editing.id === r.id && editing.scope === ruleScope;
                  return (
                    <li key={r.id} className='rounded border p-2'>
                      {isEditing ? (
                        <div className='flex flex-col gap-2'>
                          <div className='flex items-center gap-2'>
                            <label className='text-base-content/70 whitespace-nowrap text-xs'>
                              {_('Selected phrase:')}
                            </label>
                            <input
                              className='input input-sm flex-1 text-sm opacity-60'
                              value={editing.pattern}
                              disabled
                            />
                          </div>

                          <div className='flex items-center gap-2'>
                            <label className='text-base-content/70 whitespace-nowrap text-xs'>
                              {_('Replace with:')}
                            </label>
                            <input
                              className='input input-sm flex-1'
                              value={editing.replacement}
                              onChange={(e) =>
                                setEditing({ ...editing, replacement: e.target.value })
                              }
                            />
                          </div>

                          <div className='flex gap-2'>
                            <button className='btn btn-sm btn-primary' onClick={saveEdit}>
                              {_('Save')}
                            </button>
                            <button className='btn btn-sm' onClick={cancelEdit}>
                              {_('Cancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className='flex items-center justify-between'>
                          <div className='flex flex-col'>
                            <div className='text-base font-medium leading-tight'>{r.pattern}</div>
                            <div className='text-base-content/70 mt-1 break-all text-sm'>
                              <span className='text-base-content/80 mr-2 text-xs font-medium'>
                                {_('Replace with:')}
                              </span>
                              {r.replacement}
                            </div>
                            <div className='text-base-content/60 mt-1 text-xs'>
                              {_('Scope:')}&nbsp;
                              <span className='font-medium'>
                                {getRuleScope(r) === 'book' ? _('Book') : _('Global')}
                              </span>
                              &nbsp;|&nbsp;{_('Case sensitive:')}&nbsp;
                              <span className='font-medium'>
                                {r.caseSensitive !== false ? _('Yes') : _('No')}
                              </span>
                            </div>
                          </div>
                          <div className='flex items-center gap-2'>
                            <button
                              className='btn btn-ghost btn-xs p-1'
                              onClick={() => startEdit(r, getRuleScope(r))}
                              aria-label={_('Edit')}
                            >
                              <RiEditLine />
                            </button>
                            <button
                              className='btn btn-ghost btn-xs p-1'
                              onClick={() => deleteRule(r.id, ruleScope)}
                              aria-label={_('Delete')}
                            >
                              <RiDeleteBin7Line />
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
};

export default ReplacementRulesWindow;
