import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { saveViewSettings } from '@/helpers/settings';
import {
  getTranslatorDisplayLabel,
  getTranslators,
  isTranslatorAvailable,
} from '@/services/translators';
import { isTranslationAvailable } from '@/services/translators/utils';
import { DEFAULT_PROMPT_ID, isCustomTranslatorName } from '@/services/translators/custom';
import { useCustomTranslatorStore } from '@/store/customTranslatorStore';
import { getLocale } from '@/utils/misc';
import { isCustomTranslatorAllowed } from '@/utils/access';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { TRANSLATED_LANGS, TRANSLATOR_LANGS } from '@/services/constants';
import { ConvertChineseVariant, TranslationFont, TranslationFontStyle } from '@/types/book';
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
import CustomTranslators from './CustomTranslators';
import WordLensPanel from './WordLensPanel';
import ColorInput from './theme/ColorInput';
import { PiTranslate } from 'react-icons/pi';

const LangPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { token, user } = useAuth();
  const { envConfig } = useEnv();
  const hasPremium = isCustomTranslatorAllowed(token);
  const { settings, applyUILanguage, activeSettingsItemId, setActiveSettingsItemId } =
    useSettingsStore();
  const { getView, getViewSettings, setViewSettings, recreateViewer } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [uiLanguage, setUILanguage] = useState(viewSettings.uiLanguage);
  const [translationEnabled, setTranslationEnabled] = useState(viewSettings.translationEnabled);
  const [translationProvider, setTranslationProvider] = useState(viewSettings.translationProvider);
  const [translateTargetLang, setTranslateTargetLang] = useState(viewSettings.translateTargetLang);
  const [translationPromptId, setTranslationPromptId] = useState(
    viewSettings.translationPromptId ?? DEFAULT_PROMPT_ID,
  );
  const customTranslators = useCustomTranslatorStore((s) => s.translators);
  const prompts = useCustomTranslatorStore((s) => s.prompts);
  const [showTranslateSource, setShowTranslateSource] = useState(viewSettings.showTranslateSource);
  const [ttsReadAloudText, setTtsReadAloudText] = useState(viewSettings.ttsReadAloudText);
  const [translationFont, setTranslationFont] = useState<string>(
    viewSettings.translationFont ?? '',
  );
  const [translationFontStyle, setTranslationFontStyle] = useState<string>(
    viewSettings.translationFontStyle ?? 'normal',
  );
  const [translationFontSize, setTranslationFontSize] = useState(
    viewSettings.translationFontSize ?? 1,
  );
  const [translationColor, setTranslationColor] = useState(viewSettings.translationColor ?? '');
  // The color being dragged in the picker; saved only when the picker closes.
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  const [replaceQuotationMarks, setReplaceQuotationMarks] = useState(
    viewSettings.replaceQuotationMarks,
  );
  const [convertChineseVariant, setConvertChineseVariant] = useState(
    viewSettings.convertChineseVariant,
  );
  const [showCustomDictionaries, setShowCustomDictionaries] = useState(false);
  const [showCustomTranslators, setShowCustomTranslators] = useState(false);
  const [showWordLens, setShowWordLens] = useState(false);

  // Translation is unavailable for PDFs and for books already in the target
  // language (issue #5600). The reader toolbar's toggler has always refused
  // those; ungated here, turning it on for a PDF translated the text layer
  // paragraph by paragraph and drained the daily AI translation quota. An
  // already-on book keeps the switch live so it can be turned back off.
  const translationAvailable = isTranslationAvailable(
    getBookData(bookKey)?.book,
    translateTargetLang,
  );

  // Android Back / Esc: when a sub-page is open, intercept and step back to the
  // language list instead of letting <Dialog>'s listener close the whole
  // Settings dialog. See the matching comment in FontPanel.tsx for the
  // LIFO-dispatch reasoning.
  useKeyDownActions({
    enabled: showCustomDictionaries,
    onCancel: () => setShowCustomDictionaries(false),
  });
  useKeyDownActions({
    enabled: showCustomTranslators,
    onCancel: () => setShowCustomTranslators(false),
  });
  useKeyDownActions({
    enabled: showWordLens,
    onCancel: () => setShowWordLens(false),
  });

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
      translationPromptId: setTranslationPromptId,
      showTranslateSource: setShowTranslateSource,
      ttsReadAloudText: setTtsReadAloudText,
      translationFont: setTranslationFont,
      translationFontStyle: setTranslationFontStyle,
      translationFontSize: setTranslationFontSize,
      translationColor: setTranslationColor,
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
      label: getTranslatorDisplayLabel(t, !!token, hasPremium, _),
      // Providers marked `disabled` (e.g. upstream relay is down) stay in the
      // dropdown so users can see them, but cannot be selected.
      disabled: !!t.disabled || (!!t.premiumRequired && !hasPremium),
    }));
  };

  const getCurrentTranslationProviderOption = () => {
    const value = translationProvider;
    const allProviders = getTranslationProviderOptions();
    const availableTranslators = getTranslators().filter((t) =>
      isTranslatorAvailable(t, !!token, hasPremium),
    );
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

  // `customTranslators` makes the options re-render when the store hydrates.
  const isLLMProvider =
    hasPremium &&
    isCustomTranslatorName(translationProvider) &&
    customTranslators.some(
      (t) => `custom:${t.id}` === translationProvider && t.type === 'openai-compatible',
    );

  const getPromptOptions = () => [
    { value: DEFAULT_PROMPT_ID, label: _('Default') },
    ...prompts.filter((p) => !p.deletedAt).map((p) => ({ value: p.id, label: p.name })),
  ];

  const handleSelectPrompt = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value;
    setTranslationPromptId(option);
    saveViewSettings(envConfig, bookKey, 'translationPromptId', option, false, false);
    viewSettings.translationPromptId = option;
    setViewSettings(bookKey, { ...viewSettings });
  };

  // Custom translators are premium: everyone else is routed to the plans page
  // (or sign-in) instead of the sub-page.
  const handleOpenCustomTranslators = () => {
    if (hasPremium) setShowCustomTranslators(true);
    else if (user) navigateToProfile(router);
    else navigateToLogin(router);
  };

  const translationFontOptions = [
    { value: '', label: _('Default') },
    { value: 'serif', label: _('Serif Font') },
    { value: 'sans-serif', label: _('Sans-Serif Font') },
    { value: 'monospace', label: _('Monospace Font') },
  ];

  const translationFontStyleOptions = [
    { value: 'normal', label: _('Normal') },
    { value: 'italic', label: _('Italic') },
    { value: 'bold', label: _('Bold') },
    { value: 'bold-italic', label: _('Bold Italic') },
  ];

  const translationFontSizeOptions = [
    { value: '0.85', label: _('Small') },
    { value: '1', label: _('Default') },
    { value: '1.15', label: _('Large') },
    { value: '1.3', label: _('Extra Large') },
  ];

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
    // The reader's translation hook watches the viewSettings object, which
    // saveViewSettings only mutates; hand it a new one, like the toolbar does.
    setViewSettings(bookKey, { ...viewSettings, translationEnabled });
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
    if (translationFont === (viewSettings.translationFont ?? '')) return;
    saveViewSettings(envConfig, bookKey, 'translationFont', translationFont as TranslationFont);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationFont]);

  useEffect(() => {
    if (translationFontStyle === (viewSettings.translationFontStyle ?? 'normal')) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'translationFontStyle',
      translationFontStyle as TranslationFontStyle,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationFontStyle]);

  useEffect(() => {
    if (translationFontSize === (viewSettings.translationFontSize ?? 1)) return;
    saveViewSettings(envConfig, bookKey, 'translationFontSize', translationFontSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationFontSize]);

  useEffect(() => {
    if (translationColor === (viewSettings.translationColor ?? '')) return;
    saveViewSettings(envConfig, bookKey, 'translationColor', translationColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationColor]);

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

  if (showCustomTranslators) {
    return (
      <div className='w-full'>
        <CustomTranslators
          targetLang={translateTargetLang || getLocale()}
          onBack={() => setShowCustomTranslators(false)}
        />
      </div>
    );
  }

  if (showWordLens) {
    return <WordLensPanel bookKey={bookKey} onBack={() => setShowWordLens(false)} />;
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

      <BoxedList
        title={_('Word Lens')}
        data-setting-id='settings.language.wordlens'
        cardClassName='overflow-hidden'
      >
        <NavigationRow
          icon={PiTranslate}
          title={_('Word Lens')}
          status={_('Show a short native-language hint above difficult words.')}
          onClick={() => setShowWordLens(true)}
        />
      </BoxedList>

      <BoxedList title={_('Translation')} data-setting-id='settings.language.translationEnabled'>
        <SettingsSwitchRow
          label={_('Enable Translation')}
          description={
            bookKey && !translationAvailable ? _('Not available for this book.') : undefined
          }
          checked={translationEnabled}
          onChange={() => setTranslationEnabled(!translationEnabled)}
          disabled={!bookKey || (!translationAvailable && !translationEnabled)}
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
        {isLLMProvider && (
          <SettingsRow label={_('Prompt')} data-setting-id='settings.language.translationPrompt'>
            <SettingsSelect
              value={translationPromptId}
              onChange={handleSelectPrompt}
              ariaLabel={_('Prompt')}
              options={getPromptOptions()}
            />
          </SettingsRow>
        )}
        <SettingsRow label={_('Translate To')} data-setting-id='settings.language.targetLanguage'>
          <SettingsSelect
            value={getCurrentTargetLangOption().value}
            onChange={handleSelectTargetLang}
            ariaLabel={_('Translate To')}
            options={getLangOptions(TRANSLATOR_LANGS)}
          />
        </SettingsRow>
        <NavigationRow
          title={_('Custom Translators')}
          badge={hasPremium ? undefined : _('Premium')}
          onClick={handleOpenCustomTranslators}
          data-setting-id='settings.language.customTranslators'
        />
      </BoxedList>

      <BoxedList title={_('Translated Text')} data-setting-id='settings.language.translatedText'>
        <SettingsRow label={_('Font')}>
          <SettingsSelect
            value={translationFont}
            onChange={(e) => setTranslationFont(e.target.value)}
            ariaLabel={_('Font')}
            options={translationFontOptions}
          />
        </SettingsRow>
        <SettingsRow label={_('Font Style')}>
          <SettingsSelect
            value={translationFontStyle}
            onChange={(e) => setTranslationFontStyle(e.target.value)}
            ariaLabel={_('Font Style')}
            options={translationFontStyleOptions}
          />
        </SettingsRow>
        <SettingsRow label={_('Font Size')}>
          <SettingsSelect
            value={String(translationFontSize)}
            onChange={(e) => setTranslationFontSize(Number(e.target.value) || 1)}
            ariaLabel={_('Font Size')}
            options={translationFontSizeOptions}
          />
        </SettingsRow>
        <SettingsRow
          label={_('Text Color')}
          description={translationColor ? translationColor : _('Default')}
        >
          <div className='flex items-center gap-2'>
            {translationColor && (
              <button
                type='button'
                onClick={() => setTranslationColor('')}
                className='btn btn-ghost btn-xs eink-bordered shrink-0'
              >
                {_('Default')}
              </button>
            )}
            <ColorInput
              label={_('Text Color')}
              value={colorDraft ?? (translationColor || '#808080')}
              onChange={setColorDraft}
              onCommit={() => {
                if (colorDraft) setTranslationColor(colorDraft);
                setColorDraft(null);
              }}
              showPickerIcon
              pickerPosition='right'
            />
          </div>
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
