import React, { useState } from 'react';
import { RiCheckLine, RiCloseLine, RiDeleteBin7Line, RiEditLine } from 'react-icons/ri';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';

const ReplacementPanel: React.FC = () => {
  const _ = useTranslation();
  const { settings, setSettings } = useSettingsStore();

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
            rules.map((r: any) =>
              editingRuleId === r.id ? (
                <div key={r.id} className='p-2 flex w-full flex-col gap-2'>
                  <div className='flex items-center gap-2'>
                    <label className='text-xs text-base-content/70 whitespace-nowrap'>{_('Selected phrase:')}</label>
                    <input
                      value={editPattern}
                      onChange={(e) => setEditPattern(e.target.value)}
                      className='input input-sm text-sm flex-1 w-full'
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
                      onClick={() => {
                        const updated = rules.map((rr: any) =>
                          rr.id === r.id ? { ...rr, pattern: editPattern, replacement: editReplacement } : rr,
                        );
                        const newSettings = { ...settings } as any;
                        newSettings.globalViewSettings = {
                          ...newSettings.globalViewSettings,
                          replacementRules: updated,
                        };
                        setSettings(newSettings);
                        setEditingRuleId(null);
                      }}
                      aria-label={_('Save')}
                    >
                      <RiCheckLine />
                    </button>
                    <button
                      className='btn btn-sm'
                      onClick={() => setEditingRuleId(null)}
                      aria-label={_('Cancel')}
                    >
                      <RiCloseLine />
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
                      onClick={() => {
                        const updated = rules.filter((rr: any) => rr.id !== r.id);
                        const newSettings = { ...settings } as any;
                        newSettings.globalViewSettings = {
                          ...newSettings.globalViewSettings,
                          replacementRules: updated,
                        };
                        setSettings(newSettings);
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
