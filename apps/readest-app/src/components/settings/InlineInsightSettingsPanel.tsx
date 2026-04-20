import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PiArrowsClockwise } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import Select from '@/components/Select';
import { isTauriAppPlatform } from '@/services/environment';
import { TRANSLATED_LANGS } from '@/services/constants';
import { clearInlineInsightCache } from '@/services/inlineInsight/cache';
import { DEFAULT_INLINE_INSIGHT_SETTINGS } from '@/services/inlineInsight/types';
import type { InlineInsightProvider, InlineInsightSettings } from '@/services/inlineInsight/types';
import { getLocale } from '@/utils/misc';
import {
  INLINE_INSIGHT_PROVIDER_OPTIONS,
  getInlineInsightModelsEndpoint,
  getInlineInsightProviderConfig,
  normalizeInlineInsightProvider,
  inlineInsightProviderNeedsApiKey,
  inlineInsightProviderSupportsApiKey,
} from '@/services/inlineInsight/providers';

function normalizeInlineInsightQuestionDirections(directions: string[]): string[] {
  return Array.from(new Set(directions.map((item) => item.trim()).filter(Boolean))).slice(0, 12);
}

function getLangOptions(langs: Record<string, string>, followLabel: string) {
  const options = Object.entries(langs).map(([value, label]) => ({ value, label }));
  options.sort((a, b) => a.label.localeCompare(b.label));
  options.unshift({ value: '', label: followLabel });
  return options;
}

const InlineInsightSettingsPanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const inlineInsightSettings: InlineInsightSettings = {
    ...DEFAULT_INLINE_INSIGHT_SETTINGS,
    ...settings?.inlineInsightSettings,
  };
  const [inlineInsightEnabled, setInlineInsightEnabled] = useState(inlineInsightSettings.enabled);
  const [inlineInsightProvider, setInlineInsightProvider] = useState<InlineInsightProvider>(
    normalizeInlineInsightProvider(inlineInsightSettings.provider),
  );
  const [inlineInsightBaseUrl, setInlineInsightBaseUrl] = useState(inlineInsightSettings.baseUrl);
  const [inlineInsightModel, setInlineInsightModel] = useState(inlineInsightSettings.model);
  const [inlineInsightApiKey, setInlineInsightApiKey] = useState(inlineInsightSettings.apiKey);
  const [inlineInsightMaxChars, setInlineInsightMaxChars] = useState(
    inlineInsightSettings.maxContextChars,
  );
  const [inlineInsightTargetLanguage, setInlineInsightTargetLanguage] = useState(
    inlineInsightSettings.targetLanguage,
  );
  const [inlineInsightQuestionDirections, setInlineInsightQuestionDirections] = useState(
    normalizeInlineInsightQuestionDirections(inlineInsightSettings.questionDirections),
  );
  const [inlineInsightQuestionDirectionDraft, setInlineInsightQuestionDirectionDraft] =
    useState('');
  const [inlineInsightCacheEnabled, setInlineInsightCacheEnabled] = useState(
    inlineInsightSettings.cacheEnabled,
  );
  const [inlineInsightCacheTtl, setInlineInsightCacheTtl] = useState(
    inlineInsightSettings.cacheTtlMinutes,
  );
  const [inlineInsightModels, setInlineInsightModels] = useState<string[]>([]);
  const [fetchingInlineInsightModels, setFetchingInlineInsightModels] = useState(false);

  const isMounted = useRef(false);
  const settingsRef = useRef(settings);
  const inlineInsightProviderConfig = getInlineInsightProviderConfig(inlineInsightProvider);
  const getCurrentUILangOption = () => {
    const uiLanguage = settings?.globalViewSettings.uiLanguage ?? '';
    return {
      value: uiLanguage,
      label:
        uiLanguage === ''
          ? getLocale()
          : TRANSLATED_LANGS[uiLanguage as keyof typeof TRANSLATED_LANGS],
    };
  };
  const getTargetLanguageOptions = () => {
    const currentUILang = getCurrentUILangOption();
    const options = getLangOptions(
      TRANSLATED_LANGS,
      `${_('Interface Language')} (${currentUILang.label})`,
    );
    if (
      inlineInsightTargetLanguage &&
      !options.some((option) => option.value === inlineInsightTargetLanguage)
    ) {
      options.push({ value: inlineInsightTargetLanguage, label: inlineInsightTargetLanguage });
    }
    return options;
  };

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    isMounted.current = true;
  }, []);

  const saveInlineInsightSettingsPatch = useCallback(
    async (patch: Partial<InlineInsightSettings>) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const current: InlineInsightSettings = {
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        ...currentSettings.inlineInsightSettings,
      };
      const newInlineInsightSettings: InlineInsightSettings = { ...current, ...patch };
      const newSettings = { ...currentSettings, inlineInsightSettings: newInlineInsightSettings };
      settingsRef.current = newSettings;
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
    },
    [envConfig, setSettings, saveSettings],
  );

  const saveInlineInsightSetting = useCallback(
    async (
      key: keyof InlineInsightSettings,
      value: InlineInsightSettings[keyof InlineInsightSettings],
    ) => {
      await saveInlineInsightSettingsPatch({ [key]: value });
    },
    [saveInlineInsightSettingsPatch],
  );

  const fetchInlineInsightModels = useCallback(async () => {
    if (!inlineInsightBaseUrl || !inlineInsightEnabled) return;
    setFetchingInlineInsightModels(true);
    try {
      const providerConfig = getInlineInsightProviderConfig(inlineInsightProvider);
      const targetUrl = getInlineInsightModelsEndpoint({
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        provider: inlineInsightProvider,
        baseUrl: inlineInsightBaseUrl,
        model: inlineInsightModel,
        apiKey: inlineInsightApiKey,
      });
      let fetchUrl = targetUrl;
      const fetchHeaders: Record<string, string> = {};
      const apiKey = inlineInsightProviderSupportsApiKey(inlineInsightProvider)
        ? inlineInsightApiKey
        : '';
      let fetchInit: RequestInit | undefined;
      if (!isTauriAppPlatform()) {
        fetchUrl = '/api/inlineinsight/models';
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
      setInlineInsightModels(models);
      if (models.length > 0 && !models.includes(inlineInsightModel)) {
        setInlineInsightModel(models[0]!);
      }
    } catch {
      setInlineInsightModels([]);
    } finally {
      setFetchingInlineInsightModels(false);
    }
  }, [
    inlineInsightBaseUrl,
    inlineInsightProvider,
    inlineInsightApiKey,
    inlineInsightModel,
    inlineInsightEnabled,
  ]);

  useEffect(() => {
    if (inlineInsightEnabled) {
      fetchInlineInsightModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineInsightEnabled, inlineInsightProvider, inlineInsightBaseUrl]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (inlineInsightEnabled !== inlineInsightSettings.enabled) {
      saveInlineInsightSetting('enabled', inlineInsightEnabled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineInsightEnabled]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (inlineInsightProvider !== inlineInsightSettings.provider) {
      saveInlineInsightSetting('provider', inlineInsightProvider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineInsightProvider]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (inlineInsightBaseUrl !== inlineInsightSettings.baseUrl) {
      saveInlineInsightSetting('baseUrl', inlineInsightBaseUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineInsightBaseUrl]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (inlineInsightModel !== inlineInsightSettings.model) {
      saveInlineInsightSetting('model', inlineInsightModel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineInsightModel]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (inlineInsightApiKey !== inlineInsightSettings.apiKey) {
      saveInlineInsightSetting('apiKey', inlineInsightApiKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineInsightApiKey]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (inlineInsightMaxChars !== inlineInsightSettings.maxContextChars) {
      saveInlineInsightSetting('maxContextChars', inlineInsightMaxChars);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineInsightMaxChars]);

  useEffect(() => {
    if (!isMounted.current) return;
    const normalized = inlineInsightTargetLanguage.trim();
    if (normalized !== inlineInsightSettings.targetLanguage) {
      saveInlineInsightSetting('targetLanguage', normalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineInsightTargetLanguage]);

  useEffect(() => {
    if (!isMounted.current) return;
    const normalized = normalizeInlineInsightQuestionDirections(inlineInsightQuestionDirections);
    const saved = normalizeInlineInsightQuestionDirections(
      inlineInsightSettings.questionDirections,
    );
    if (JSON.stringify(normalized) !== JSON.stringify(saved)) {
      saveInlineInsightSetting('questionDirections', normalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineInsightQuestionDirections]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (inlineInsightCacheEnabled !== inlineInsightSettings.cacheEnabled) {
      saveInlineInsightSetting('cacheEnabled', inlineInsightCacheEnabled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineInsightCacheEnabled]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (inlineInsightCacheTtl !== inlineInsightSettings.cacheTtlMinutes) {
      saveInlineInsightSetting('cacheTtlMinutes', inlineInsightCacheTtl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineInsightCacheTtl]);

  const handleInlineInsightProviderChange = (value: InlineInsightProvider) => {
    const nextConfig = getInlineInsightProviderConfig(value);
    const nextApiKey =
      nextConfig.requiresApiKey || nextConfig.supportsApiKey ? inlineInsightApiKey : '';

    setInlineInsightProvider(value);
    setInlineInsightBaseUrl(nextConfig.defaultBaseUrl);
    setInlineInsightModel('');
    setInlineInsightModels([]);
    if (!nextApiKey) {
      setInlineInsightApiKey('');
    }
    void saveInlineInsightSettingsPatch({
      provider: value,
      baseUrl: nextConfig.defaultBaseUrl,
      model: '',
      apiKey: nextApiKey,
    });
  };

  const addInlineInsightQuestionDirection = () => {
    const direction = inlineInsightQuestionDirectionDraft.trim();
    if (!direction) return;
    setInlineInsightQuestionDirections((current) =>
      normalizeInlineInsightQuestionDirections([...current, direction]),
    );
    setInlineInsightQuestionDirectionDraft('');
  };

  const removeInlineInsightQuestionDirection = (index: number) => {
    setInlineInsightQuestionDirections((current) => current.filter((_, i) => i !== index));
  };

  const handleSelectTargetLanguage = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setInlineInsightTargetLanguage(event.target.value);
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
                checked={inlineInsightEnabled}
                onChange={() => setInlineInsightEnabled((v) => !v)}
              />
            </div>
          </div>
        </div>
      </div>

      <div
        className={clsx(
          'w-full',
          !inlineInsightEnabled && 'pointer-events-none select-none opacity-50',
        )}
      >
        <h2 className='mb-2 font-medium'>{_('Inline Insight Provider')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <span>{_('Provider')}</span>
              <select
                className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                value={normalizeInlineInsightProvider(inlineInsightProvider)}
                onChange={(e) =>
                  handleInlineInsightProviderChange(e.target.value as InlineInsightProvider)
                }
              >
                {INLINE_INSIGHT_PROVIDER_OPTIONS.map((option) => (
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
                value={inlineInsightBaseUrl}
                onChange={(e) => setInlineInsightBaseUrl(e.target.value)}
                placeholder={inlineInsightProviderConfig.defaultBaseUrl}
              />
            </div>
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <div className='flex w-full items-center justify-between'>
                <span>{_('Model')}</span>
                <button
                  className='btn btn-ghost btn-xs'
                  onClick={fetchInlineInsightModels}
                  disabled={fetchingInlineInsightModels}
                  title={_('Refresh Models')}
                >
                  <PiArrowsClockwise
                    className={clsx('size-4', fetchingInlineInsightModels && 'animate-spin')}
                  />
                </button>
              </div>
              {inlineInsightModels.length > 0 ? (
                <select
                  className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                  value={inlineInsightModel}
                  onChange={(e) => setInlineInsightModel(e.target.value)}
                >
                  {inlineInsightModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type='text'
                  className='input input-bordered input-sm w-full'
                  value={inlineInsightModel}
                  onChange={(e) => setInlineInsightModel(e.target.value)}
                  placeholder={inlineInsightProviderConfig.modelPlaceholder}
                />
              )}
            </div>
            {inlineInsightProviderSupportsApiKey(inlineInsightProvider) && (
              <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                <span>
                  {inlineInsightProviderNeedsApiKey(inlineInsightProvider)
                    ? _('API Key')
                    : _('API Key (Optional)')}
                </span>
                <input
                  type='password'
                  className='input input-bordered input-sm w-full'
                  value={inlineInsightApiKey}
                  onChange={(e) => setInlineInsightApiKey(e.target.value)}
                  placeholder='sk-...'
                />
              </div>
            )}
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <span>{_('Context Characters')}</span>
              <input
                type='number'
                className='input input-bordered input-sm w-full'
                value={inlineInsightMaxChars}
                min={500}
                max={3000}
                onChange={(e) => setInlineInsightMaxChars(Number(e.target.value))}
              />
            </div>
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <span>{_('Target Language')}</span>
              <Select
                value={inlineInsightTargetLanguage}
                onChange={handleSelectTargetLanguage}
                options={getTargetLanguageOptions()}
                className='max-w-full'
              />
              <span className='text-base-content/50 text-xs'>
                {_('Leave empty to follow the interface language.')}
              </span>
            </div>
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <div className='flex w-full items-center justify-between gap-2'>
                <span>{_('Question Directions')}</span>
                <span className='text-base-content/50 text-xs'>
                  {inlineInsightQuestionDirections.length}/12
                </span>
              </div>
              {inlineInsightQuestionDirections.length > 0 && (
                <div className='flex w-full flex-col gap-1'>
                  {inlineInsightQuestionDirections.map((direction, index) => (
                    <div
                      key={`${direction}-${index}`}
                      className='bg-base-200 flex items-center gap-2 rounded p-1.5'
                    >
                      <span className='line-clamp-2 flex-1 text-xs'>{direction}</span>
                      <button
                        type='button'
                        className='btn btn-ghost btn-xs'
                        onClick={() => removeInlineInsightQuestionDirection(index)}
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
                  value={inlineInsightQuestionDirectionDraft}
                  placeholder={_('e.g. explain names, translate, historical background')}
                  maxLength={120}
                  onChange={(e) => setInlineInsightQuestionDirectionDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addInlineInsightQuestionDirection();
                    }
                  }}
                />
                <button
                  type='button'
                  className='btn btn-outline btn-sm'
                  disabled={
                    !inlineInsightQuestionDirectionDraft.trim() ||
                    inlineInsightQuestionDirections.length >= 12
                  }
                  onClick={addInlineInsightQuestionDirection}
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
                checked={inlineInsightCacheEnabled}
                onChange={() => setInlineInsightCacheEnabled((v) => !v)}
              />
            </div>
            {inlineInsightCacheEnabled && (
              <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                <div className='flex w-full items-center justify-between gap-2'>
                  <span>{_('Cache TTL Minutes')}</span>
                  <button
                    type='button'
                    className='btn btn-outline btn-xs'
                    onClick={clearInlineInsightCache}
                  >
                    {_('Clear Cache')}
                  </button>
                </div>
                <input
                  type='number'
                  className='input input-bordered input-sm w-full'
                  value={inlineInsightCacheTtl}
                  min={10}
                  max={10080}
                  onChange={(e) => setInlineInsightCacheTtl(Number(e.target.value))}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default InlineInsightSettingsPanel;
