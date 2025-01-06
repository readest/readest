import React, { useEffect, useState } from 'react';
import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { isWebAppPlatform } from '@/services/environment';

const LANGUAGES = {
  AUTO: 'Auto Detect',
  EN: 'English',
  DE: 'German',
  FR: 'French',
  ES: 'Spanish',
  ID: 'Indonesian',
  IT: 'Italian',
  PT: 'Portuguese',
  NL: 'Dutch',
  PL: 'Polish',
  RU: 'Russian',
  KO: 'Korean',
  JA: 'Japanese',
  'ZH-HANS': 'Chinese (Simplified)',
  'ZH-HANT': 'Chinese (Traditional)',
};

interface DeepLPopupProps {
  text: string;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
}

const DeepLPopup: React.FC<DeepLPopupProps> = ({
  text,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
}) => {
  const _ = useTranslation();
  const { settings, setSettings } = useSettingsStore();
  const [sourceLang, setSourceLang] = useState('AUTO');
  const [targetLang, setTargetLang] = useState(settings.globalReadSettings.translateTargetLang);
  const [translation, setTranslation] = useState<string | null>(null);
  const [detectedSourceLang, setDetectedSourceLang] = useState<keyof typeof LANGUAGES | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSourceLangChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSourceLang(event.target.value);
  };

  const handleTargetLangChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    settings.globalReadSettings.translateTargetLang = event.target.value;
    setSettings(settings);
    setTargetLang(event.target.value);
  };

  useEffect(() => {
    const fetchTranslation = async () => {
      setLoading(true);
      setError(null);
      setTranslation(null);

      if (!process.env['NEXT_PUBLIC_DEEPL_API_KEY']) {
        console.error('DeepL API key not found. Set NEXT_PUBLIC_DEEPL_API_KEY in .env.local');
      }

      const { fetch, url } = isWebAppPlatform()
        ? { fetch: window.fetch, url: '/api/deepl/translate' }
        : {
            fetch: (await import('@tauri-apps/plugin-http')).fetch,
            url: 'https://api-free.deepl.com/v2/translate',
          };

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `DeepL-Auth-Key ${process.env['NEXT_PUBLIC_DEEPL_API_KEY']}`,
          },
          body: JSON.stringify({
            text: [text],
            target_lang: targetLang.toUpperCase(),
            source_lang: sourceLang === 'AUTO' ? undefined : sourceLang.toUpperCase(),
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to fetch translation');
        }
        const data = await response.json();
        const translatedText = data.translations[0]?.text;
        const detectedSource = data.translations[0]?.detected_source_language;

        if (!translatedText) {
          throw new Error('No translation found');
        }

        if (sourceLang === 'AUTO' && detectedSource) {
          setDetectedSourceLang(detectedSource);
        }

        setTranslation(translatedText);
      } catch (err) {
        console.error(err);
        setError('Unable to fetch the translation. Try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchTranslation();
  }, [text, sourceLang, targetLang]);

  return (
    <div>
      <Popup
        trianglePosition={trianglePosition}
        width={popupWidth}
        height={popupHeight}
        position={position}
        className='select-text'
      >
        <div className='text-neutral-content relative h-[50%] overflow-y-auto border-b border-neutral-400/75 p-4 font-sans'>
          <div className='mb-2 flex items-center justify-between'>
            <h1 className='text-base font-semibold'>{_('Original Text')}</h1>
            <select
              value={sourceLang}
              onChange={handleSourceLangChange}
              className='select text-neutral-content h-8 min-h-8 rounded-md border-none bg-neutral-200/50 text-sm focus:outline-none focus:ring-0'
            >
              {Object.entries(LANGUAGES).map(([code, name]) => {
                return (
                  <option key={code} value={code}>
                    {detectedSourceLang && sourceLang === 'AUTO' && code === 'AUTO'
                      ? `${LANGUAGES[detectedSourceLang] || detectedSourceLang} ` + _('(detected)')
                      : name}
                  </option>
                );
              })}
            </select>
          </div>
          <p className='text-base'>{text}</p>
        </div>

        <div className='text-neutral-content relative h-[50%] overflow-y-auto p-4 font-sans'>
          <div className='mb-2 flex items-center justify-between'>
            <h2 className='text-base font-semibold'>{_('Translated Text')}</h2>
            <select
              value={targetLang}
              onChange={handleTargetLangChange}
              className='select text-neutral-content h-8 min-h-8 rounded-md border-none bg-neutral-200/50 text-sm focus:outline-none focus:ring-0'
            >
              {Object.entries(LANGUAGES)
                .filter(([code]) => code !== 'AUTO')
                .map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
            </select>
          </div>

          {loading ? (
            <p className='text-base italic text-gray-500'>{_('Loading...')}</p>
          ) : error ? (
            <p className='text-base text-red-600'>{error}</p>
          ) : (
            <div>
              <p className='text-base'>{translation || 'No translation available.'}</p>
              <div className='pt-4 text-sm opacity-60'>
                Translated by{' '}
                <a href='https://www.deepl.com/' target='_blank' rel='noopener noreferrer'>
                  DeepL
                </a>
                .
              </div>
            </div>
          )}
        </div>
      </Popup>
    </div>
  );
};

export default DeepLPopup;
