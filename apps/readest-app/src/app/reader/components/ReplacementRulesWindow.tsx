import React, { useEffect, useState } from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import environmentConfig from '@/services/environment';
import { updateReplacementRule, removeReplacementRule } from '@/services/transformers/replacement';
import { eventDispatcher } from '@/utils/event';
import { RiEditLine, RiDeleteBin7Line } from 'react-icons/ri';

export const setReplacementRulesWindowVisible = (visible: boolean) => {
  // Persist desired visibility on window so components that mount later can read it
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  window.__REPLACEMENT_RULES_WINDOW_VISIBLE__ = visible;
  const event = new CustomEvent('setReplacementRulesVisibility', {
    detail: { visible },
  });
  // Dispatch on window so listeners attached to window/document will receive it
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(event);
  }
};

export const ReplacementRulesWindow: React.FC = () => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { getViewSettings } = useReaderStore();
  const { sideBarBookKey } = useSidebarStore();

  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleCustomEvent = (event: Event) => {
      const ev = event as CustomEvent;
      setIsOpen(!!ev.detail?.visible);
    };

    // Initialize from window flag in case the open request fired before mount
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const initial = typeof window !== 'undefined' ? !!window.__REPLACEMENT_RULES_WINDOW_VISIBLE__ : false;
    setIsOpen(initial);

    // Listen on window for visibility events
    if (typeof window !== 'undefined') {
      window.addEventListener('setReplacementRulesVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('setReplacementRulesVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  // const globalRules = settings?.globalViewSettings?.replacementRules || [];
  const viewSettings = sideBarBookKey ? getViewSettings(sideBarBookKey) : null;
  const inMemoryRules = viewSettings?.replacementRules || [];
  const persistedConfig = sideBarBookKey ? useBookDataStore.getState().getConfig(sideBarBookKey) : null;
  const persistedBookRules = persistedConfig?.viewSettings?.replacementRules || [];
  // Single rules = in-memory rules that are not persisted in the book config
  const singleRules = inMemoryRules.filter((r: any) => !persistedBookRules.find((p: any) => p.id === r.id));
  // Book rules = persisted book rules + global rules (merged for display)
  // Remove duplicates: if a pattern exists in both book and global rules, keep the book rule
  const globalRules = settings?.globalViewSettings?.replacementRules || [];
  const mergedRules = persistedBookRules.concat(
    globalRules.filter((gr: any) => !persistedBookRules.find((br: any) => br.pattern === gr.pattern))
  );
  
  // Create a map to track the scope of each rule for editing/deleting
  const getRuleScope = (rule: any): 'book' | 'global' => {
    return persistedBookRules.find((br: any) => br.id === rule.id) ? 'book' : 'global';
  };
  
  const bookRules = mergedRules;

  const [editing, setEditing] = useState<{
    id: string | null;
    scope: 'single' | 'book' | 'global' | null;
    pattern: string;
    replacement: string;
    enabled: boolean;
  }>({ id: null, scope: null, pattern: '', replacement: '', enabled: true });

  const startEdit = (r: any, scope: 'single' | 'book' | 'global') => {
    setEditing({ id: r.id, scope, pattern: r.pattern, replacement: r.replacement, enabled: !!r.enabled });
  };

  const cancelEdit = () => setEditing({ id: null, scope: null, pattern: '', replacement: '', enabled: true });

  const saveEdit = async () => {
    if (!editing.id || !editing.scope) return;
    try {
      const bookKey = sideBarBookKey || '';
      if (editing.scope === 'global') {
        await updateReplacementRule(environmentConfig, bookKey, editing.id, {
          pattern: editing.pattern,
          replacement: editing.replacement,
          enabled: editing.enabled,
        }, 'global');
      } else if (editing.scope === 'book' && sideBarBookKey) {
        await updateReplacementRule(environmentConfig, sideBarBookKey, editing.id, {
          pattern: editing.pattern,
          replacement: editing.replacement,
          enabled: editing.enabled,
        }, 'book');
      } else if (editing.scope === 'single' && sideBarBookKey) {
        await updateReplacementRule(environmentConfig, sideBarBookKey, editing.id, {
          pattern: editing.pattern,
          replacement: editing.replacement,
          enabled: editing.enabled,
        }, 'single');
      }
      cancelEdit();
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Replacement rule updated successfully'),
        timeout: 3000,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to save replacement rule', err);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to update replacement rule'),
        timeout: 3000,
      });
    }
  };

  const deleteRule = async (ruleId: string, scope: 'single' | 'book' | 'global') => {
    try {
      const bookKey = sideBarBookKey || '';
      await removeReplacementRule(environmentConfig, bookKey, ruleId, scope);
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Replacement rule deleted successfully'),
        timeout: 3000,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to delete replacement rule', err);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to delete replacement rule'),
        timeout: 3000,
      });
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
            <h3 className='text-sm font-semibold'>{_('Single Rules')}</h3>
            {singleRules.length === 0 ? (
              <p className='text-sm text-base-content/70 mt-2'>{_('No single replacement rules')}</p>
            ) : (
              <ul className='mt-2 space-y-2'>
                {singleRules.map((r) => (
                  <li key={r.id} className='rounded border p-2'>
                    {editing.id === r.id && editing.scope === 'single' ? (
                      <div className='flex flex-col gap-2'>
                        <div className='flex items-center gap-2'>
                          <label className='text-xs text-base-content/70 whitespace-nowrap'>{_('Selected phrase:')}</label>
                          <input
                            className='input input-sm text-sm flex-1 opacity-60'
                            value={editing.pattern}
                            disabled
                          />
                        </div>

                        <div className='flex items-center gap-2'>
                          <label className='text-xs text-base-content/70 whitespace-nowrap'>{_('Replace with:')}</label>
                          <input
                            className='input input-sm flex-1'
                            value={editing.replacement}
                            onChange={(e) => setEditing({ ...editing, replacement: e.target.value })}
                          />
                        </div>

                        <div className='flex gap-2'>
                          <button className='btn btn-sm btn-primary' onClick={saveEdit}>{_('Save')}</button>
                          <button className='btn btn-sm' onClick={cancelEdit}>{_('Cancel')}</button>
                        </div>
                      </div>
                    ) : (
                      <div className='flex items-center justify-between'>
                        <div className='flex flex-col'>
                          <div className='font-medium text-base leading-tight'>{r.pattern}</div>
                          <div className='text-sm text-base-content/70 break-all mt-1'><span className='font-medium text-xs text-base-content/80 mr-2'>{_('Replace with:')}</span>{r.replacement}</div>
                        </div>
                        <div className='flex items-center gap-2'>
                          <button className='btn btn-ghost btn-xs p-1' onClick={() => startEdit(r, 'single')} aria-label={_('Edit')}>
                            <RiEditLine />
                          </button>
                          <button className='btn btn-ghost btn-xs p-1' onClick={() => deleteRule(r.id, 'single')} aria-label={_('Delete')}>
                            <RiDeleteBin7Line />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <h3 className='text-sm font-semibold mt-4'>{_('Book Specific Rules')}</h3>
                {bookRules.length === 0 ? (
              <p className='text-sm text-base-content/70 mt-2'>{_('No book-level replacement rules')}</p>
            ) : (
              <ul className='mt-2 space-y-2'>
                {bookRules.map((r) => (
                  <li key={r.id} className='rounded border p-2'>
                    {editing.id === r.id && editing.scope === 'book' ? (
                      <div className='flex flex-col gap-2'>
                        <div className='flex items-center gap-2'>
                          <label className='text-xs text-base-content/70 whitespace-nowrap'>{_('Selected phrase:')}</label>
                          <input
                            className='input input-sm text-sm flex-1 opacity-60'
                            value={editing.pattern}
                            disabled
                          />
                        </div>

                        <div className='flex items-center gap-2'>
                          <label className='text-xs text-base-content/70 whitespace-nowrap'>{_('Replace with:')}</label>
                          <input
                            className='input input-sm flex-1'
                            value={editing.replacement}
                            onChange={(e) => setEditing({ ...editing, replacement: e.target.value })}
                          />
                        </div>

                        <div className='flex gap-2'>
                          <button className='btn btn-sm btn-primary' onClick={saveEdit}>{_('Save')}</button>
                          <button className='btn btn-sm' onClick={cancelEdit}>{_('Cancel')}</button>
                        </div>
                      </div>
                    ) : (
                      <div className='flex items-center justify-between'>
                        <div className='flex flex-col'>
                          <div className='font-medium text-base leading-tight'>{r.pattern}</div>
                          <div className='text-sm text-base-content/70 break-all mt-1'><span className='font-medium text-xs text-base-content/80 mr-2'>{_('Replace with:')}</span>{r.replacement}</div>
                        </div>
                        <div className='flex items-center gap-2'>
                          <button className='btn btn-ghost btn-xs p-1' onClick={() => startEdit(r, 'book')} aria-label={_('Edit')}>
                            <RiEditLine />
                          </button>
                          <button className='btn btn-ghost btn-xs p-1' onClick={() => deleteRule(r.id, 'book')} aria-label={_('Delete')}>
                            <RiDeleteBin7Line />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
};

export default ReplacementRulesWindow;
