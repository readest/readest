import React, { useState } from 'react';
import { PiSpinner } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useCustomTTSStore } from '@/store/customTTSStore';
import { OpenAICompatibleSpeechProvider } from '@/services/tts/providers/openaiCompatible';
import type { CustomTTSService } from '@/types/customTTS';
import { BoxedList, SettingLabel, SettingsSwitchRow } from './primitives';
import SubPageHeader from './SubPageHeader';

const BASE_URL_PRESETS = [
  'https://api.openai.com/v1',
  'https://api.siliconflow.cn/v1',
  'http://127.0.0.1:8880/v1',
];

const MODEL_PRESETS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd', 'kokoro'];

type Draft = Omit<CustomTTSService, 'id' | 'addedAt' | 'updatedAt'>;

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

interface CustomTTSServiceEditorProps {
  service?: CustomTTSService;
  onBack: () => void;
}

const CustomTTSServiceEditor: React.FC<CustomTTSServiceEditorProps> = ({ service, onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [draft, setDraft] = useState<Draft>(
    service ?? { name: '', baseUrl: BASE_URL_PRESETS[0]!, model: MODEL_PRESETS[0]! },
  );
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [voiceCount, setVoiceCount] = useState<number | null>(null);

  const canSave = !!draft.name.trim() && !!draft.baseUrl.trim() && !!draft.model.trim();

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError('');
    setVoiceCount(null);
  };

  const cleaned = (): Draft => ({
    ...draft,
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
    model: draft.model.trim(),
    instructions: draft.instructions?.trim() || undefined,
  });

  // Lists the service's voices and speaks a short sample with the first one,
  // straight from this device.
  const handleTest = async () => {
    setTesting(true);
    setError('');
    setVoiceCount(null);
    try {
      const test: CustomTTSService = { ...cleaned(), id: 'test', addedAt: 0, updatedAt: 0 };
      const provider = new OpenAICompatibleSpeechProvider(
        () => [test],
        async () => true,
      );
      const voices = await provider.getAllVoices();
      const { audio } = await provider.synthesize(
        {
          lang: 'en',
          text: _('Hello! This is how this voice sounds.'),
          voice: voices[0]!.id,
          pitch: 1,
        },
        new AbortController().signal,
      );
      setVoiceCount(voices.length);
      const url = URL.createObjectURL(new Blob([audio], { type: 'audio/mpeg' }));
      const player = new Audio(url);
      player.onended = () => URL.revokeObjectURL(url);
      await player.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const store = useCustomTTSStore.getState();
    if (service) store.updateService(service.id, cleaned());
    else store.addService(cleaned());
    void store.saveCustomTTSServices(envConfig);
    onBack();
  };

  const handleDelete = () => {
    if (!service) return;
    const store = useCustomTTSStore.getState();
    store.removeService(service.id);
    void store.saveCustomTTSServices(envConfig);
    onBack();
  };

  const inputClass = 'input input-sm eink-bordered w-full';

  return (
    <div className='my-4 w-full space-y-6'>
      <SubPageHeader
        parentLabel={_('Custom TTS Services')}
        currentLabel={service ? service.name : _('Add TTS Service')}
        description={_(
          'Use your own API key with an OpenAI-compatible speech service. Requests go directly from this device to the service.',
        )}
        onBack={onBack}
      />

      <BoxedList>
        <Field id='tts-name' label={_('Name')}>
          <input
            id='tts-name'
            type='text'
            className={inputClass}
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder='OpenAI'
          />
        </Field>
        <Field id='tts-base-url' label={_('Base URL')}>
          <input
            id='tts-base-url'
            type='text'
            className={inputClass}
            value={draft.baseUrl}
            onChange={(e) => update({ baseUrl: e.target.value })}
            list='custom-tts-base-urls'
            placeholder={BASE_URL_PRESETS[0]}
          />
          <datalist id='custom-tts-base-urls'>
            {BASE_URL_PRESETS.map((url) => (
              <option key={url} value={url} />
            ))}
          </datalist>
        </Field>
        <Field id='tts-api-key' label={_('API Key')}>
          <input
            id='tts-api-key'
            type='password'
            className={inputClass}
            value={draft.apiKey ?? ''}
            // A cleared key stays '' rather than undefined: it syncs, so
            // other devices drop it too.
            onChange={(e) => update({ apiKey: e.target.value })}
            placeholder={_('Optional for local servers')}
            autoComplete='off'
          />
        </Field>
        <Field id='tts-model' label={_('Model')}>
          <input
            id='tts-model'
            type='text'
            className={inputClass}
            value={draft.model}
            onChange={(e) => update({ model: e.target.value })}
            list='custom-tts-models'
            placeholder={MODEL_PRESETS[0]}
          />
          <datalist id='custom-tts-models'>
            {MODEL_PRESETS.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </Field>
        <Field id='tts-instructions' label={_('Instructions')}>
          <textarea
            id='tts-instructions'
            className='textarea textarea-sm eink-bordered w-full'
            rows={3}
            value={draft.instructions ?? ''}
            onChange={(e) => update({ instructions: e.target.value })}
            placeholder={_('Optional, for models that accept a speaking style')}
          />
        </Field>
        <SettingsSwitchRow
          label={_('Enabled')}
          checked={!draft.disabled}
          onChange={() => update({ disabled: !draft.disabled || undefined })}
        />
      </BoxedList>

      <div className='flex flex-col gap-3 px-4'>
        {error && <p className='text-error break-words text-sm'>{error}</p>}
        {voiceCount !== null && (
          <p className='text-base-content/70 text-sm'>
            {_('{{count}} voices available', { count: voiceCount })}
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

      {service && (
        <BoxedList>
          <button
            type='button'
            className='text-error w-full py-3 text-start'
            onClick={handleDelete}
          >
            {_('Delete TTS Service')}
          </button>
        </BoxedList>
      )}
    </div>
  );
};

export default CustomTTSServiceEditor;
