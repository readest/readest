import clsx from 'clsx';
import React, { useState, useEffect, useCallback } from 'react';
import { PiCheckCircle, PiWarningCircle, PiSpinner, PiArrowsClockwise } from 'react-icons/pi';
import { Ollama } from 'ollama/browser';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { getAIProvider } from '@/services/ai/providers';
import { DEFAULT_AI_SETTINGS, OPENROUTER_MODELS } from '@/services/ai/constants';
import type { AISettings, AIProviderName } from '@/services/ai/types';
import { saveSysSettings } from '@/helpers/settings';

interface AIPanelProps {
  onClose?: () => void;
}

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

const AIPanel: React.FC<AIPanelProps> = ({ onClose }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings } = useSettingsStore();

  const aiSettings = settings.aiSettings || DEFAULT_AI_SETTINGS;

  const [provider, setProvider] = useState<AIProviderName>(aiSettings.provider);
  const [enabled, setEnabled] = useState(aiSettings.enabled);

  const [ollamaUrl, setOllamaUrl] = useState(aiSettings.ollamaBaseUrl);
  const [ollamaModel, setOllamaModel] = useState(aiSettings.ollamaModel);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const [openrouterKey, setOpenrouterKey] = useState(aiSettings.openrouterApiKey || '');
  const [openrouterModel, setOpenrouterModel] = useState(
    aiSettings.openrouterModel || OPENROUTER_MODELS.CLAUDE_SONNET,
  );

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const updateSettings = useCallback(
    (updates: Partial<AISettings>) => {
      const newAiSettings: AISettings = {
        ...aiSettings,
        ...updates,
      };
      const newSettings = { ...settings, aiSettings: newAiSettings };
      setSettings(newSettings);
      saveSysSettings(envConfig, 'aiSettings', newAiSettings);
    },
    [aiSettings, envConfig, settings, setSettings],
  );

  const fetchOllamaModels = useCallback(async () => {
    if (!ollamaUrl) return;
    setFetchingModels(true);
    try {
      const client = new Ollama({ host: ollamaUrl });
      const list = await client.list();
      setOllamaModels(list.models.map((m) => m.name));
    } catch {
      setOllamaModels([]);
    } finally {
      setFetchingModels(false);
    }
  }, [ollamaUrl]);

  useEffect(() => {
    if (provider === 'ollama' && enabled) {
      fetchOllamaModels();
    }
  }, [provider, enabled, fetchOllamaModels]);

  const handleProviderChange = (newProvider: AIProviderName) => {
    setProvider(newProvider);
    updateSettings({ provider: newProvider });
  };

  const handleEnabledChange = (newEnabled: boolean) => {
    setEnabled(newEnabled);
    updateSettings({ enabled: newEnabled });
  };

  const handleTestConnection = async () => {
    setConnectionStatus('testing');
    setErrorMessage('');

    try {
      const testSettings: AISettings = {
        ...aiSettings,
        provider,
        ollamaBaseUrl: ollamaUrl,
        ollamaModel,
        openrouterApiKey: openrouterKey,
        openrouterModel,
      };

      const aiProvider = getAIProvider(testSettings);
      const isHealthy = await aiProvider.healthCheck();

      if (isHealthy) {
        setConnectionStatus('success');
        updateSettings({
          provider,
          ollamaBaseUrl: ollamaUrl,
          ollamaModel,
          openrouterApiKey: openrouterKey,
          openrouterModel,
        });
      } else {
        setConnectionStatus('error');
        setErrorMessage(
          provider === 'ollama'
            ? _('Could not connect to Ollama. Is it running?')
            : _('Invalid API key or connection failed'),
        );
      }
    } catch (error) {
      setConnectionStatus('error');
      setErrorMessage((error as Error).message || _('Connection failed'));
    }
  };

  const handleSave = () => {
    updateSettings({
      enabled,
      provider,
      ollamaBaseUrl: ollamaUrl,
      ollamaModel,
      openrouterApiKey: openrouterKey,
      openrouterModel,
    });
    onClose?.();
  };

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='flex items-center justify-between'>
        <h2 className='font-medium'>{_('AI Assistant')}</h2>
        <input
          type='checkbox'
          className='toggle toggle-primary'
          checked={enabled}
          onChange={(e) => handleEnabledChange(e.target.checked)}
        />
      </div>

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Provider')}</h2>
        <div className='card border-base-200 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='flex p-4'>
              <button
                className={clsx(
                  'btn btn-sm flex-1',
                  provider === 'ollama' ? 'btn-primary' : 'btn-ghost',
                )}
                onClick={() => handleProviderChange('ollama')}
              >
                {_('Ollama (Local)')}
              </button>
              <button
                className={clsx(
                  'btn btn-sm flex-1',
                  provider === 'openrouter' ? 'btn-primary' : 'btn-ghost',
                )}
                onClick={() => handleProviderChange('openrouter')}
              >
                {_('OpenRouter (Cloud)')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {enabled && provider === 'ollama' && (
        <div className='w-full'>
          <h2 className='mb-2 font-medium'>{_('Ollama Configuration')}</h2>
          <div className='card border-base-200 border shadow'>
            <div className='divide-base-200 divide-y'>
              <div className='p-4'>
                <label className='label pt-0'>
                  <span className='label-text'>{_('Ollama URL')}</span>
                </label>
                <div className='flex gap-2'>
                  <input
                    type='text'
                    className='input input-bordered w-full'
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    placeholder='http://127.0.0.1:11434'
                  />
                  <button
                    className='btn btn-square btn-outline'
                    onClick={fetchOllamaModels}
                    disabled={fetchingModels}
                    title={_('Refresh Models')}
                  >
                    <PiArrowsClockwise className={clsx(fetchingModels && 'animate-spin')} />
                  </button>
                </div>
              </div>

              {ollamaModels.length > 0 && (
                <div className='p-4'>
                  <label className='label pt-0'>
                    <span className='label-text'>{_('Chat Model')}</span>
                  </label>
                  <select
                    className='select select-bordered w-full'
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                  >
                    {ollamaModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
          {ollamaModels.length === 0 && !fetchingModels && (
            <div className='text-warning px-1 text-sm'>
              {_('No models detected. Ensure Ollama is running.')}
            </div>
          )}
        </div>
      )}

      {enabled && provider === 'openrouter' && (
        <div className='w-full'>
          <h2 className='mb-2 font-medium'>{_('OpenRouter Configuration')}</h2>
          <div className='card border-base-200 border shadow'>
            <div className='divide-base-200 divide-y'>
              <div className='p-4'>
                <label className='label pt-0'>
                  <span className='label-text'>{_('API Key')}</span>
                </label>
                <input
                  type='password'
                  className='input input-bordered w-full'
                  value={openrouterKey}
                  onChange={(e) => setOpenrouterKey(e.target.value)}
                  placeholder='sk-or-...'
                />
                <label className='label pb-0'>
                  <span className='label-text-alt text-base-content/60'>
                    <a
                      href='https://openrouter.ai/keys'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='link'
                    >
                      {_('Get API Key')}
                    </a>
                  </span>
                </label>
              </div>

              <div className='p-4'>
                <label className='label pt-0'>
                  <span className='label-text'>{_('Model')}</span>
                </label>
                <select
                  className='select select-bordered w-full'
                  value={openrouterModel}
                  onChange={(e) => setOpenrouterModel(e.target.value)}
                >
                  {Object.entries(OPENROUTER_MODELS).map(([key, value]) => (
                    <option key={key} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {enabled && (
        <div className='w-full'>
          <h2 className='mb-2 font-medium'>{_('Connection')}</h2>
          <div className='card border-base-200 border shadow'>
            <div className='flex items-center gap-4 p-4'>
              <button
                className={clsx(
                  'btn btn-outline btn-sm',
                  connectionStatus === 'testing' && 'loading',
                )}
                onClick={handleTestConnection}
                disabled={connectionStatus === 'testing'}
              >
                {connectionStatus === 'testing' ? (
                  <>
                    <PiSpinner className='animate-spin' />
                    {_('Testing...')}
                  </>
                ) : (
                  _('Test Connection')
                )}
              </button>

              {connectionStatus === 'success' && (
                <span className='text-success flex items-center gap-1 text-sm font-medium'>
                  <PiCheckCircle />
                  {_('Connected!')}
                </span>
              )}

              {connectionStatus === 'error' && (
                <span className='text-error flex items-center gap-1 text-sm font-medium'>
                  <PiWarningCircle />
                  {errorMessage}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className='flex justify-end gap-2 pt-4'>
        {onClose && (
          <button className='btn btn-ghost btn-sm' onClick={onClose}>
            {_('Cancel')}
          </button>
        )}
        <button className='btn btn-primary btn-sm' onClick={handleSave}>
          {_('Save')}
        </button>
      </div>
    </div>
  );
};

export default AIPanel;
