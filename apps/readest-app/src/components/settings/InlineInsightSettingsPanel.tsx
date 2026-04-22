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
import { SYSTEM_PROMPT } from '@/services/inlineInsight/client';
import { DEFAULT_INLINE_INSIGHT_SETTINGS } from '@/services/inlineInsight/types';
import type {
  InlineInsightProvider,
  InlineInsightProviderProfile,
  InlineInsightSettings,
} from '@/services/inlineInsight/types';
import { getLocale } from '@/utils/misc';
import {
  INLINE_INSIGHT_PROVIDER_OPTIONS,
  getInlineInsightModelsEndpoint,
  getInlineInsightProviderConfig,
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

function getInlineInsightProviderProfile(
  settings: InlineInsightSettings,
  provider: InlineInsightProvider,
): InlineInsightProviderProfile {
  const providerConfig = getInlineInsightProviderConfig(provider);
  const fallback =
    settings.provider === provider
      ? {
          baseUrl: settings.baseUrl,
          model: settings.model,
          apiKey: settings.apiKey,
        }
      : {
          baseUrl: providerConfig.defaultBaseUrl,
          model: '',
          apiKey: '',
        };

  return {
    ...fallback,
    ...settings.providerProfiles[provider],
  };
}

const InlineInsightSettingsPanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const panelSettings: InlineInsightSettings = {
    ...DEFAULT_INLINE_INSIGHT_SETTINGS,
    ...settings?.inlineInsightSettings,
  };
  const [enabled, setEnabled] = useState(panelSettings.enabled);
  const [provider, setProvider] = useState<InlineInsightProvider>(panelSettings.provider);
  const currentProviderProfile = getInlineInsightProviderProfile(panelSettings, provider);
  const [baseUrl, setBaseUrl] = useState(currentProviderProfile.baseUrl);
  const [model, setModel] = useState(currentProviderProfile.model);
  const [apiKey, setApiKey] = useState(currentProviderProfile.apiKey);
  const [maxChars, setMaxChars] = useState(panelSettings.maxContextChars);
  const [targetLanguage, setTargetLanguage] = useState(panelSettings.targetLanguage);
  const [systemPrompt, setSystemPrompt] = useState(panelSettings.systemPrompt);
  const [questionDirections, setQuestionDirections] = useState(
    normalizeInlineInsightQuestionDirections(panelSettings.questionDirections),
  );
  const [questionDirectionDraft, setQuestionDirectionDraft] = useState('');
  const [cacheEnabled, setCacheEnabled] = useState(panelSettings.cacheEnabled);
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const isMounted = useRef(false);
  const settingsRef = useRef(settings);
  const providerConfig = getInlineInsightProviderConfig(provider);
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
    if (targetLanguage && !options.some((option) => option.value === targetLanguage)) {
      options.push({ value: targetLanguage, label: targetLanguage });
    }
    return options;
  };

  useEffect(() => {
    // Effects below save incremental field changes. Keep a ref to the latest settings so
    // asynchronous saves always merge against the newest snapshot.
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    isMounted.current = true;
  }, []);

  const saveSettingsPatch = useCallback(
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

  const saveSetting = useCallback(
    async (
      key: keyof InlineInsightSettings,
      value: InlineInsightSettings[keyof InlineInsightSettings],
    ) => {
      await saveSettingsPatch({ [key]: value });
    },
    [saveSettingsPatch],
  );

  const saveProviderProfileField = useCallback(
    async (
      key: keyof InlineInsightProviderProfile,
      value: InlineInsightProviderProfile[keyof InlineInsightProviderProfile],
    ) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const current: InlineInsightSettings = {
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        ...currentSettings.inlineInsightSettings,
      };
      const currentProfile = getInlineInsightProviderProfile(current, provider);
      await saveSettingsPatch({
        [key]: value,
        providerProfiles: {
          ...current.providerProfiles,
          [provider]: {
            ...currentProfile,
            [key]: value,
          },
        },
      });
    },
    [provider, saveSettingsPatch],
  );

  const fetchModels = useCallback(async () => {
    if (!baseUrl || !enabled) return;
    setFetchingModels(true);
    try {
      const providerConfig = getInlineInsightProviderConfig(provider);
      const targetUrl = getInlineInsightModelsEndpoint({
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        provider,
        baseUrl,
        model,
        apiKey,
      });
      let fetchUrl = targetUrl;
      const fetchHeaders: Record<string, string> = {};
      const providerApiKey = inlineInsightProviderSupportsApiKey(provider) ? apiKey : '';
      let fetchInit: RequestInit | undefined;
      if (!isTauriAppPlatform()) {
        // Browser builds fetch through the local proxy so provider CORS policy does not
        // block model discovery.
        fetchUrl = '/api/inlineinsight/models';
        fetchInit = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: targetUrl, apiKey: providerApiKey || undefined }),
        };
      } else if (providerApiKey) {
        fetchHeaders['Authorization'] = `Bearer ${providerApiKey}`;
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
      setModels(models);
      if (models.length > 0 && !models.includes(model)) {
        setModel(models[0]!);
      }
    } catch {
      setModels([]);
    } finally {
      setFetchingModels(false);
    }
  }, [baseUrl, provider, apiKey, model, enabled]);

  useEffect(() => {
    if (enabled) {
      fetchModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, provider, baseUrl]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (enabled !== panelSettings.enabled) {
      saveSetting('enabled', enabled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (provider !== panelSettings.provider) {
      saveSetting('provider', provider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (baseUrl !== currentProviderProfile.baseUrl) {
      saveProviderProfileField('baseUrl', baseUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (model !== currentProviderProfile.model) {
      saveProviderProfileField('model', model);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (apiKey !== currentProviderProfile.apiKey) {
      saveProviderProfileField('apiKey', apiKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (maxChars !== panelSettings.maxContextChars) {
      saveSetting('maxContextChars', maxChars);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxChars]);

  useEffect(() => {
    if (!isMounted.current) return;
    const normalized = targetLanguage.trim();
    if (normalized !== panelSettings.targetLanguage) {
      saveSetting('targetLanguage', normalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLanguage]);

  useEffect(() => {
    if (!isMounted.current) return;
    const normalized = systemPrompt.trim() ? systemPrompt : '';
    if (normalized !== panelSettings.systemPrompt) {
      // Prompt edits can change the model output substantially, so invalidate previous
      // Inline Insight cache entries before saving the new prompt.
      clearInlineInsightCache();
      saveSetting('systemPrompt', normalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemPrompt]);

  useEffect(() => {
    if (!isMounted.current) return;
    const normalized = normalizeInlineInsightQuestionDirections(questionDirections);
    const saved = normalizeInlineInsightQuestionDirections(panelSettings.questionDirections);
    if (JSON.stringify(normalized) !== JSON.stringify(saved)) {
      saveSetting('questionDirections', normalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionDirections]);

  useEffect(() => {
    if (!isMounted.current) return;
    if (cacheEnabled !== panelSettings.cacheEnabled) {
      saveSetting('cacheEnabled', cacheEnabled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheEnabled]);

  const handleProviderChange = (value: InlineInsightProvider) => {
    const nextConfig = getInlineInsightProviderConfig(value);
    const currentSettings = settingsRef.current;
    const currentPanelSettings: InlineInsightSettings = {
      ...DEFAULT_INLINE_INSIGHT_SETTINGS,
      ...currentSettings?.inlineInsightSettings,
    };
    const providerProfiles = {
      ...currentPanelSettings.providerProfiles,
      [provider]: {
        baseUrl,
        model,
        apiKey,
      },
    };
    const nextProfile = {
      baseUrl: nextConfig.defaultBaseUrl,
      model: '',
      apiKey: '',
      ...providerProfiles[value],
    };
    const nextApiKey =
      nextConfig.requiresApiKey || nextConfig.supportsApiKey ? nextProfile.apiKey : '';

    setProvider(value);
    setBaseUrl(nextProfile.baseUrl);
    setModel(nextProfile.model);
    setModels([]);
    setApiKey(nextApiKey);
    void saveSettingsPatch({
      provider: value,
      baseUrl: nextProfile.baseUrl,
      model: nextProfile.model,
      apiKey: nextApiKey,
      providerProfiles,
    });
  };

  const addQuestionDirection = () => {
    const direction = questionDirectionDraft.trim();
    if (!direction) return;
    setQuestionDirections((current) =>
      normalizeInlineInsightQuestionDirections([...current, direction]),
    );
    setQuestionDirectionDraft('');
  };

  const removeQuestionDirection = (index: number) => {
    setQuestionDirections((current) => current.filter((_, i) => i !== index));
  };

  const handleSelectTargetLanguage = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setTargetLanguage(event.target.value);
  };

  const resetSystemPrompt = () => {
    setSystemPrompt('');
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
                checked={enabled}
                onChange={() => setEnabled((v) => !v)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={clsx('w-full', !enabled && 'pointer-events-none select-none opacity-50')}>
        <h2 className='mb-2 font-medium'>{_('Inline Insight Provider')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item gap-3'>
              <span className='line-clamp-2 min-w-10'>{_('Provider')}</span>
              <select
                className='select select-bordered select-sm bg-base-100 text-base-content ml-auto w-44 text-center'
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as InlineInsightProvider)}
              >
                {INLINE_INSIGHT_PROVIDER_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className='config-item gap-3'>
              <span className='line-clamp-2 min-w-10'>{_('Base URL')}</span>
              <input
                type='text'
                className='input input-bordered input-sm ml-auto max-w-64 text-left'
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={providerConfig.defaultBaseUrl}
              />
            </div>
            <div className='config-item gap-3'>
              <span className='line-clamp-2 min-w-10'>{_('Model')}</span>
              <div className='ml-auto flex min-w-44 max-w-60 items-center justify-end gap-2'>
                <button
                  className='btn btn-ghost btn-xs'
                  onClick={fetchModels}
                  disabled={fetchingModels}
                  title={_('Refresh Models')}
                >
                  <PiArrowsClockwise className={clsx('size-4', fetchingModels && 'animate-spin')} />
                </button>
                {models.length > 0 ? (
                  <select
                    className='select select-bordered select-sm bg-base-100 text-base-content min-w-0 max-w-48 flex-1 text-center'
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type='text'
                    className='input input-bordered input-sm min-w-0 flex-1 text-center'
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={providerConfig.modelPlaceholder}
                  />
                )}
              </div>
            </div>
            {inlineInsightProviderSupportsApiKey(provider) && (
              <div className='config-item gap-3'>
                <span className='line-clamp-2 min-w-10'>
                  {inlineInsightProviderNeedsApiKey(provider)
                    ? _('API Key')
                    : _('API Key (Optional)')}
                </span>
                <input
                  type='password'
                  className='input input-bordered input-sm ml-auto w-80 text-center'
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder='sk-...'
                />
              </div>
            )}
            <div className='config-item gap-3'>
              <span className='line-clamp-2 min-w-10'>{_('Context Characters')}</span>
              <input
                type='number'
                className='input input-bordered input-sm ml-auto w-32 text-center'
                value={maxChars}
                min={500}
                max={3000}
                onChange={(e) => setMaxChars(Number(e.target.value))}
              />
            </div>
            <div className='config-item gap-3'>
              <span className='line-clamp-2 min-w-10'>{_('Target Language')}</span>
              <Select
                value={targetLanguage}
                onChange={handleSelectTargetLanguage}
                options={getTargetLanguageOptions()}
                className='ml-auto w-36 text-center'
              />
            </div>
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <div className='flex w-full items-center justify-between gap-2'>
                <span>{_('System Prompt')}</span>
                <button type='button' className='btn btn-ghost btn-xs' onClick={resetSystemPrompt}>
                  {_('Reset')}
                </button>
              </div>
              <textarea
                className='textarea textarea-bordered textarea-sm min-h-40 w-full font-mono text-xs'
                value={systemPrompt || SYSTEM_PROMPT}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
              <span className='text-base-content/50 text-xs'>
                {_('Leave unchanged to use the default prompt. Reset clears custom changes.')}
              </span>
            </div>
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <div className='flex w-full items-center justify-between gap-2'>
                <span>{_('Question Directions')}</span>
                <span className='text-base-content/50 text-xs'>{questionDirections.length}/12</span>
              </div>
              {questionDirections.length > 0 && (
                <div className='flex w-full flex-col gap-1'>
                  {questionDirections.map((direction, index) => (
                    <div
                      key={`${direction}-${index}`}
                      className='bg-base-200 flex items-center gap-2 rounded p-1.5'
                    >
                      <span className='line-clamp-2 flex-1 text-xs'>{direction}</span>
                      <button
                        type='button'
                        className='btn btn-ghost btn-xs'
                        onClick={() => removeQuestionDirection(index)}
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
                  value={questionDirectionDraft}
                  placeholder={_('e.g. explain names, translate, historical background')}
                  maxLength={120}
                  onChange={(e) => setQuestionDirectionDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addQuestionDirection();
                    }
                  }}
                />
                <button
                  type='button'
                  className='btn btn-outline btn-sm'
                  disabled={!questionDirectionDraft.trim() || questionDirections.length >= 12}
                  onClick={addQuestionDirection}
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
                checked={cacheEnabled}
                onChange={() => setCacheEnabled((v) => !v)}
              />
            </div>
            {cacheEnabled && (
              <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                <div className='flex w-full items-center justify-between gap-2'>
                  <span>{_('LLM response cache')}</span>
                  <button
                    type='button'
                    className='btn btn-outline btn-xs'
                    onClick={clearInlineInsightCache}
                  >
                    {_('Clear Cache')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default InlineInsightSettingsPanel;
