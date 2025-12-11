import React, { useState } from 'react';
import { RiDeleteBin7Line, RiEditLine } from 'react-icons/ri';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useReaderStore } from '@/store/readerStore';
import environmentConfig from '@/services/environment';
import { updateReplacementRule, removeReplacementRule } from '@/services/transformers/replacement';
import { eventDispatcher } from '@/utils/event';
import { ReplacementRule } from '@/types/book';

const ReplacementPanel: React.FC = () => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { sideBarBookKey } = useSidebarStore();

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editPattern, setEditPattern] = useState('');
  const [editReplacement, setEditReplacement] = useState('');

  const rules = settings?.globalViewSettings?.replacementRules || [];

  return (
    <div className='my-4 w-full'>
      <h2 className='mb-2 font-medium'>{_('Global Replacement Rules')}</h2>
      <div className='card border-base-200 border shadow'>
        <div className='divide-base-200 divide-y'>
          {rules.length === 0 ? (
            <div className='p-4 text-sm text-base-content/70'>
              {_('No global replacement rules')}
            </div>
          ) : (
            rules.map((r: ReplacementRule) =>
              editingRuleId === r.id ? (
                <div key={r.id} className='p-2 flex w-full flex-col gap-2'>
                  <div className='flex items-center gap-2'>
                    <label className='text-xs text-base-content/70 whitespace-nowrap'>{_('Selected phrase:')}</label>
                    <input
                      value={editPattern}
                      disabled
                      className='input input-sm text-sm flex-1 w-full opacity-60'
                      placeholder={_('Pattern')}
                    />
                  </div>
                  <div className='flex items-center gap-2'>
                    <label className='text-xs text-base-content/70 whitespace-nowrap'>{_('Replace with:')}</label>
                    <input
                      value={editReplacement}
                      onChange={(e) => setEditReplacement(e.target.value)}
                      className='input input-sm flex-1 w-full'
                      placeholder={_('Replacement')}
                    />
                  </div>
                  <div className='flex gap-2'>
                    <button
                      className='btn btn-sm btn-primary'
                      onClick={async () => {
                        try {
                          await updateReplacementRule(environmentConfig, '', r.id, {
                            pattern: editPattern,
                            replacement: editReplacement,
                            enabled: true,
                          }, 'global');
                          setEditingRuleId(null);
                          eventDispatcher.dispatch('toast', {
                            type: 'success',
                            message: _('Replacement rule updated. Reloading book to apply changes...'),
                            timeout: 3000,
                          });
                          if (sideBarBookKey) {
                            const { recreateViewer } = useReaderStore.getState();
                            await recreateViewer(environmentConfig, sideBarBookKey);
                          }
                        } catch (err) {
                          console.error('Failed to save replacement rule', err);
                          eventDispatcher.dispatch('toast', {
                            type: 'error',
                            message: _('Failed to update replacement rule'),
                            timeout: 3000,
                          });
                        }
                      }}
                    >
                      {_('Save')}
                    </button>
                    <button
                      className='btn btn-sm'
                      onClick={() => setEditingRuleId(null)}
                    >
                      {_('Cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div key={r.id} className='p-2 flex w-full items-start justify-between'>
                  <div className='min-w-0'>
                    <div className='font-medium text-sm truncate'>{r.pattern}</div>
                    <div className='text-xs text-base-content/70 break-all'>{r.replacement}</div>
                  </div>
                  <div className='flex items-center gap-2 ml-4'>
                    <button
                      className='btn btn-ghost btn-sm p-1'
                      onClick={() => {
                        setEditingRuleId(r.id);
                        setEditPattern(r.pattern || '');
                        setEditReplacement(r.replacement || '');
                      }}
                      aria-label={_('Edit')}
                    >
                      <RiEditLine />
                    </button>
                    <button
                      className='btn btn-ghost btn-sm p-1'
                      onClick={async () => {
                        try {
                          await removeReplacementRule(environmentConfig, '', r.id, 'global');
                          eventDispatcher.dispatch('toast', {
                            type: 'success',
                            message: _('Replacement rule deleted. Reloading library to apply changes...'),
                            timeout: 3000,
                          });
                          if (sideBarBookKey) {
                            const { recreateViewer } = useReaderStore.getState();
                            await recreateViewer(environmentConfig, sideBarBookKey);
                          }
                        } catch (err) {
                          console.error('Failed to delete replacement rule', err);
                          eventDispatcher.dispatch('toast', {
                            type: 'error',
                            message: _('Failed to delete replacement rule'),
                            timeout: 3000,
                          });
                        }
                      }}
                      aria-label={_('Delete')}
                    >
                      <RiDeleteBin7Line />
                    </button>
                  </div>
                </div>
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default ReplacementPanel;
