import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PiArrowsClockwise } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauriAppPlatform } from '@/services/environment';
import { clearSmartAskCache } from '@/services/smartAsk/cache';
import { DEFAULT_SMART_ASK_SETTINGS } from '@/services/smartAsk/types';
import type { SmartAskProvider, SmartAskSettings } from '@/services/smartAsk/types';
import {
  SMART_ASK_PROVIDER_OPTIONS,
  getSmartAskModelsEndpoint,
  getSmartAskProviderConfig,
  normalizeSmartAskProvider,
  smartAskProviderNeedsApiKey,
  smartAskProviderSupportsApiKey,
} from '@/services/smartAsk/providers';

function normalizeSmartAskQuestionDirections(directions: string[]): string[] {
  return Array.from(new Set(directions.map((item) => item.trim()).filter(Boolean))).slice(0, 12);
}

const SmartAskSettingsPanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const smartAskSettings: SmartAskSettings = {
    ...DEFAULT_SMART_ASK_SETTINGS,
    ...settings?.smartAskSettings,
  };
  const [smartAskEnabled, setSmartAskEnabled] = useState(smartAskSettings.enabled);
  const [smartAskProvider, setSmartAskProvider] = useState<SmartAskProvider>(
    normalizeSmartAskProvider(smartAskSettings.provider),
  );
  const [smartAskBaseUrl, setSmartAskBaseUrl] = useState(smartAskSettings.baseUrl);
  const [smartAskModel, setSmartAskModel] = useState(smartAskSettings.model);
  const [smartAskApiKey, setSmartAskApiKey] = useState(smartAskSettings.apiKey);
  const [smartAskMaxChars, setSmartAskMaxChars] = useState(smartAskSettings.maxContextChars);
  const [smartAskQuestionDirections, setSmartAskQuestionDirections] = useState(
    normalizeSmartAskQuestionDirections(smartAskSettings.questionDirections),
  );
  const [smartAskQuestionDirectionDraft, setSmartAskQuestionDirectionDraft] = useState('');
  const [smartAskCacheEnabled, setSmartAskCacheEnabled] = useState(smartAskSettings.cacheEnabled);
  const [smartAskCacheTtl, setSmartAskCacheTtl] = useState(smartAskSettings.cacheTtlMinutes);
  const [smartAskModels, setSmartAskModels] = useState<string[]>([]);
  const [fetchingSmartAskModels, setFetchingSmartAskModels] = useState(false);

  const isMounted = useRef(false);
  const settingsRef = useRef(settings);
  const smartAskProviderConfig = getSmartAskProviderConfig(smartAskProvider);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    isMounted.current = true;
  }, []);

  const saveSmartAskSettingsPatch = useCallback(
    async (patch: Partial<SmartAskSettings>) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const current: SmartAskSettings = {
        ...DEFAULT_SMART_ASK_SETTINGS,
        ...currentSettings.smartAskSettings,
      };
      const newSmartAskSettings: SmartAskSettings = { ...current, ...patch };
      const newSettings = { ...currentSettings, smartAskSettings: newSmartAskSettings };
      settingsRef.current = newSettings;
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
    },
    [envConfig, setSettings, saveSettings],
  );

  const saveSmartAskSetting = useCallback(
    async (key: keyof SmartAskSettings, value: SmartAskSettings[keyof SmartAskSettings]) => {
      await saveSmartAskSettingsPatch({ [key]: value });
    },
    [saveSmartAskSettingsPatch],
  );

  const fetchSmartAskModels = useCallback(async () => {
    if (!smartAskBaseUrl || !smartAskEnabled) return;
    setFetchingSmartAskModels(true);
    try {
      const providerConfig = getSmartAskProviderConfig(smartAskProvider);
      const targetUrl = getSmartAskModelsEndpoint({
        ...DEFAULT_SMART_ASK_SETTINGS,
        provider: smartAskProvider,
        baseUrl: smartAskBaseUrl,
        model: smartAskModel,
        apiKey: smartAskApiKey,
      });
      let fetchUrl = targetUrl;
      const fetchHeaders: Record<string, string> = {};
      const apiKey = smartAskProviderSupportsApiKey(smartAskProvider) ? smartAskApiKey : '';
      let fetchInit: RequestInit | undefined;
      if (!isTauriAppPlatform()) {
        fetchUrl = '/api/smartask/models';
        fetchInit = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: targetUrl, apiKey: apiKey || undefined }),
        };
      } else if (apiKey) {
        fetchHeaders['Authorization'] = `Bearer ${apiKey}`;
        fetchInit = { headers: fetchHeaders };
      }
      const response = await fetch(fetchUrl, fetchInit);
      if (!response.ok) throw new Error('Failed to fetch models');
      const data: unknown = await response.json();
      let models: string[] = [];
      if (providerConfig.protocol === 'ollama') {
        const d = data as { models?: { name: string }[] };
        models = d.models?.map((m) => m.name) ?? [];
      } else {
        const d = data as { data?: { id: string }[] };
        models = d.data?.map((m) => m.id) ?? [];
      }
      setSmartAskModels(models);
      if (models.length > 0 && !models.includes(smartAskModel)) {
        setSmartAskModel(models[0]!);
      }
    } catch {
      setSmartAskModels([]);
    } finally {
      setFetchingSmartAskModels(false);
    }
  }, [smartAskBaseUrl, smartAskProvider, smartAskApiKey, smartAskModel, smartAskEnabled]);

  useEffect(() => {
    if (smartAskEnabled) {
      fetchSmartAskModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartAskEnabled, smartAskProvider, smartAskBaseUrl]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (smartAskEnabled !== smartAskSettings.enabled) {
      saveSmartAskSetting('enabled', smartAskEnabled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartAskEnabled]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (smartAskProvider !== smartAskSettings.provider) {
      saveSmartAskSetting('provider', smartAskProvider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartAskProvider]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (smartAskBaseUrl !== smartAskSettings.baseUrl) {
      saveSmartAskSetting('baseUrl', smartAskBaseUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartAskBaseUrl]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (smartAskModel !== smartAskSettings.model) {
      saveSmartAskSetting('model', smartAskModel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartAskModel]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (smartAskApiKey !== smartAskSettings.apiKey) {
      saveSmartAskSetting('apiKey', smartAskApiKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartAskApiKey]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (smartAskMaxChars !== smartAskSettings.maxContextChars) {
      saveSmartAskSetting('maxContextChars', smartAskMaxChars);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartAskMaxChars]);

  useEffect(() => {
    if (!isMounted.current) return;
    const normalized = normalizeSmartAskQuestionDirections(smartAskQuestionDirections);
    const saved = normalizeSmartAskQuestionDirections(smartAskSettings.questionDirections);
    if (JSON.stringify(normalized) !== JSON.stringify(saved)) {
      saveSmartAskSetting('questionDirections', normalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartAskQuestionDirections]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (smartAskCacheEnabled !== smartAskSettings.cacheEnabled) {
      saveSmartAskSetting('cacheEnabled', smartAskCacheEnabled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartAskCacheEnabled]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (smartAskCacheTtl !== smartAskSettings.cacheTtlMinutes) {
      saveSmartAskSetting('cacheTtlMinutes', smartAskCacheTtl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartAskCacheTtl]);

  const handleSmartAskProviderChange = (value: SmartAskProvider) => {
    const nextConfig = getSmartAskProviderConfig(value);
    const nextApiKey = nextConfig.requiresApiKey || nextConfig.supportsApiKey ? smartAskApiKey : '';

    setSmartAskProvider(value);
    setSmartAskBaseUrl(nextConfig.defaultBaseUrl);
    setSmartAskModel('');
    setSmartAskModels([]);
    if (!nextApiKey) {
      setSmartAskApiKey('');
    }
    void saveSmartAskSettingsPatch({
      provider: value,
      baseUrl: nextConfig.defaultBaseUrl,
      model: '',
      apiKey: nextApiKey,
    });
  };

  const addSmartAskQuestionDirection = () => {
    const direction = smartAskQuestionDirectionDraft.trim();
    if (!direction) return;
    setSmartAskQuestionDirections((current) =>
      normalizeSmartAskQuestionDirections([...current, direction]),
    );
    setSmartAskQuestionDirectionDraft('');
  };

  const removeSmartAskQuestionDirection = (index: number) => {
    setSmartAskQuestionDirections((current) => current.filter((_, i) => i !== index));
  };

  return (
    <>
      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Inline Insight')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <span>{_('Enable Inline Insight')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={smartAskEnabled}
                onChange={() => setSmartAskEnabled((v) => !v)}
              />
            </div>
          </div>
        </div>
      </div>

      <div
        className={clsx('w-full', !smartAskEnabled && 'pointer-events-none select-none opacity-50')}
      >
        <h2 className='mb-2 font-medium'>{_('Inline Insight Provider')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <span>{_('Provider')}</span>
              <select
                className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                value={normalizeSmartAskProvider(smartAskProvider)}
                onChange={(e) => handleSmartAskProviderChange(e.target.value as SmartAskProvider)}
              >
                {SMART_ASK_PROVIDER_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <span>{_('Base URL')}</span>
              <input
                type='text'
                className='input input-bordered input-sm w-full'
                value={smartAskBaseUrl}
                onChange={(e) => setSmartAskBaseUrl(e.target.value)}
                placeholder={smartAskProviderConfig.defaultBaseUrl}
              />
            </div>
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <div className='flex w-full items-center justify-between'>
                <span>{_('Model')}</span>
                <button
                  className='btn btn-ghost btn-xs'
                  onClick={fetchSmartAskModels}
                  disabled={fetchingSmartAskModels}
                  title={_('Refresh Models')}
                >
                  <PiArrowsClockwise
                    className={clsx('size-4', fetchingSmartAskModels && 'animate-spin')}
                  />
                </button>
              </div>
              {smartAskModels.length > 0 ? (
                <select
                  className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                  value={smartAskModel}
                  onChange={(e) => setSmartAskModel(e.target.value)}
                >
                  {smartAskModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type='text'
                  className='input input-bordered input-sm w-full'
                  value={smartAskModel}
                  onChange={(e) => setSmartAskModel(e.target.value)}
                  placeholder={smartAskProviderConfig.modelPlaceholder}
                />
              )}
            </div>
            {smartAskProviderSupportsApiKey(smartAskProvider) && (
              <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                <span>
                  {smartAskProviderNeedsApiKey(smartAskProvider)
                    ? _('API Key')
                    : _('API Key (Optional)')}
                </span>
                <input
                  type='password'
                  className='input input-bordered input-sm w-full'
                  value={smartAskApiKey}
                  onChange={(e) => setSmartAskApiKey(e.target.value)}
                  placeholder='sk-...'
                />
              </div>
            )}
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <span>{_('Context Characters')}</span>
              <input
                type='number'
                className='input input-bordered input-sm w-full'
                value={smartAskMaxChars}
                min={500}
                max={3000}
                onChange={(e) => setSmartAskMaxChars(Number(e.target.value))}
              />
            </div>
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <div className='flex w-full items-center justify-between gap-2'>
                <span>{_('Question Directions')}</span>
                <span className='text-base-content/50 text-xs'>
                  {smartAskQuestionDirections.length}/12
                </span>
              </div>
              {smartAskQuestionDirections.length > 0 && (
                <div className='flex w-full flex-col gap-1'>
                  {smartAskQuestionDirections.map((direction, index) => (
                    <div
                      key={`${direction}-${index}`}
                      className='bg-base-200 flex items-center gap-2 rounded p-1.5'
                    >
                      <span className='line-clamp-2 flex-1 text-xs'>{direction}</span>
                      <button
                        type='button'
                        className='btn btn-ghost btn-xs'
                        onClick={() => removeSmartAskQuestionDirection(index)}
                      >
                        {_('Remove')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className='flex w-full gap-2'>
                <input
                  type='text'
                  className='input input-bordered input-sm flex-1'
                  value={smartAskQuestionDirectionDraft}
                  placeholder={_('e.g. explain names, translate, historical background')}
                  maxLength={120}
                  onChange={(e) => setSmartAskQuestionDirectionDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSmartAskQuestionDirection();
                    }
                  }}
                />
                <button
                  type='button'
                  className='btn btn-outline btn-sm'
                  disabled={
                    !smartAskQuestionDirectionDraft.trim() ||
                    smartAskQuestionDirections.length >= 12
                  }
                  onClick={addSmartAskQuestionDirection}
                >
                  {_('Add')}
                </button>
              </div>
            </div>
            <div className='config-item'>
              <span>{_('Cache Responses')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={smartAskCacheEnabled}
                onChange={() => setSmartAskCacheEnabled((v) => !v)}
              />
            </div>
            {smartAskCacheEnabled && (
              <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                <div className='flex w-full items-center justify-between gap-2'>
                  <span>{_('Cache TTL Minutes')}</span>
                  <button
                    type='button'
                    className='btn btn-outline btn-xs'
                    onClick={clearSmartAskCache}
                  >
                    {_('Clear Cache')}
                  </button>
                </div>
                <input
                  type='number'
                  className='input input-bordered input-sm w-full'
                  value={smartAskCacheTtl}
                  min={10}
                  max={10080}
                  onChange={(e) => setSmartAskCacheTtl(Number(e.target.value))}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default SmartAskSettingsPanel;
