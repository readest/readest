import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { SettingsPanelPanelProp } from './SettingsDialog';
import { saveViewSettings } from '@/helpers/settings';
import { validateCSS, formatCSS } from '@/utils/css';
import { getStyles } from '@/utils/style';

type CSSType = 'book' | 'reader';

const MiscPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const { settings, isSettingsGlobal, setSettings } = useSettingsStore();
  const { getView, getViewSettings, setViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [draftContentStylesheet, setDraftContentStylesheet] = useState(viewSettings.userStylesheet);
  const [draftContentStylesheetSaved, setDraftContentStylesheetSaved] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);
  const [draftUIStylesheet, setDraftUIStylesheet] = useState(viewSettings.userUIStylesheet);
  const [draftUIStylesheetSaved, setDraftUIStylesheetSaved] = useState(true);
  const [uiError, setUIError] = useState<string | null>(null);

  const [inputFocusInAndroid, setInputFocusInAndroid] = useState(false);
  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const uiTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      userStylesheet: setDraftContentStylesheet,
      userUIStylesheet: setDraftUIStylesheet,
    });
    applyStyles('book', true);
    applyStyles('reader', true);
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleValidateCSS = (cssInput: string): { isValid: boolean; error?: string } => {
    if (!cssInput.trim()) return { isValid: true };

    try {
      const { isValid, error } = validateCSS(cssInput);
      if (!isValid) {
        return { isValid: false, error: error || 'Invalid CSS' };
      }
      return { isValid: true };
    } catch (err: unknown) {
      if (err instanceof Error) {
        return { isValid: false, error: err.message };
      }
      return { isValid: false, error: 'Invalid CSS: Please check your input.' };
    }
  };

  const handleStylesheetChange = (e: React.ChangeEvent<HTMLTextAreaElement>, type: CSSType) => {
    const cssInput = e.target.value;

    if (type === 'book') {
      setDraftContentStylesheet(cssInput);
      setDraftContentStylesheetSaved(false);

      const { isValid, error } = handleValidateCSS(cssInput);
      setContentError(isValid ? null : error || 'Invalid CSS');
    } else {
      setDraftUIStylesheet(cssInput);
      setDraftUIStylesheetSaved(false);

      const { isValid, error } = handleValidateCSS(cssInput);
      setUIError(isValid ? null : error || 'Invalid CSS');
    }
  };

  const applyStyles = (type: CSSType, clear = false) => {
    const cssInput = type === 'book' ? draftContentStylesheet : draftUIStylesheet;
    const formattedCSS = formatCSS(clear ? '' : cssInput);

    if (type === 'book') {
      setDraftContentStylesheet(formattedCSS);
      setDraftContentStylesheetSaved(true);
      viewSettings.userStylesheet = formattedCSS;

      if (isSettingsGlobal) {
        settings.globalViewSettings.userStylesheet = formattedCSS;
        setSettings(settings);
      }
    } else {
      setDraftUIStylesheet(formattedCSS);
      setDraftUIStylesheetSaved(true);
      viewSettings.userUIStylesheet = formattedCSS;

      if (isSettingsGlobal) {
        settings.globalViewSettings.userUIStylesheet = formattedCSS;
        setSettings(settings);
      }
    }

    setViewSettings(bookKey, { ...viewSettings });
    getView(bookKey)?.renderer.setStyles?.(getStyles(viewSettings));
    saveViewSettings(
      envConfig,
      bookKey,
      type === 'book' ? 'userStylesheet' : 'userUIStylesheet',
      formattedCSS,
      false,
      false,
    );
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
  };

  const handleInputFocus = (textareaRef: React.RefObject<HTMLTextAreaElement>) => {
    if (appService?.isAndroidApp) {
      setInputFocusInAndroid(true);
    }
    setTimeout(() => {
      textareaRef.current?.scrollIntoView({
        behavior: 'instant',
        block: 'center',
      });
    }, 300);
  };

  const handleInputBlur = () => {
    if (appService?.isAndroidApp) {
      setTimeout(() => {
        setInputFocusInAndroid(false);
      }, 100);
    }
  };

  const renderCSSEditor = (
    type: CSSType,
    title: string,
    placeholder: string,
    value: string,
    error: string | null,
    saved: boolean,
    textareaRef: React.RefObject<HTMLTextAreaElement>,
  ) => (
    <div className='w-full'>
      <h2 className='mb-2 font-medium' aria-label={_(title)}>
        {_(title)}
      </h2>
      <div
        className={`card border-base-200 bg-base-100 border shadow ${error ? 'border-red-500' : ''}`}
      >
        <div className='relative p-1'>
          <textarea
            ref={textareaRef}
            className={clsx(
              'textarea textarea-ghost h-48 w-full border-0 p-3 text-base !outline-none sm:text-sm',
              'placeholder:text-base-content/70',
            )}
            placeholder={_(placeholder)}
            spellCheck='false'
            value={value}
            onFocus={() => handleInputFocus(textareaRef)}
            onBlur={handleInputBlur}
            onInput={handleInput}
            onKeyDown={handleInput}
            onKeyUp={handleInput}
            onChange={(e) => handleStylesheetChange(e, type)}
          />
          <button
            className={clsx(
              'btn btn-ghost bg-base-200 absolute bottom-2 right-4 h-8 min-h-8 px-4 py-2',
              saved ? 'hidden' : '',
              error ? 'btn-disabled' : '',
            )}
            onClick={() => applyStyles(type)}
            disabled={!!error}
          >
            {_('Apply')}
          </button>
        </div>
      </div>
      {error && <p className='mt-1 text-sm text-red-500'>{error}</p>}
    </div>
  );

  return (
    <div
      className={clsx(
        'my-4 w-full space-y-6',
        inputFocusInAndroid && 'h-[50%] overflow-y-auto pb-[200px]',
      )}
    >
      {renderCSSEditor(
        'book',
        _('Custom Content CSS'),
        _('Enter CSS for book content styling...'),
        draftContentStylesheet,
        contentError,
        draftContentStylesheetSaved,
        contentTextareaRef,
      )}

      {renderCSSEditor(
        'reader',
        _('Custom Reader UI CSS'),
        _('Enter CSS for reader interface styling...'),
        draftUIStylesheet,
        uiError,
        draftUIStylesheetSaved,
        uiTextareaRef,
      )}
    </div>
  );
};

export default MiscPanel;
