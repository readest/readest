import clsx from 'clsx';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PiCheckCircle, PiWarningCircle, PiArrowsClockwise, PiSpinner } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { getAIProvider } from '@/services/ai/providers';
import { DEFAULT_AI_SETTINGS, GATEWAY_MODELS, MODEL_PRICING } from '@/services/ai/constants';
import type { AISettings, AIProviderName } from '@/services/ai/types';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';
type CustomModelStatus = 'idle' | 'validating' | 'valid' | 'invalid';

const CUSTOM_MODEL_VALUE = '__custom__';

interface ModelOption {
  id: string;
  label: string;
  inputCost: string;
  outputCost: string;
}

const getModelOptions = (): ModelOption[] => [
  {
    id: GATEWAY_MODELS.GEMINI_FLASH_LITE,
    label: 'Gemini 2.5 Flash Lite',
    inputCost: MODEL_PRICING[GATEWAY_MODELS.GEMINI_FLASH_LITE]?.input ?? '?',
    outputCost: MODEL_PRICING[GATEWAY_MODELS.GEMINI_FLASH_LITE]?.output ?? '?',
  },
  {
    id: GATEWAY_MODELS.GPT_5_NANO,
    label: 'GPT-5 Nano',
    inputCost: MODEL_PRICING[GATEWAY_MODELS.GPT_5_NANO]?.input ?? '?',
    outputCost: MODEL_PRICING[GATEWAY_MODELS.GPT_5_NANO]?.output ?? '?',
  },
  {
    id: GATEWAY_MODELS.LLAMA_4_SCOUT,
    label: 'Llama 4 Scout',
    inputCost: MODEL_PRICING[GATEWAY_MODELS.LLAMA_4_SCOUT]?.input ?? '?',
    outputCost: MODEL_PRICING[GATEWAY_MODELS.LLAMA_4_SCOUT]?.output ?? '?',
  },
  {
    id: GATEWAY_MODELS.GROK_4_1_FAST,
    label: 'Grok 4.1 Fast',
    inputCost: MODEL_PRICING[GATEWAY_MODELS.GROK_4_1_FAST]?.input ?? '?',
    outputCost: MODEL_PRICING[GATEWAY_MODELS.GROK_4_1_FAST]?.output ?? '?',
  },
  {
    id: GATEWAY_MODELS.DEEPSEEK_V3_2,
    label: 'DeepSeek V3.2',
    inputCost: MODEL_PRICING[GATEWAY_MODELS.DEEPSEEK_V3_2]?.input ?? '?',
    outputCost: MODEL_PRICING[GATEWAY_MODELS.DEEPSEEK_V3_2]?.output ?? '?',
  },
  {
    id: GATEWAY_MODELS.QWEN_3_235B,
    label: 'Qwen 3 235B',
    inputCost: MODEL_PRICING[GATEWAY_MODELS.QWEN_3_235B]?.input ?? '?',
    outputCost: MODEL_PRICING[GATEWAY_MODELS.QWEN_3_235B]?.output ?? '?',
  },
];

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
  const [gatewayKey, setGatewayKey] = useState(aiSettings.aiGatewayApiKey ?? '');

  const savedCustomModel = aiSettings.aiGatewayCustomModel ?? '';
  const savedModel = aiSettings.aiGatewayModel ?? DEFAULT_AI_SETTINGS.aiGatewayModel ?? '';
  const isCustomModelSaved = savedCustomModel.length > 0;

  const [selectedModel, setSelectedModel] = useState(
    isCustomModelSaved ? CUSTOM_MODEL_VALUE : savedModel,
  );
  const [customModelInput, setCustomModelInput] = useState(savedCustomModel);
  const [customModelStatus, setCustomModelStatus] = useState<CustomModelStatus>(
    isCustomModelSaved ? 'valid' : 'idle',
  );
  const [customModelPricing, setCustomModelPricing] = useState<{
    input: string;
    output: string;
  } | null>(isCustomModelSaved ? { input: '?', output: '?' } : null);
  const [customModelError, setCustomModelError] = useState('');

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const isMounted = useRef(false);
  const modelOptions = getModelOptions();

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
      const response = await fetch(`${ollamaUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed to fetch models');
      const data = await response.json();
      const models = data.models?.map((m: { name: string }) => m.name) || [];

      setOllamaModels(models);
      if (models.length > 0 && !models.includes(ollamaModel)) {
        setOllamaModel(models[0]!);
      }
    } catch (_err) {
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
    if (gatewayKey !== (aiSettings.aiGatewayApiKey ?? '')) {
      saveAiSetting('aiGatewayApiKey', gatewayKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayKey]);

  // Get the effective model ID to use (either selected or custom)
  const getEffectiveModelId = useCallback(() => {
    if (selectedModel === CUSTOM_MODEL_VALUE && customModelStatus === 'valid') {
      return customModelInput;
    }
    return selectedModel;
  }, [selectedModel, customModelStatus, customModelInput]);

  // Save model selection when it changes
  useEffect(() => {
    if (!isMounted.current) return;
    const effectiveModel = getEffectiveModelId();
    if (effectiveModel !== aiSettings.aiGatewayModel) {
      saveAiSetting('aiGatewayModel', effectiveModel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel, customModelStatus, customModelInput]);

  // Save custom model separately
  useEffect(() => {
    if (!isMounted.current) return;
    const customToSave =
      selectedModel === CUSTOM_MODEL_VALUE && customModelStatus === 'valid' ? customModelInput : '';
    if (customToSave !== (aiSettings.aiGatewayCustomModel ?? '')) {
      saveAiSetting('aiGatewayCustomModel', customToSave);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel, customModelStatus, customModelInput]);

  const handleModelChange = (value: string) => {
    setSelectedModel(value);
    if (value !== CUSTOM_MODEL_VALUE) {
      setCustomModelStatus('idle');
      setCustomModelError('');
      setCustomModelPricing(null);
    }
  };

  const validateCustomModel = async () => {
    if (!customModelInput.trim()) {
      setCustomModelError(_('Please enter a model ID'));
      setCustomModelStatus('invalid');
      return;
    }

    setCustomModelStatus('validating');
    setCustomModelError('');

    try {
      // Simple validation: try to make a minimal request to verify model exists
      // This uses the AI Gateway to check if the model is available
      const testSettings: AISettings = {
        ...aiSettings,
        provider: 'ai-gateway',
        aiGatewayApiKey: gatewayKey,
        aiGatewayModel: customModelInput.trim(),
      };

      const aiProvider = getAIProvider(testSettings);
      const isAvailable = await aiProvider.isAvailable();

      if (isAvailable) {
        setCustomModelStatus('valid');
        // Set unknown pricing for custom models
        setCustomModelPricing({ input: '?', output: '?' });
      } else {
        setCustomModelStatus('invalid');
        setCustomModelError(_('Model not available or invalid'));
      }
    } catch (_err) {
      setCustomModelStatus('invalid');
      setCustomModelError(_('Failed to validate model'));
    }
  };

  const handleTestConnection = async () => {
    if (!enabled) return;
    setConnectionStatus('testing');
    setErrorMessage('');

    try {
      const effectiveModel = getEffectiveModelId();
      const testSettings: AISettings = {
        ...aiSettings,
        provider,
        ollamaBaseUrl: ollamaUrl,
        ollamaModel,
        aiGatewayApiKey: gatewayKey,
        aiGatewayModel: effectiveModel,
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
              <span>{_('AI Gateway (Cloud)')}</span>
              <input
                type='radio'
                name='ai-provider'
                className='radio'
                checked={provider === 'ai-gateway'}
                onChange={() => setProvider('ai-gateway')}
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

      {provider === 'ai-gateway' && (
        <div className={clsx('w-full', disabledSection)}>
          <h2 className='mb-2 font-medium'>{_('AI Gateway Configuration')}</h2>
          <p className='text-base-content/70 mb-3 text-sm'>
            {_(
              'Choose from a selection of high-quality, economical AI models. You can also bring your own model by selecting "Custom Model" below.',
            )}
          </p>
          <div className='card border-base-200 bg-base-100 border shadow'>
            <div className='divide-base-200 divide-y'>
              <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                <div className='flex w-full items-center justify-between'>
                  <span>{_('API Key')}</span>
                  <a
                    href='https://vercel.com/docs/ai/ai-gateway'
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
                  value={gatewayKey}
                  onChange={(e) => setGatewayKey(e.target.value)}
                  placeholder='vck_...'
                  disabled={!enabled}
                />
              </div>
              <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                <span>{_('Model')}</span>
                <select
                  className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                  value={selectedModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  disabled={!enabled}
                >
                  {modelOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label} — ${opt.inputCost}/M in, ${opt.outputCost}/M out
                    </option>
                  ))}
                  <option value={CUSTOM_MODEL_VALUE}>{_('Custom Model...')}</option>
                </select>
              </div>

              {selectedModel === CUSTOM_MODEL_VALUE && (
                <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                  <span>{_('Custom Model ID')}</span>
                  <div className='flex w-full gap-2'>
                    <input
                      type='text'
                      className='input input-bordered input-sm flex-1'
                      value={customModelInput}
                      onChange={(e) => {
                        setCustomModelInput(e.target.value);
                        setCustomModelStatus('idle');
                        setCustomModelError('');
                      }}
                      placeholder='provider/model-name'
                      disabled={!enabled}
                    />
                    <button
                      className='btn btn-outline btn-sm'
                      onClick={validateCustomModel}
                      disabled={!enabled || customModelStatus === 'validating'}
                    >
                      {customModelStatus === 'validating' ? (
                        <PiSpinner className='size-4 animate-spin' />
                      ) : (
                        _('Validate')
                      )}
                    </button>
                  </div>
                  {customModelStatus === 'valid' && customModelPricing && (
                    <span className='text-success flex items-center gap-1 text-sm'>
                      <PiCheckCircle />
                      {_('Model available')} — ${customModelPricing.input}/M in, $
                      {customModelPricing.output}/M out
                    </span>
                  )}
                  {customModelStatus === 'invalid' && (
                    <span className='text-error text-sm'>{customModelError}</span>
                  )}
                </div>
              )}
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
