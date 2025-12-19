import clsx from 'clsx';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PiCheckCircle, PiWarningCircle, PiArrowsClockwise } from 'react-icons/pi';
import { Ollama } from 'ollama/browser';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { getAIProvider } from '@/services/ai/providers';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings, AIProviderName } from '@/services/ai/types';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

const AIPanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const aiSettings: AISettings = settings?.aiSettings ?? DEFAULT_AI_SETTINGS;

  const [enabled, setEnabled] = useState(aiSettings.enabled);
  const [provider, setProvider] = useState<AIProviderName>(aiSettings.provider);
  const [ollamaUrl, setOllamaUrl] = useState(aiSettings.ollamaBaseUrl);
  const [ollamaModel, setOllamaModel] = useState(aiSettings.ollamaModel);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [openrouterKey, setOpenrouterKey] = useState(aiSettings.openrouterApiKey ?? '');
  const [openrouterModel, setOpenrouterModel] = useState(
    aiSettings.openrouterModel ?? DEFAULT_AI_SETTINGS.openrouterModel ?? '',
  );
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const isMounted = useRef(false);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const saveAiSetting = useCallback(
    async (key: keyof AISettings, value: AISettings[keyof AISettings]) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const currentAiSettings: AISettings = currentSettings.aiSettings ?? DEFAULT_AI_SETTINGS;
      const newAiSettings: AISettings = { ...currentAiSettings, [key]: value };
      const newSettings = { ...currentSettings, aiSettings: newAiSettings };

      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
    },
    [envConfig, setSettings, saveSettings],
  );

  const fetchOllamaModels = useCallback(async () => {
    if (!ollamaUrl || !enabled) return;

    setFetchingModels(true);
    try {
      const client = new Ollama({ host: ollamaUrl });
      const list = await client.list();
      const models = list.models.map((m) => m.name);

      setOllamaModels(models);
      if (models.length > 0 && !models.includes(ollamaModel)) {
        setOllamaModel(models[0]!);
      }
    } catch (err) {
      setOllamaModels([]);
    } finally {
      setFetchingModels(false);
    }
  }, [ollamaUrl, ollamaModel, enabled]);

  useEffect(() => {
    if (provider === 'ollama' && enabled) {
      fetchOllamaModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, enabled, ollamaUrl]);

  useEffect(() => {
    isMounted.current = true;
  }, []);

  useEffect(() => {
    if (!isMounted.current) return;
    if (enabled !== aiSettings.enabled) {
      saveAiSetting('enabled', enabled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (provider !== aiSettings.provider) {
      saveAiSetting('provider', provider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (ollamaUrl !== aiSettings.ollamaBaseUrl) {
      saveAiSetting('ollamaBaseUrl', ollamaUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ollamaUrl]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (ollamaModel !== aiSettings.ollamaModel) {
      saveAiSetting('ollamaModel', ollamaModel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ollamaModel]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (openrouterKey !== (aiSettings.openrouterApiKey ?? '')) {
      saveAiSetting('openrouterApiKey', openrouterKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openrouterKey]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (openrouterModel !== aiSettings.openrouterModel) {
      saveAiSetting('openrouterModel', openrouterModel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openrouterModel]);

  const handleTestConnection = async () => {
    if (!enabled) return;
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
      } else {
        setConnectionStatus('error');
        setErrorMessage(
          provider === 'ollama'
            ? _("Couldn't connect to Ollama. Is it running?")
            : _('Invalid API key or connection failed'),
        );
      }
    } catch (error) {
      setConnectionStatus('error');
      setErrorMessage((error as Error).message || _('Connection failed'));
    }
  };

  // greyed out styles when disabled
  const disabledSection = !enabled ? 'opacity-50 pointer-events-none select-none' : '';

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('AI Assistant')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <span>{_('Enable AI Assistant')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={enabled}
                onChange={() => setEnabled(!enabled)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={clsx('w-full', disabledSection)}>
        <h2 className='mb-2 font-medium'>{_('Provider')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <span>{_('Ollama (Local)')}</span>
              <input
                type='radio'
                name='ai-provider'
                className='radio'
                checked={provider === 'ollama'}
                onChange={() => setProvider('ollama')}
                disabled={!enabled}
              />
            </div>
            <div className='config-item'>
              <span>{_('OpenRouter (Cloud)')}</span>
              <input
                type='radio'
                name='ai-provider'
                className='radio'
                checked={provider === 'openrouter'}
                onChange={() => setProvider('openrouter')}
                disabled={!enabled}
              />
            </div>
          </div>
        </div>
      </div>

      {provider === 'ollama' && (
        <div className={clsx('w-full', disabledSection)}>
          <h2 className='mb-2 font-medium'>{_('Ollama Configuration')}</h2>
          <div className='card border-base-200 bg-base-100 border shadow'>
            <div className='divide-base-200 divide-y'>
              <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                <div className='flex w-full items-center justify-between'>
                  <span>{_('Server URL')}</span>
                  <button
                    className='btn btn-ghost btn-xs'
                    onClick={fetchOllamaModels}
                    disabled={!enabled || fetchingModels}
                    title={_('Refresh Models')}
                  >
                    <PiArrowsClockwise className='size-4' />
                  </button>
                </div>
                <input
                  type='text'
                  className='input input-bordered input-sm w-full'
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder='http://127.0.0.1:11434'
                  disabled={!enabled}
                />
              </div>
              {ollamaModels.length > 0 ? (
                <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                  <span>{_('AI Model')}</span>
                  <select
                    className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    disabled={!enabled}
                  >
                    {ollamaModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
              ) : !fetchingModels ? (
                <div className='config-item'>
                  <span className='text-warning text-sm'>{_('No models detected')}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {provider === 'openrouter' && (
        <div className={clsx('w-full', disabledSection)}>
          <h2 className='mb-2 font-medium'>{_('OpenRouter Configuration')}</h2>
          <div className='card border-base-200 bg-base-100 border shadow'>
            <div className='divide-base-200 divide-y'>
              <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                <div className='flex w-full items-center justify-between'>
                  <span>{_('API Key')}</span>
                  <a
                    href='https://openrouter.ai/keys'
                    target='_blank'
                    rel='noopener noreferrer'
                    className={clsx('link text-xs', !enabled && 'pointer-events-none')}
                  >
                    {_('Get Key')}
                  </a>
                </div>
                <input
                  type='password'
                  className='input input-bordered input-sm w-full'
                  value={openrouterKey}
                  onChange={(e) => setOpenrouterKey(e.target.value)}
                  placeholder='sk-or-...'
                  disabled={!enabled}
                />
              </div>
              <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                <div className='flex w-full items-center justify-between'>
                  <span>{_('Model')}</span>
                  <a
                    href='https://openrouter.ai/models'
                    target='_blank'
                    rel='noopener noreferrer'
                    className={clsx('link text-xs', !enabled && 'pointer-events-none')}
                  >
                    {_('Browse Models')}
                  </a>
                </div>
                <input
                  type='text'
                  className='input input-bordered input-sm w-full'
                  value={openrouterModel}
                  onChange={(e) => setOpenrouterModel(e.target.value)}
                  placeholder='anthropic/claude-sonnet-4.5'
                  disabled={!enabled}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={clsx('w-full', disabledSection)}>
        <h2 className='mb-2 font-medium'>{_('Connection')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <button
                className='btn btn-outline btn-sm'
                onClick={handleTestConnection}
                disabled={!enabled || connectionStatus === 'testing'}
              >
                {_('Test Connection')}
              </button>
              {connectionStatus === 'success' && (
                <span className='text-success flex items-center gap-1 text-sm'>
                  <PiCheckCircle />
                  {_('Connected')}
                </span>
              )}
              {connectionStatus === 'error' && (
                <span className='text-error flex items-center gap-1 text-sm'>
                  <PiWarningCircle />
                  {errorMessage || _('Failed')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIPanel;
