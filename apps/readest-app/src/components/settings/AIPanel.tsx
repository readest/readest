import clsx from 'clsx';
import React, { useState, useEffect, useCallback } from 'react';
import { PiCheckCircle, PiWarningCircle, PiArrowsClockwise } from 'react-icons/pi';
import { Ollama } from 'ollama/browser';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { getAIProvider } from '@/services/ai/providers';
import { DEFAULT_AI_SETTINGS, OPENROUTER_MODELS } from '@/services/ai/constants';
import type { AISettings, AIProviderName } from '@/services/ai/types';
import { saveSysSettings } from '@/helpers/settings';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

const AIPanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings } = useSettingsStore();

  const aiSettings = settings.aiSettings || DEFAULT_AI_SETTINGS;

  const [enabled, setEnabled] = useState(aiSettings.enabled);
  const [provider, setProvider] = useState<AIProviderName>(aiSettings.provider);
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

  const saveAiSettings = useCallback(
    (key: keyof AISettings, value: AISettings[keyof AISettings]) => {
      const newAiSettings: AISettings = { ...aiSettings, [key]: value };
      const newSettings = { ...settings, aiSettings: newAiSettings };
      setSettings(newSettings);
      saveSysSettings(envConfig, 'aiSettings', newAiSettings);
    },
    [aiSettings, envConfig, settings, setSettings],
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
    } catch {
      setOllamaModels([]);
    } finally {
      setFetchingModels(false);
    }
  }, [ollamaUrl, ollamaModel, enabled]);

  useEffect(() => {
    if (provider === 'ollama' && enabled) {
      fetchOllamaModels();
    }
  }, [provider, enabled, ollamaUrl]);

  useEffect(() => {
    if (enabled !== aiSettings.enabled) {
      saveAiSettings('enabled', enabled);
    }
  }, [enabled]);

  useEffect(() => {
    if (provider !== aiSettings.provider) {
      saveAiSettings('provider', provider);
    }
  }, [provider]);

  useEffect(() => {
    if (ollamaUrl !== aiSettings.ollamaBaseUrl) {
      saveAiSettings('ollamaBaseUrl', ollamaUrl);
    }
  }, [ollamaUrl]);

  useEffect(() => {
    if (ollamaModel !== aiSettings.ollamaModel && ollamaModels.includes(ollamaModel)) {
      saveAiSettings('ollamaModel', ollamaModel);
    }
  }, [ollamaModel, ollamaModels]);

  useEffect(() => {
    if (openrouterKey !== (aiSettings.openrouterApiKey || '')) {
      saveAiSettings('openrouterApiKey', openrouterKey);
    }
  }, [openrouterKey]);

  useEffect(() => {
    if (openrouterModel !== aiSettings.openrouterModel) {
      saveAiSettings('openrouterModel', openrouterModel);
    }
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
            ? _('Could not connect to Ollama. Is it running?')
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
                <span>{_('Model')}</span>
                <select
                  className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                  value={openrouterModel}
                  onChange={(e) => setOpenrouterModel(e.target.value)}
                  disabled={!enabled}
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
