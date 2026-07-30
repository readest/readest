import React, { useEffect, useState } from 'react';
import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import { useAuth } from '@/context/AuthContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useTranslator } from '@/hooks/useTranslator';
import { TRANSLATOR_LANGS } from '@/services/constants';
import {
  UseTranslatorOptions,
  getTranslatorDisplayLabel,
  getTranslators,
  isTranslatorAvailable,
} from '@/services/translators';
import Select from '@/components/Select';

const notSupportedLangs = [''];

const generateTranslatorLangs = () => {
  return Object.fromEntries(
    Object.entries(TRANSLATOR_LANGS).filter(([code]) => !notSupportedLangs.includes(code)),
  );
};

const translatorLangs = generateTranslatorLangs();

interface TranslatorPopupProps {
  text: string;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

interface TranslatorType {
  name: string;
  label: string;
  disabled: boolean;
}

const TranslatorPopup: React.FC<TranslatorPopupProps> = ({
  text,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { token } = useAuth();
  const { settings, setSettings } = useSettingsStore();
  const [providers, setProviders] = useState<TranslatorType[]>([]);
  const [sourceLang, setSourceLang] = useState('AUTO');
  const [targetLang, setTargetLang] = useState(settings.globalReadSettings.translateTargetLang);
  const [provider, setProvider] = useState(settings.globalReadSettings.translationProvider);
  const [translation, setTranslation] = useState<string | null>(null);
  const [detectedSourceLang, setDetectedSourceLang] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { translate, translators } = useTranslator({
    provider,
    sourceLang,
    targetLang,
  } as UseTranslatorOptions);

  const viewportWidth = typeof window === 'undefined' ? popupWidth : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 760 : window.innerHeight;
  const preferredPopupWidth = Math.min(Math.max(popupWidth, 560), Math.max(320, viewportWidth - 32));
  const preferredPopupMinHeight = Math.min(Math.max(popupHeight, 420), Math.max(360, viewportHeight - 32));
  const preferredPopupMaxHeight = Math.min(820, Math.max(420, viewportHeight - 32));

  const handleSourceLangChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSourceLang(event.target.value);
  };

  const handleTargetLangChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    settings.globalReadSettings.translateTargetLang = event.target.value;
    setSettings(settings);
    setTargetLang(event.target.value);
  };

  const handleProviderChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const requestedProvider = event.target.value;
    const availableTranslators = getTranslators().filter((t) => isTranslatorAvailable(t, !!token));
    const selectedTranslator =
      availableTranslators.find((t) => t.name === requestedProvider) || availableTranslators[0]!;
    if (selectedTranslator) {
      settings.globalReadSettings.translationProvider = selectedTranslator.name;
      setSettings(settings);
      setProvider(selectedTranslator.name);
    }
  };

  useEffect(() => {
    const availableProviders = translators.map((t) => ({
      name: t.name,
      label: getTranslatorDisplayLabel(t, !!token, _),
      disabled: !!t.disabled,
    }));
    setProviders(availableProviders);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translators]);

  useEffect(() => {
    setLoading(true);
    const fetchTranslation = async () => {
      setError(null);
      setTranslation(null);

      try {
        const input = text.replaceAll('\n', '').trim();
        const result = await translate([input]);
        const translatedText = result[0];
        const detectedSource = null;

        if (!translatedText) {
          throw new Error('No translation found');
        }

        setTranslation(translatedText);
        if (sourceLang === 'AUTO' && detectedSource) {
          setDetectedSourceLang(detectedSource);
        }
      } catch (err) {
        console.error(err);
        if (!token) {
          setError(_('Unable to fetch the translation. Please log in first and try again.'));
        } else {
          setError(_('Unable to fetch the translation. Try again later.'));
        }
      } finally {
        setLoading(false);
      }
    };

    fetchTranslation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, token, sourceLang, targetLang, provider, translate]);

  return (
    <div>
      <Popup
        trianglePosition={trianglePosition}
        width={preferredPopupWidth}
        minHeight={preferredPopupMinHeight}
        maxHeight={preferredPopupMaxHeight}
        position={position}
        className='not-eink:text-white grid h-full select-text grid-rows-[auto,auto,minmax(0,1fr),auto] overflow-hidden rounded-2xl bg-gray-700 shadow-2xl ring-1 ring-white/10'
        triangleClassName='text-gray-700'
        onDismiss={onDismiss}
      >
        <div className='px-5 pb-4 pt-5 font-sans sm:px-6'>
          <div className='mb-3 flex flex-wrap items-center justify-between gap-3'>
            <h1 className='text-sm font-semibold tracking-wide text-white/85'>{_('Original Text')}</h1>
            <Select
              className='not-eink:bg-gray-600 not-eink:text-white eink:bg-base-100 max-w-[60%] rounded-lg'
              value={sourceLang}
              onChange={handleSourceLangChange}
              options={[
                { value: 'AUTO', label: _('Auto Detect') },
                ...Object.entries(translatorLangs)
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([code, name]) => {
                    const label =
                      detectedSourceLang && sourceLang === 'AUTO' && code === 'AUTO'
                        ? `${translatorLangs[detectedSourceLang] || detectedSourceLang} ` +
                          _('(detected)')
                        : name;
                    return { value: code, label };
                  }),
              ]}
            />
          </div>
          <p className='not-eink:text-white/80 line-clamp-5 whitespace-pre-wrap text-base leading-relaxed'>
            {text}
          </p>
        </div>

        <div className='mx-5 border-t border-white/10 sm:mx-6'></div>

        <div className='min-h-0 px-5 py-4 font-sans sm:px-6'>
          <div className='mb-3 flex flex-wrap items-center justify-between gap-3'>
            <h2 className='text-sm font-semibold tracking-wide text-white/85'>{_('Translated Text')}</h2>
            <Select
              className='not-eink:bg-gray-600 not-eink:text-white eink:bg-base-100 max-w-[60%] rounded-lg'
              value={targetLang}
              onChange={handleTargetLangChange}
              options={[
                { value: '', label: _('System Language') },
                ...Object.entries(translatorLangs)
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([code, name]) => ({ value: code, label: name })),
              ]}
            />
          </div>
          <div className='min-h-[6rem] rounded-xl bg-black/10 p-4 ring-1 ring-white/10'>
            {loading ? (
              <p className='text-base italic leading-relaxed text-white/55'>{_('Loading...')}</p>
            ) : error ? (
              <p className='text-base leading-relaxed text-red-300'>{error}</p>
            ) : (
              <p className='not-eink:text-white/90 whitespace-pre-wrap text-base leading-relaxed'>
                {translation || _('No translation available.')}
              </p>
            )}
          </div>
        </div>

        <div className='flex items-center justify-between gap-3 border-t border-white/10 px-5 py-3 font-sans sm:px-6'>
          <div className='line-clamp-1 min-w-0 flex-1 text-xs text-white/50'>
            {provider &&
              !loading &&
              !error &&
              _('Translated by {{provider}}.', {
                provider: providers.find((p) => p.name === provider)?.label,
              })}
          </div>
          <Select
            className='not-eink:bg-gray-600 not-eink:text-white eink:bg-base-100 max-w-[50%] rounded-lg'
            value={provider}
            onChange={handleProviderChange}
            options={providers.map(({ name: value, label, disabled }) => ({
              value,
              label,
              disabled,
            }))}
          />
        </div>
      </Popup>
    </div>
  );
};

export default TranslatorPopup;
