import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { SettingsPanelPanelProp } from './SettingsDialog';

const AIPanel: React.FC<SettingsPanelPanelProp> = ({ onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings } = useSettingsStore();
  const [apiKey, setApiKey] = useState(settings.globalReadSettings.openaiApiKey || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleReset = () => {
    setApiKey('');
    handleSave('');
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (value: string) => {
    setIsSaving(true);
    try {
      const updatedGlobalReadSettings = {
        ...settings.globalReadSettings,
        openaiApiKey: value || undefined,
      };
      const updatedSettings = {
        ...settings,
        globalReadSettings: updatedGlobalReadSettings,
      };
      setSettings(updatedSettings);
      // Use saveSettings directly since we're updating nested property
      const { saveSettings } = useSettingsStore.getState();
      await saveSettings(envConfig, updatedSettings);
    } catch (error) {
      console.error('Failed to save OpenAI API key:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setApiKey(value);
  };

  const handleApiKeyBlur = () => {
    if (apiKey !== (settings.globalReadSettings.openaiApiKey || '')) {
      handleSave(apiKey);
    }
  };

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('AI Chat')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item !h-auto py-4'>
              <div className='flex w-full flex-col gap-2'>
                <label className='text-sm font-medium'>{_('OpenAI API Key')}</label>
                <p className='text-base-content/70 text-xs'>
                  {_(
                    'Enter your OpenAI API key to enable AI chat features. Your key is stored locally and never shared.',
                  )}
                </p>
                <input
                  type='password'
                  className='input input-bordered mt-2 w-full'
                  placeholder={_('sk-...')}
                  value={apiKey}
                  onChange={handleApiKeyChange}
                  onBlur={handleApiKeyBlur}
                  disabled={isSaving}
                />
                {apiKey && <p className='text-success mt-1 text-xs'>{_('API key saved')}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIPanel;
