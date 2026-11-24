import React from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import type { ObsidianSettings } from '@/types/settings';
import { requestStoragePermission } from '@/utils/permission';
import SubPageHeader from '../SubPageHeader';
import { BoxedList, SettingsRow, SettingsSwitchRow, Tips } from '../primitives';

interface ObsidianFormProps {
  onBack: () => void;
}

const ObsidianForm: React.FC<ObsidianFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const obsidian = settings.obsidian;

  const save = async (patch: Partial<ObsidianSettings>) => {
    const latest = useSettingsStore.getState().settings;
    const newSettings = { ...latest, obsidian: { ...latest.obsidian, ...patch } };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  };

  const chooseFolder = async () => {
    if (!appService) return;
    if (appService.isAndroidApp && !(await requestStoragePermission())) return;
    const folder = await appService.selectDirectory('write');
    if (folder) await save({ folder, enabled: true });
  };

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Obsidian')}
        description={_('Keep a note for each book in your Obsidian vault with its highlights.')}
        onBack={onBack}
      />
      <div className='space-y-5'>
        <BoxedList>
          <SettingsRow
            label={_('Vault Folder')}
            description={obsidian?.folder || _('Not set')}
            asLabel={false}
          >
            <button
              type='button'
              onClick={chooseFolder}
              className='btn btn-ghost btn-sm eink-bordered shrink-0'
            >
              {_('Choose Folder')}
            </button>
          </SettingsRow>
          <SettingsSwitchRow
            label={_('Sync Highlights')}
            checked={!!obsidian?.enabled}
            disabled={!obsidian?.folder}
            onChange={() => save({ enabled: !obsidian?.enabled })}
          />
        </BoxedList>
        <Tips>
          <li>{_('Choose a folder inside your vault, such as Readest.')}</li>
          <li>{_('A book is synced when you open it and whenever its notes change.')}</li>
          <li>
            {_(
              'Text you write in a book note is kept. A highlight you edit or delete there is left as you made it.',
            )}
          </li>
        </Tips>
      </div>
    </div>
  );
};

export default ObsidianForm;
