import React, { useEffect, useState } from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import environmentConfig from '@/services/environment';
import { updateReplacementRule, removeReplacementRule } from '@/services/transformers/replacement';

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

  const globalRules = settings?.globalViewSettings?.replacementRules || [];
  const viewSettings = sideBarBookKey ? getViewSettings(sideBarBookKey) : null;
  const inMemoryRules = viewSettings?.replacementRules || [];
  const persistedConfig = sideBarBookKey ? useBookDataStore.getState().getConfig(sideBarBookKey) : null;
  const persistedBookRules = persistedConfig?.viewSettings?.replacementRules || [];
  // Single rules = in-memory rules that are not persisted in the book config
  const singleRules = inMemoryRules.filter((r) => !persistedBookRules.find((p) => p.id === r.id));
  const bookRules = persistedBookRules;

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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to save replacement rule', err);
    }
  };

  const deleteRule = async (ruleId: string, scope: 'single' | 'book' | 'global') => {
    if (!window.confirm('Delete this replacement rule?')) return;
    try {
      const bookKey = sideBarBookKey || '';
      await removeReplacementRule(environmentConfig, bookKey, ruleId, scope);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to delete replacement rule', err);
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
                        <label className='text-xs text-base-content/70'>{_('Selected phrase:')}</label>
                        <input
                          className='input input-sm text-sm'
                          value={editing.pattern}
                          onChange={(e) => setEditing({ ...editing, pattern: e.target.value })}
                        />

                        <label className='text-xs text-base-content/70'>{_('Replace with:')}</label>
                        <input
                          className='input input-sm'
                          value={editing.replacement}
                          onChange={(e) => setEditing({ ...editing, replacement: e.target.value })}
                        />

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
                          <button className='btn btn-xs' onClick={() => startEdit(r, 'single')}>{_('Edit')}</button>
                          <button className='btn btn-xs btn-error' onClick={() => deleteRule(r.id, 'single')}>{_('Delete')}</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <h3 className='text-sm font-semibold mt-4'>{_('Book Rules')}</h3>
                {bookRules.length === 0 ? (
              <p className='text-sm text-base-content/70 mt-2'>{_('No book-level replacement rules')}</p>
            ) : (
              <ul className='mt-2 space-y-2'>
                {bookRules.map((r) => (
                  <li key={r.id} className='rounded border p-2'>
                    {editing.id === r.id && editing.scope === 'book' ? (
                      <div className='flex flex-col gap-2'>
                        <label className='text-xs text-base-content/70'>{_('Selected phrase:')}</label>
                        <input
                          className='input input-sm text-sm'
                          value={editing.pattern}
                          onChange={(e) => setEditing({ ...editing, pattern: e.target.value })}
                        />

                        <label className='text-xs text-base-content/70'>{_('Replace with:')}</label>
                        <input
                          className='input input-sm'
                          value={editing.replacement}
                          onChange={(e) => setEditing({ ...editing, replacement: e.target.value })}
                        />

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
                          <button className='btn btn-xs' onClick={() => startEdit(r, 'book')}>{_('Edit')}</button>
                          <button className='btn btn-xs btn-error' onClick={() => deleteRule(r.id, 'book')}>{_('Delete')}</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className='text-sm font-semibold'>{_('Global Rules')}</h3>
            {globalRules.length === 0 ? (
              <p className='text-sm text-base-content/70 mt-2'>{_('No global replacement rules')}</p>
            ) : (
              <ul className='mt-2 space-y-2'>
                {globalRules.map((r) => (
                  <li key={r.id} className='rounded border p-2'>
                    {editing.id === r.id && editing.scope === 'global' ? (
                      <div className='flex flex-col gap-2'>
                        <label className='text-xs text-base-content/70'>{_('Selected phrase:')}</label>
                        <input
                          className='input input-sm text-sm'
                          value={editing.pattern}
                          onChange={(e) => setEditing({ ...editing, pattern: e.target.value })}
                        />

                        <label className='text-xs text-base-content/70'>{_('Replace with:')}</label>
                        <input
                          className='input input-sm'
                          value={editing.replacement}
                          onChange={(e) => setEditing({ ...editing, replacement: e.target.value })}
                        />

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
                          <button className='btn btn-xs' onClick={() => startEdit(r, 'global')}>{_('Edit')}</button>
                          <button className='btn btn-xs btn-error' onClick={() => deleteRule(r.id, 'global')}>{_('Delete')}</button>
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
