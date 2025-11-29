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
  const [conversationalModelSlug, setConversationalModelSlug] = useState(
    settings.globalReadSettings.conversationalModelSlug || '',
  );
  const [realtimeModelSlug, setRealtimeModelSlug] = useState(
    settings.globalReadSettings.realtimeModelSlug || '',
    //aa
  );
  const [realtimeVoice, setRealtimeVoice] = useState(
    settings.globalReadSettings.realtimeVoice || '',
  );
  const [userCustomPrompt, setUserCustomPrompt] = useState(
    settings.globalReadSettings.userCustomPrompt || '',
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleReset = () => {
    setApiKey('');
    setConversationalModelSlug('');
    setRealtimeModelSlug('');
    setRealtimeVoice('');
    setUserCustomPrompt('');
    handleSaveSettings({
      openaiApiKey: '',
      conversationalModelSlug: '',
      realtimeModelSlug: '',
      realtimeVoice: '',
      userCustomPrompt: '',
    });
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveSettings = async (updates: {
    openaiApiKey?: string;
    conversationalModelSlug?: string;
    realtimeModelSlug?: string;
    realtimeVoice?: string;
    userCustomPrompt?: string;
  }) => {
    setIsSaving(true);
    try {
      const updatedGlobalReadSettings = {
        ...settings.globalReadSettings,
        ...Object.fromEntries(
          Object.entries(updates).map(([key, value]) => [key, value || undefined]),
        ),
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
      console.error('Failed to save AI settings:', error);
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
      handleSaveSettings({ openaiApiKey: apiKey });
    }
  };

  const handleConversationalModelSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setConversationalModelSlug(value);
  };

  const handleConversationalModelSlugBlur = () => {
    if (conversationalModelSlug !== (settings.globalReadSettings.conversationalModelSlug || '')) {
      handleSaveSettings({ conversationalModelSlug });
    }
  };

  const handleRealtimeModelSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setRealtimeModelSlug(value);
  };

  const handleRealtimeModelSlugBlur = () => {
    if (realtimeModelSlug !== (settings.globalReadSettings.realtimeModelSlug || '')) {
      handleSaveSettings({ realtimeModelSlug });
    }
  };

  const handleRealtimeVoiceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setRealtimeVoice(value);
  };

  const handleRealtimeVoiceBlur = () => {
    if (realtimeVoice !== (settings.globalReadSettings.realtimeVoice || '')) {
      handleSaveSettings({ realtimeVoice });
    }
  };

  const handleUserCustomPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setUserCustomPrompt(value);
  };

  const handleUserCustomPromptBlur = () => {
    if (userCustomPrompt !== (settings.globalReadSettings.userCustomPrompt || '')) {
      handleSaveSettings({ userCustomPrompt });
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
            <div className='config-item !h-auto py-4'>
              <div className='flex w-full flex-col gap-2'>
                <label className='text-sm font-medium'>{_('Conversational Model')}</label>
                <p className='text-base-content/70 text-xs'>
                  {_(
                    'Model slug for conversational chat (e.g., gpt-4o-mini, gpt-4o). Default: gpt-4o-mini',
                  )}
                </p>
                <input
                  type='text'
                  className='input input-bordered mt-2 w-full'
                  placeholder={_('gpt-4o-mini')}
                  value={conversationalModelSlug}
                  onChange={handleConversationalModelSlugChange}
                  onBlur={handleConversationalModelSlugBlur}
                  disabled={isSaving}
                />
              </div>
            </div>
            <div className='config-item !h-auto py-4'>
              <div className='flex w-full flex-col gap-2'>
                <label className='text-sm font-medium'>{_('Realtime Model')}</label>
                <p className='text-base-content/70 text-xs'>
                  {_(
                    'Model slug for realtime voice conversations (e.g., gpt-realtime). Default: gpt-realtime',
                  )}
                </p>
                <input
                  type='text'
                  className='input input-bordered mt-2 w-full'
                  placeholder={_('gpt-realtime')}
                  value={realtimeModelSlug}
                  onChange={handleRealtimeModelSlugChange}
                  onBlur={handleRealtimeModelSlugBlur}
                  disabled={isSaving}
                />
              </div>
            </div>
            <div className='config-item !h-auto py-4'>
              <div className='flex w-full flex-col gap-2'>
                <label className='text-sm font-medium'>{_('Realtime Voice')}</label>
                <p className='text-base-content/70 text-xs'>
                  {_(
                    'Voice for realtime conversationss (e.g., alloy, echo, fable, onyx, nova, shimmer, marin). Default: marin',
                  )}
                </p>
                <input
                  type='text'
                  className='input input-bordered mt-2 w-full'
                  placeholder={_('marin')}
                  value={realtimeVoice}
                  onChange={handleRealtimeVoiceChange}
                  onBlur={handleRealtimeVoiceBlur}
                  disabled={isSaving}
                />
              </div>
            </div>
            <div className='config-item !h-auto py-4'>
              <div className='flex w-full flex-col gap-2'>
                <label className='text-sm font-medium'>{_('Custom Prompt')}</label>
                <p className='text-base-content/70 text-xs'>
                  {_(
                    'Additional instructions to append to the system prompt. This will be added to the default prompt about the book snippet.',
                  )}
                </p>
                <textarea
                  className='textarea textarea-bordered mt-2 w-full'
                  placeholder={_('Enter custom instructions...')}
                  value={userCustomPrompt}
                  onChange={handleUserCustomPromptChange}
                  onBlur={handleUserCustomPromptBlur}
                  disabled={isSaving}
                  rows={4}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIPanel;
