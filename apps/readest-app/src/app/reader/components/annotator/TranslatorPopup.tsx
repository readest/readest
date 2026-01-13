import React, { useEffect, useState } from 'react';
import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import { useAuth } from '@/context/AuthContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useTranslator } from '@/hooks/useTranslator';
import { TRANSLATOR_LANGS } from '@/services/constants';
import { UseTranslatorOptions, getTranslators } from '@/services/translators';
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
    const availableTranslators = getTranslators().filter(
      (t) => (t.authRequired ? !!token : true) && !t.quotaExceeded,
    );
    const selectedTranslator =
      availableTranslators.find((t) => t.name === requestedProvider) || availableTranslators[0]!;
    if (selectedTranslator) {
      settings.globalReadSettings.translationProvider = selectedTranslator.name;
      setSettings(settings);
      setProvider(selectedTranslator.name);
    }
  };

  useEffect(() => {
    const availableProviders = translators.map((t) => {
      let label = t.label;
      if (t.authRequired && !token) {
        label = `${label} (${_('Login Required')})`;
      } else if (t.quotaExceeded) {
        label = `${label} (${_('Quota Exceeded')})`;
      }
      return { name: t.name, label };
    });
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
        width={popupWidth}
        minHeight={popupHeight}
        maxHeight={720}
        position={position}
        className='not-eink:text-white grid h-full select-text grid-rows-[1fr,auto,1fr] bg-gray-600'
        triangleClassName='text-gray-600'
        onDismiss={onDismiss}
      >
        <div className='overflow-y-auto p-4 font-sans'>
          <div className='mb-2 flex items-center justify-between'>
            <h1 className='text-sm font-normal'>{_('Original Text')}</h1>
            <Select
              className='not-eink:bg-gray-600 not-eink:text-white eink:bg-base-100'
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
          <p className='not-eink:text-white/90 text-base'>{text}</p>
        </div>

        <div className='mx-4 flex-shrink-0 border-t border-gray-500/30'></div>

        <div className='overflow-y-auto px-4 pb-8 pt-4 font-sans'>
          <div className='mb-2 flex items-center justify-between'>
            <h2 className='text-sm font-normal'>{_('Translated Text')}</h2>
            <Select
              className='not-eink:bg-gray-600 not-eink:text-white eink:bg-base-100'
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
          {loading ? (
            <p className='text-base italic text-gray-500'>{_('Loading...')}</p>
          ) : (
            <div>
              {error ? (
                <p className='text-base text-red-600'>{error}</p>
              ) : (
                <p className='not-eink:text-white/90 text-base'>
                  {translation || _('No translation available.')}
                </p>
              )}
            </div>
          )}
        </div>
        <div className='absolute bottom-0 flex h-8 w-full items-center justify-between px-4'>
          <div className='line-clamp-1 text-xs opacity-60'>
            {provider &&
              !loading &&
              !error &&
              _('Translated by {{provider}}.', {
                provider: providers.find((p) => p.name === provider)?.label,
              })}
          </div>
          <Select
            className='not-eink:bg-gray-600 not-eink:text-white eink:bg-base-100'
            value={provider}
            onChange={handleProviderChange}
            options={providers.map(({ name: value, label }) => ({ value, label }))}
          />
        </div>
      </Popup>
    </div>
  );
};

export default TranslatorPopup;
