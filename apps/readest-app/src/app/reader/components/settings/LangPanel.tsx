import clsx from 'clsx';
import i18n from 'i18next';
import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '../../utils/viewSettingsHelper';
import { getTranslators } from '@/services/translators';
import { TRANSLATED_LANGS } from '@/services/constants';
import DropDown from './DropDown';

const LangPanel: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings, setViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey)!;

  const [translationEnabled, setTranslationEnabled] = useState(viewSettings.translationEnabled!);
  const [translationProvider, setTranslationProvider] = useState(viewSettings.translationProvider!);
  const [translateTargetLang, setTranslateTargetLang] = useState(viewSettings.translateTargetLang!);

  const getCurrentUILangOption = () => {
    const uiLanguage = viewSettings.uiLanguage;
    return {
      option: uiLanguage,
      label:
        uiLanguage === ''
          ? _('Auto')
          : TRANSLATED_LANGS[uiLanguage as keyof typeof TRANSLATED_LANGS],
    };
  };

  const getLangOptions = () => {
    const langs = TRANSLATED_LANGS as Record<string, string>;
    const options = Object.entries(langs).map(([option, label]) => ({ option, label }));
    options.sort((a, b) => a.label.localeCompare(b.label));
    options.unshift({ option: '', label: _('System Language') });
    return options;
  };

  const handleSelectUILang = (option: string) => {
    saveViewSettings(envConfig, bookKey, 'uiLanguage', option, false, false);
    i18n.changeLanguage(option ? option : navigator.language);
  };

  const getTranslationProviderOptions = () => {
    const translators = getTranslators();
    const availableProviders = translators.map((t) => {
      return { option: t.name, label: t.label };
    });
    return availableProviders;
  };

  const getCurrentTranslationProviderOption = () => {
    const option = translationProvider;
    const availableProviders = getTranslationProviderOptions();
    return availableProviders.find((p) => p.option === option) || availableProviders[0]!;
  };

  const handleSelectTranslationProvider = (option: string) => {
    setTranslationProvider(option);
    saveViewSettings(envConfig, bookKey, 'translationProvider', option, false, false);
    viewSettings.translationProvider = option;
    setViewSettings(bookKey, { ...viewSettings });
  };

  const getCurrentTargetLangOption = () => {
    const option = translateTargetLang;
    const availableOptions = getLangOptions();
    return availableOptions.find((o) => o.option === option) || availableOptions[0]!;
  };

  const handleSelectTargetLang = (option: string) => {
    setTranslateTargetLang(option);
    saveViewSettings(envConfig, bookKey, 'translateTargetLang', option, false, false);
    viewSettings.translateTargetLang = option;
    setViewSettings(bookKey, { ...viewSettings });
  };

  useEffect(() => {
    if (translationEnabled === viewSettings.translationEnabled) return;
    saveViewSettings(envConfig, bookKey, 'translationEnabled', translationEnabled, true, false);
    viewSettings.translationEnabled = translationEnabled;
    setViewSettings(bookKey, { ...viewSettings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationEnabled]);

  return (
    <div className={clsx('my-4 w-full space-y-6')}>
      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Language')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <span className=''>{_('Interface Language')}</span>
              <DropDown
                options={getLangOptions()}
                selected={getCurrentUILangOption()}
                onSelect={handleSelectUILang}
                className='dropdown-bottom'
                listClassName='!max-h-60'
              />
            </div>
          </div>
        </div>
      </div>

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Translation')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200'>
            <div className='config-item'>
              <span className=''>{_('Enable Translation')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={translationEnabled}
                onChange={() => setTranslationEnabled(!translationEnabled)}
              />
            </div>

            <div className='config-item'>
              <span className=''>{_('Translation Service')}</span>
              <DropDown
                selected={getCurrentTranslationProviderOption()}
                options={getTranslationProviderOptions()}
                onSelect={handleSelectTranslationProvider}
                disabled={!translationEnabled}
                className='dropdown-top'
              />
            </div>

            <div className='config-item'>
              <span className=''>{_('Translate To')}</span>
              <DropDown
                options={getLangOptions()}
                selected={getCurrentTargetLangOption()}
                onSelect={handleSelectTargetLang}
                disabled={!translationEnabled}
                className='dropdown-top'
                listClassName='!max-h-60'
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LangPanel;
