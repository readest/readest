import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PiArrowsClockwise } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import Select from '@/components/Select';
import { TRANSLATED_LANGS } from '@/services/constants';
import { clearInlineInsightCache } from '@/services/inlineInsight/cache';
import { fetchInlineInsightModels } from '@/services/inlineInsight/models';
import { SYSTEM_PROMPT } from '@/services/inlineInsight/prompts';
import { DEFAULT_INLINE_INSIGHT_SETTINGS } from '@/services/inlineInsight/types';
import type { InlineInsightProvider, InlineInsightSettings } from '@/services/inlineInsight/types';
import { getLocale } from '@/utils/misc';
import {
  buildInlineInsightUrlsFromApiHost,
  getApiHostFromInlineInsightChatUrl,
  getProviderDefaultConfig,
  inlineInsightProviderAllowsCustomApiHost,
  inlineInsightProviderNeedsApiKey,
  inlineInsightProviderSupportsApiKey,
} from '@/services/inlineInsight/providers';
import { INLINE_INSIGHT_PROVIDER_OPTIONS } from '@/services/inlineInsight/providerConfigs';

function getLangOptions(langs: Record<string, string>, followLabel: string) {
  const options = Object.entries(langs).map(([value, label]) => ({ value, label }));
  options.sort((a, b) => a.label.localeCompare(b.label));
  options.unshift({ value: '', label: followLabel });
  return options;
}

const MAX_QUESTION_DIRECTIONS = 30;

function addQuestionDirectionItem(current: string[], draft: string): string[] {
  const direction = draft.trim();
  if (!direction || current.includes(direction)) {
    return current;
  }
  return [...current, direction].slice(0, MAX_QUESTION_DIRECTIONS);
}

const InlineInsightSettingsPanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const {
    settings: appSettings,
    setSettings: setAppSettings,
    saveSettings: saveAppSettings,
  } = useSettingsStore();

  const mergedSettings: InlineInsightSettings = {
    ...DEFAULT_INLINE_INSIGHT_SETTINGS,
    ...appSettings?.inlineInsightSettings,
  };
  const initialSettings: InlineInsightSettings = mergedSettings;
  const [draft, setDraft] = useState<InlineInsightSettings>(() => ({
    ...initialSettings,
  }));
  const [apiHostInput, setApiHostInput] = useState(() =>
    getApiHostFromInlineInsightChatUrl(initialSettings.chatUrl),
  );
  const [questionDirectionDraft, setQuestionDirectionDraft] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const hasMounted = useRef(false);
  const previousPromptRef = useRef(draft.systemPrompt);
  const provider = draft.provider;
  const providerConfig = getProviderDefaultConfig(provider);
  const canEditApiHost = inlineInsightProviderAllowsCustomApiHost(provider);
  const resolvedUrls = buildInlineInsightUrlsFromApiHost(apiHostInput);

  useEffect(() => {
    hasMounted.current = true;
  }, []);

  useEffect(() => {
    if (!hasMounted.current) return;
    if (JSON.stringify(draft) === JSON.stringify(initialSettings)) return;

    if (draft.systemPrompt !== previousPromptRef.current) {
      clearInlineInsightCache();
      previousPromptRef.current = draft.systemPrompt;
    }

    const nextSettings = { ...appSettings, inlineInsightSettings: draft };
    setAppSettings(nextSettings);
    void saveAppSettings(envConfig, nextSettings);
  }, [draft, envConfig, appSettings, saveAppSettings, setAppSettings, initialSettings]);

  const getCurrentUILangOption = () => {
    const uiLanguage = appSettings?.globalViewSettings.uiLanguage ?? '';
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
    if (draft.targetLanguage && !options.some((option) => option.value === draft.targetLanguage)) {
      options.push({ value: draft.targetLanguage, label: draft.targetLanguage });
    }
    return options;
  };

  const fetchModels = useCallback(async () => {
    if (!draft.modelUrl || !draft.enabled) return;
    setFetchingModels(true);
    try {
      const nextModels = await fetchInlineInsightModels({
        ...DEFAULT_INLINE_INSIGHT_SETTINGS,
        provider: draft.provider,
        chatUrl: draft.chatUrl,
        modelUrl: draft.modelUrl,
        model: draft.model,
        apiKey: draft.apiKey,
      });
      setModels(nextModels);
      if (nextModels.length > 0 && !nextModels.includes(draft.model)) {
        setDraft((current) => ({ ...current, model: nextModels[0]! }));
      }
    } catch {
      setModels([]);
    } finally {
      setFetchingModels(false);
    }
  }, [draft]);

  useEffect(() => {
    if (draft.enabled) {
      fetchModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.enabled, draft.provider]);

  useEffect(() => {
    if (!draft.enabled) return;
    if (!inlineInsightProviderNeedsApiKey(draft.provider)) return;
    if (!draft.apiKey.trim()) return;
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.apiKey]);

  const updateDraft = useCallback((patch: Partial<InlineInsightSettings>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const handleProviderChange = (value: InlineInsightProvider) => {
    const nextConfig = getProviderDefaultConfig(value);
    const nextCanEditApiHost = inlineInsightProviderAllowsCustomApiHost(value);
    const providerProfiles = {
      ...draft.providerProfiles,
      [provider]: {
        chatUrl: draft.chatUrl,
        modelUrl: draft.modelUrl,
        model: draft.model,
        apiKey: draft.apiKey,
      },
    };
    const nextProfile = {
      chatUrl: nextConfig.defaultChatUrl,
      modelUrl: nextConfig.defaultModelUrl,
      model: '',
      apiKey: '',
      ...providerProfiles[value],
    };
    const nextUrls = nextCanEditApiHost
      ? {
          chatUrl: nextProfile.chatUrl,
          modelUrl: nextProfile.modelUrl,
        }
      : {
          chatUrl: nextConfig.defaultChatUrl,
          modelUrl: nextConfig.defaultModelUrl,
        };
    const nextApiKey =
      nextConfig.requiresApiKey || nextConfig.supportsApiKey ? nextProfile.apiKey : '';

    setModels([]);
    setApiHostInput(getApiHostFromInlineInsightChatUrl(nextUrls.chatUrl));
    updateDraft({
      provider: value,
      chatUrl: nextUrls.chatUrl,
      modelUrl: nextUrls.modelUrl,
      model: nextProfile.model,
      apiKey: nextApiKey,
      providerProfiles,
    });
  };

  const commitApiHost = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;
      const nextUrls = buildInlineInsightUrlsFromApiHost(trimmed);
      setApiHostInput(getApiHostFromInlineInsightChatUrl(nextUrls.chatUrl));
      updateDraft(nextUrls);
    },
    [updateDraft],
  );

  const addQuestionDirection = () => {
    const nextQuestionDirections = addQuestionDirectionItem(
      draft.questionDirections,
      questionDirectionDraft,
    );
    if (nextQuestionDirections === draft.questionDirections) return;
    setDraft((current) => ({
      ...current,
      questionDirections: nextQuestionDirections,
    }));
    setQuestionDirectionDraft('');
  };

  const removeQuestionDirection = (index: number) => {
    setDraft((current) => ({
      ...current,
      questionDirections: current.questionDirections.filter((_, i) => i !== index),
    }));
  };

  const handleSelectTargetLanguage = (event: React.ChangeEvent<HTMLSelectElement>) => {
    updateDraft({ targetLanguage: event.target.value.trim() });
  };

  const resetSystemPrompt = () => {
    updateDraft({ systemPrompt: '' });
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
                checked={draft.enabled}
                onChange={() => updateDraft({ enabled: !draft.enabled })}
              />
            </div>
          </div>
        </div>
      </div>

      <div
        className={clsx('w-full', !draft.enabled && 'pointer-events-none select-none opacity-50')}
      >
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
              <span className='line-clamp-2 min-w-10'>{_('API Host')}</span>
              <div className='ml-auto flex w-80 flex-col items-end gap-1'>
                {canEditApiHost ? (
                  <input
                    type='text'
                    className='input input-bordered input-sm max-w-56 text-center'
                    value={apiHostInput}
                    onChange={(e) => setApiHostInput(e.target.value)}
                    onBlur={(e) => commitApiHost(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitApiHost(apiHostInput);
                      }
                    }}
                    placeholder={getApiHostFromInlineInsightChatUrl(providerConfig.defaultChatUrl)}
                  />
                ) : (
                  <div className='input input-bordered input-sm bg-base-200 text-base-content/70 flex w-full items-center text-left'>
                    {getApiHostFromInlineInsightChatUrl(providerConfig.defaultChatUrl)}
                  </div>
                )}
                <span className='text-base-content/60 w-full text-right text-xs'>
                  {canEditApiHost ? resolvedUrls.chatUrl : draft.chatUrl}
                </span>
              </div>
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
                    value={draft.model}
                    onChange={(e) => updateDraft({ model: e.target.value })}
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
                    value={draft.model}
                    onChange={(e) => updateDraft({ model: e.target.value })}
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
                  value={draft.apiKey}
                  onChange={(e) => updateDraft({ apiKey: e.target.value })}
                  placeholder='sk-...'
                />
              </div>
            )}
            <div className='config-item gap-3'>
              <span className='line-clamp-2 min-w-10'>{_('Context Characters')}</span>
              <input
                type='number'
                className='input input-bordered input-sm ml-auto w-32 text-center'
                value={draft.maxContextChars}
                min={500}
                max={3000}
                onChange={(e) => updateDraft({ maxContextChars: Number(e.target.value) })}
              />
            </div>
            <div className='config-item gap-3'>
              <span className='line-clamp-2 min-w-10'>{_('Target Language')}</span>
              <Select
                value={draft.targetLanguage}
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
                value={draft.systemPrompt || SYSTEM_PROMPT}
                onChange={(e) => updateDraft({ systemPrompt: e.target.value })}
              />
              <span className='text-base-content/50 text-xs'>
                {_('Leave unchanged to use the default prompt. Reset clears custom changes.')}
              </span>
            </div>
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <div className='flex w-full items-center justify-between gap-2'>
                <span>{_('Question Directions')}</span>
                <span className='text-base-content/50 text-xs'>
                  {draft.questionDirections.length}/{MAX_QUESTION_DIRECTIONS}
                </span>
              </div>
              {draft.questionDirections.length > 0 && (
                <div className='flex w-full flex-col gap-1'>
                  {draft.questionDirections.map((direction, index) => (
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
                  disabled={
                    !questionDirectionDraft.trim() ||
                    draft.questionDirections.length >= MAX_QUESTION_DIRECTIONS
                  }
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
                checked={draft.cacheEnabled}
                onChange={() => updateDraft({ cacheEnabled: !draft.cacheEnabled })}
              />
            </div>
            {draft.cacheEnabled && (
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
