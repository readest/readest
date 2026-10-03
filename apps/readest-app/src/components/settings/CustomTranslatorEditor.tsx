import clsx from 'clsx';
import React, { useState } from 'react';
import { PiSpinner, PiArrowsClockwise } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useCustomTranslatorStore } from '@/store/customTranslatorStore';
import { buildCustomTranslator } from '@/services/translators/custom';
import { fetchOpenRouterModels } from '@/services/ai/providers/OpenRouterProvider';
import type { CustomTranslator, CustomTranslatorType } from '@/types/translation';
import {
  BoxedList,
  SettingLabel,
  SettingsRow,
  SettingsSelect,
  SettingsSwitchRow,
} from './primitives';
import SubPageHeader from './SubPageHeader';

const BASE_URL_PRESETS = [
  'https://api.openai.com/v1',
  'https://api.deepseek.com/v1',
  'https://openrouter.ai/api/v1',
  'https://api.siliconflow.cn/v1',
  'https://generativelanguage.googleapis.com/v1beta/openai',
  'http://127.0.0.1:11434/v1',
  'http://127.0.0.1:1234/v1',
];

type Draft = Omit<CustomTranslator, 'id' | 'addedAt' | 'updatedAt'>;

interface CustomTranslatorEditorProps {
  translator?: CustomTranslator;
  targetLang: string;
  onBack: () => void;
}

const Field: React.FC<{ id: string; label: string; children: React.ReactNode }> = ({
  id,
  label,
  children,
}) => (
  <div className='flex flex-col gap-2 py-3 pe-4'>
    <SettingLabel as='label' htmlFor={id}>
      {label}
    </SettingLabel>
    {children}
  </div>
);

const CustomTranslatorEditor: React.FC<CustomTranslatorEditorProps> = ({
  translator,
  targetLang,
  onBack,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [draft, setDraft] = useState<Draft>(
    translator ?? { type: 'openai-compatible', name: '', baseUrl: BASE_URL_PRESETS[0] },
  );
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const isLLM = draft.type === 'openai-compatible';
  const canSave =
    !!draft.name.trim() &&
    (isLLM ? !!draft.baseUrl?.trim() && !!draft.model?.trim() : !!draft.apiKey);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setResult(null);
  };

  const handleFetchModels = async () => {
    setFetchingModels(true);
    try {
      const list = await fetchOpenRouterModels(draft.baseUrl ?? '', draft.apiKey ?? '');
      setModels(list.map((m) => m.id));
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const provider = buildCustomTranslator({ ...draft, id: 'test', addedAt: 0, updatedAt: 0 });
      const [text] = await provider.translate(['Hello, world.'], 'AUTO', targetLang);
      setResult({ ok: true, text: text ?? '' });
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const store = useCustomTranslatorStore.getState();
    const cleaned: Draft = {
      ...draft,
      name: draft.name.trim(),
      baseUrl: isLLM ? draft.baseUrl?.trim() : undefined,
      model: isLLM ? draft.model?.trim() : undefined,
      temperature: isLLM ? draft.temperature : undefined,
    };
    if (translator) store.updateTranslator(translator.id, cleaned);
    else store.addTranslator(cleaned);
    void store.saveCustomTranslators(envConfig);
    onBack();
  };

  const handleDelete = () => {
    if (!translator) return;
    const store = useCustomTranslatorStore.getState();
    store.removeTranslator(translator.id);
    void store.saveCustomTranslators(envConfig);
    onBack();
  };

  const inputClass = 'input input-sm eink-bordered w-full';

  return (
    <div className='my-4 w-full space-y-6'>
      <SubPageHeader
        parentLabel={_('Custom Translators')}
        currentLabel={translator ? translator.name : _('Add Translator')}
        description={_(
          'Use your own API key with an OpenAI-compatible service or DeepL. Requests go directly from this device to the service.',
        )}
        onBack={onBack}
      />

      <BoxedList>
        <SettingsRow label={_('Type')}>
          <SettingsSelect
            value={draft.type}
            onChange={(e) => update({ type: e.target.value as CustomTranslatorType })}
            ariaLabel={_('Type')}
            disabled={!!translator}
            options={[
              { value: 'openai-compatible', label: _('OpenAI Compatible') },
              { value: 'deepl', label: 'DeepL' },
            ]}
          />
        </SettingsRow>
        <Field id='ct-name' label={_('Name')}>
          <input
            id='ct-name'
            type='text'
            className={inputClass}
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder={isLLM ? 'DeepSeek' : 'DeepL'}
          />
        </Field>
        {isLLM && (
          <Field id='ct-base-url' label={_('Base URL')}>
            <input
              id='ct-base-url'
              type='text'
              className={inputClass}
              value={draft.baseUrl ?? ''}
              onChange={(e) => update({ baseUrl: e.target.value })}
              list='custom-translator-base-urls'
              placeholder={BASE_URL_PRESETS[0]}
            />
            <datalist id='custom-translator-base-urls'>
              {BASE_URL_PRESETS.map((url) => (
                <option key={url} value={url} />
              ))}
            </datalist>
          </Field>
        )}
        <Field id='ct-api-key' label={_('API Key')}>
          <input
            id='ct-api-key'
            type='password'
            className={inputClass}
            value={draft.apiKey ?? ''}
            onChange={(e) => update({ apiKey: e.target.value || undefined })}
            placeholder={isLLM ? _('Optional for local servers') : 'xxxxxxxx:fx'}
            autoComplete='off'
          />
        </Field>
        {isLLM && (
          <Field id='ct-model' label={_('Model')}>
            <div className='flex w-full gap-2'>
              <input
                id='ct-model'
                type='text'
                className={clsx(inputClass, 'flex-1')}
                value={draft.model ?? ''}
                onChange={(e) => update({ model: e.target.value })}
                list='custom-translator-models'
                placeholder='deepseek-chat'
              />
              <button
                type='button'
                className='btn btn-ghost btn-sm eink-bordered'
                onClick={handleFetchModels}
                disabled={fetchingModels || !draft.baseUrl}
                title={_('Fetch Models')}
                aria-label={_('Fetch Models')}
              >
                {fetchingModels ? (
                  <PiSpinner className='size-4 animate-spin' />
                ) : (
                  <PiArrowsClockwise className='size-4' />
                )}
              </button>
            </div>
            <datalist id='custom-translator-models'>
              {models.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </Field>
        )}
        {isLLM && (
          <Field id='ct-temperature' label={_('Temperature')}>
            <input
              id='ct-temperature'
              type='number'
              className={inputClass}
              min={0}
              max={2}
              step={0.1}
              value={draft.temperature ?? ''}
              onChange={(e) =>
                update({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              placeholder={_('Default')}
            />
          </Field>
        )}
        <SettingsSwitchRow
          label={_('Enabled')}
          checked={!draft.disabled}
          onChange={() => update({ disabled: !draft.disabled || undefined })}
        />
      </BoxedList>

      <div className='flex flex-col gap-3 px-4'>
        {result && (
          <p className={clsx('break-words text-sm', result.ok ? 'text-success' : 'text-error')}>
            {result.ok ? `${_('Test translation')}: ${result.text}` : result.text}
          </p>
        )}
        <div className='flex justify-end gap-2'>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered'
            onClick={handleTest}
            disabled={!canSave || testing}
          >
            {testing ? <PiSpinner className='size-4 animate-spin' /> : _('Test')}
          </button>
          <button
            type='button'
            className='btn btn-contrast btn-sm'
            onClick={handleSave}
            disabled={!canSave}
          >
            {_('Save')}
          </button>
        </div>
      </div>

      {translator && (
        <BoxedList>
          <button
            type='button'
            className='text-error w-full py-3 text-start'
            onClick={handleDelete}
          >
            {_('Delete Translator')}
          </button>
        </BoxedList>
      )}
    </div>
  );
};

export default CustomTranslatorEditor;
