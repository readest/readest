import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { saveViewSettings } from '@/helpers/settings';
import {
  getTranslatorDisplayLabel,
  getTranslators,
  isTranslatorAvailable,
} from '@/services/translators';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { TRANSLATED_LANGS, TRANSLATOR_LANGS } from '@/services/constants';
import { ConvertChineseVariant } from '@/types/book';
import { SettingsPanelPanelProp } from './SettingsDialog';
import { getDirFromLanguage } from '@/utils/rtl';
import { isCJKEnv } from '@/utils/misc';
import {
  BoxedList,
  NavigationRow,
  SettingsRow,
  SettingsSelect,
  SettingsSwitchRow,
} from './primitives';
import CustomDictionaries from './CustomDictionaries';

const LangPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { token } = useAuth();
  const { envConfig } = useEnv();
  const { settings, applyUILanguage, activeSettingsItemId, setActiveSettingsItemId } =
    useSettingsStore();
  const { getView, getViewSettings, setViewSettings, recreateViewer } = useReaderStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [uiLanguage, setUILanguage] = useState(viewSettings.uiLanguage);
  const [translationEnabled, setTranslationEnabled] = useState(viewSettings.translationEnabled);
  const [translationProvider, setTranslationProvider] = useState(viewSettings.translationProvider);
  const [translateTargetLang, setTranslateTargetLang] = useState(viewSettings.translateTargetLang);
  const [showTranslateSource, setShowTranslateSource] = useState(viewSettings.showTranslateSource);
  const [ttsReadAloudText, setTtsReadAloudText] = useState(viewSettings.ttsReadAloudText);
  const [replaceQuotationMarks, setReplaceQuotationMarks] = useState(
    viewSettings.replaceQuotationMarks,
  );
  const [convertChineseVariant, setConvertChineseVariant] = useState(
    viewSettings.convertChineseVariant,
  );
  const [showCustomDictionaries, setShowCustomDictionaries] = useState(false);

  // Deep-link: callers (e.g. the dictionary popup's manage icon) can set
  // activeSettingsItemId to `'settings.language.dictionaries.manage'` to
  // jump straight into the Manage Dictionaries sub-page on open. Clear the
  // id once consumed so SettingsDialog's scroll-to-element fallback
  // (which runs on a 100ms timeout) doesn't re-fire.
  useEffect(() => {
    if (activeSettingsItemId === 'settings.language.dictionaries.manage') {
      setShowCustomDictionaries(true);
      setActiveSettingsItemId(null);
    }
  }, [activeSettingsItemId, setActiveSettingsItemId]);

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      uiLanguage: setUILanguage,
      translationEnabled: setTranslationEnabled,
      translationProvider: setTranslationProvider,
      translateTargetLang: setTranslateTargetLang,
      showTranslateSource: setShowTranslateSource,
      ttsReadAloudText: setTtsReadAloudText,
      replaceQuotationMarks: setReplaceQuotationMarks,
    });
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCurrentUILangOption = () => {
    const uiLanguage = viewSettings.uiLanguage;
    return {
      value: uiLanguage,
      label:
        uiLanguage === ''
          ? _('Auto')
          : TRANSLATED_LANGS[uiLanguage as keyof typeof TRANSLATED_LANGS],
    };
  };

  const getLangOptions = (langs: Record<string, string>) => {
    const options = Object.entries(langs).map(([value, label]) => ({ value, label }));
    options.sort((a, b) => a.label.localeCompare(b.label));
    options.unshift({ value: '', label: _('System Language') });
    return options;
  };

  const handleSelectUILang = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value;
    setUILanguage(option);
  };

  const getTranslationProviderOptions = () => {
    return getTranslators().map((t) => ({
      value: t.name,
      label: getTranslatorDisplayLabel(t, !!token, _),
      // Providers marked `disabled` (e.g. upstream relay is down) stay in the
      // dropdown so users can see them, but cannot be selected.
      disabled: !!t.disabled,
    }));
  };

  const getCurrentTranslationProviderOption = () => {
    const value = translationProvider;
    const allProviders = getTranslationProviderOptions();
    const availableTranslators = getTranslators().filter((t) => isTranslatorAvailable(t, !!token));
    const currentProvider = availableTranslators.find((t) => t.name === value)
      ? value
      : availableTranslators[0]?.name;
    return allProviders.find((p) => p.value === currentProvider) || allProviders[0]!;
  };

  const handleSelectTranslationProvider = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value;
    setTranslationProvider(option);
    saveViewSettings(envConfig, bookKey, 'translationProvider', option, false, false);
    viewSettings.translationProvider = option;
    setViewSettings(bookKey, { ...viewSettings });
  };

  const getCurrentTargetLangOption = () => {
    const value = translateTargetLang;
    const availableOptions = getLangOptions(TRANSLATOR_LANGS);
    return availableOptions.find((o) => o.value === value) || availableOptions[0]!;
  };

  const handleSelectTargetLang = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value;
    setTranslateTargetLang(option);
    saveViewSettings(envConfig, bookKey, 'translateTargetLang', option, false, false);
    viewSettings.translateTargetLang = option;
    setViewSettings(bookKey, { ...viewSettings });
  };

  const handleSelectTTSText = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value;
    setTtsReadAloudText(option);
    saveViewSettings(envConfig, bookKey, 'ttsReadAloudText', option, false, false);
  };

  const getTTSTextOptions = () => {
    return [
      { value: 'both', label: _('Source and Translated') },
      { value: 'translated', label: _('Translated Only') },
      { value: 'source', label: _('Source Only') },
    ];
  };

  useEffect(() => {
    if (uiLanguage === viewSettings.uiLanguage) return;
    const sameDir = getDirFromLanguage(uiLanguage) === getDirFromLanguage(viewSettings.uiLanguage);
    applyUILanguage(uiLanguage);
    saveViewSettings(envConfig, bookKey, 'uiLanguage', uiLanguage, false, false).then(() => {
      if (!sameDir) window.location.reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiLanguage]);

  useEffect(() => {
    if (translationEnabled === viewSettings.translationEnabled) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'translationEnabled',
      translationEnabled,
      true,
      false,
    ).then(() => {
      if (!showTranslateSource && translationEnabled) {
        recreateViewer(envConfig, bookKey);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationEnabled]);

  useEffect(() => {
    if (showTranslateSource === viewSettings.showTranslateSource) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'showTranslateSource',
      showTranslateSource,
      false,
      false,
    ).then(() => {
      recreateViewer(envConfig, bookKey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTranslateSource]);

  useEffect(() => {
    if (ttsReadAloudText === viewSettings.ttsReadAloudText) return;
    saveViewSettings(envConfig, bookKey, 'ttsReadAloudText', ttsReadAloudText, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsReadAloudText]);

  useEffect(() => {
    if (replaceQuotationMarks === viewSettings.replaceQuotationMarks) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'replaceQuotationMarks',
      replaceQuotationMarks,
      false,
      false,
    ).then(() => {
      recreateViewer(envConfig, bookKey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaceQuotationMarks]);

  const getConvertModeOptions: () => { value: ConvertChineseVariant; label: string }[] = () => {
    return [
      { value: 'none', label: _('No Conversion') },
      { value: 's2t', label: _('Simplified to Traditional') },
      { value: 't2s', label: _('Traditional to Simplified') },
      { value: 's2tw', label: _('Simplified to Traditional (Taiwan)') },
      { value: 's2hk', label: _('Simplified to Traditional (Hong Kong)') },
      { value: 's2twp', label: _('Simplified to Traditional (Taiwan), with phrases') },
      { value: 'tw2s', label: _('Traditional (Taiwan) to Simplified') },
      { value: 'hk2s', label: _('Traditional (Hong Kong) to Simplified') },
      { value: 'tw2sp', label: _('Traditional (Taiwan) to Simplified, with phrases') },
    ];
  };

  const getConvertModeOption = () => {
    const value = convertChineseVariant;
    const availableOptions = getConvertModeOptions();
    return availableOptions.find((o) => o.value === value) || availableOptions[0]!;
  };

  const handleSelectConvertMode = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value as ConvertChineseVariant;
    setConvertChineseVariant(option);
  };

  useEffect(() => {
    if (convertChineseVariant === viewSettings.convertChineseVariant) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'convertChineseVariant',
      convertChineseVariant,
      false,
      false,
    ).then(() => {
      recreateViewer(envConfig, bookKey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convertChineseVariant]);

  if (showCustomDictionaries) {
    return (
      <div className='my-4 w-full'>
        <CustomDictionaries onBack={() => setShowCustomDictionaries(false)} />
      </div>
    );
  }

  return (
    <div className={clsx('my-4 w-full space-y-6')}>
      <BoxedList title={_('Language')} data-setting-id='settings.language.interfaceLanguage'>
        <SettingsRow label={_('Language')}>
          <SettingsSelect
            value={getCurrentUILangOption().value}
            onChange={handleSelectUILang}
            ariaLabel={_('Language')}
            options={getLangOptions(TRANSLATED_LANGS)}
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList
        title={_('Dictionaries')}
        data-setting-id='settings.language.dictionaries'
        cardClassName='overflow-hidden'
      >
        <NavigationRow
          title={_('Manage Dictionaries')}
          onClick={() => setShowCustomDictionaries(true)}
          className='h-14'
        />
      </BoxedList>

      <BoxedList title={_('Translation')} data-setting-id='settings.language.translationEnabled'>
        <SettingsSwitchRow
          label={_('Enable Translation')}
          checked={translationEnabled}
          onChange={() => setTranslationEnabled(!translationEnabled)}
          disabled={!bookKey}
        />
        <SettingsSwitchRow
          label={_('Show Source Text')}
          checked={showTranslateSource}
          onChange={() => setShowTranslateSource(!showTranslateSource)}
        />
        <SettingsRow label={_('TTS Text')} data-setting-id='settings.language.ttsTextTranslation'>
          <SettingsSelect
            value={ttsReadAloudText}
            onChange={handleSelectTTSText}
            ariaLabel={_('TTS Text')}
            options={getTTSTextOptions()}
          />
        </SettingsRow>
        <SettingsRow
          label={_('Translation Service')}
          data-setting-id='settings.language.translationProvider'
        >
          <SettingsSelect
            value={getCurrentTranslationProviderOption().value}
            onChange={handleSelectTranslationProvider}
            ariaLabel={_('Translation Service')}
            options={getTranslationProviderOptions()}
          />
        </SettingsRow>
        <SettingsRow label={_('Translate To')} data-setting-id='settings.language.targetLanguage'>
          <SettingsSelect
            value={getCurrentTargetLangOption().value}
            onChange={handleSelectTargetLang}
            ariaLabel={_('Translate To')}
            options={getLangOptions(TRANSLATOR_LANGS)}
          />
        </SettingsRow>
      </BoxedList>

      {(isCJKEnv() || view?.language.isCJK) && (
        <BoxedList title={_('Punctuation')} data-setting-id='settings.language.quotationMarks'>
          <SettingsSwitchRow
            label={_('Replace Quotation Marks')}
            description={_('Enabled only in vertical layout.')}
            checked={replaceQuotationMarks}
            onChange={() => setReplaceQuotationMarks(!replaceQuotationMarks)}
          />
        </BoxedList>
      )}

      {(isCJKEnv() || view?.language.isCJK) && (
        <BoxedList
          title={_('Convert Simplified and Traditional Chinese')}
          data-setting-id='settings.language.chineseConversion'
        >
          <SettingsRow label={_('Convert Mode')}>
            <SettingsSelect
              value={getConvertModeOption().value}
              onChange={handleSelectConvertMode}
              ariaLabel={_('Convert Mode')}
              options={getConvertModeOptions()}
            />
          </SettingsRow>
        </BoxedList>
      )}
    </div>
  );
};

export default LangPanel;
