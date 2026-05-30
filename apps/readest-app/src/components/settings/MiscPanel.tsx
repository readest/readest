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
import { BoxedList } from './primitives';

type CSSType = 'book' | 'reader';

const MiscPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const { settings } = useSettingsStore();
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
    } else {
      setDraftUIStylesheet(formattedCSS);
      setDraftUIStylesheetSaved(true);
      viewSettings.userUIStylesheet = formattedCSS;
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

  const handleInputFocus = (textareaRef: React.RefObject<HTMLTextAreaElement | null>) => {
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
    textareaRef: React.RefObject<HTMLTextAreaElement | null>,
    settingId?: string,
  ) => (
    <div className='w-full'>
      <BoxedList title={_(title)} data-setting-id={settingId} innerClassName='!ps-0'>
        {/* Single full-width child instead of typical settings rows — the
            textarea owns the whole card surface. Apply button overlays at
            the bottom-trailing corner; visible only when there are unsaved
            edits and no validation error. */}
        <div className={clsx('relative p-1', error && 'ring-error/60 rounded-2xl ring-1')}>
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
              'hover:bg-base-300 bg-base-200 absolute bottom-2 end-4 inline-flex h-8 items-center rounded-md px-3 text-xs font-medium transition-colors duration-150',
              'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
              saved ? 'hidden' : '',
              error ? 'pointer-events-none opacity-50' : '',
            )}
            onClick={() => applyStyles(type)}
            disabled={!!error}
          >
            {_('Apply')}
          </button>
        </div>
      </BoxedList>
      {error && <p className='text-error mt-1 ps-4 text-sm'>{error}</p>}
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
        'settings.custom.contentCss',
      )}

      {renderCSSEditor(
        'reader',
        _('Custom Reader UI CSS'),
        _('Enter CSS for reader interface styling...'),
        draftUIStylesheet,
        uiError,
        draftUIStylesheetSaved,
        uiTextareaRef,
        'settings.custom.readerUiCss',
      )}
    </div>
  );
};

export default MiscPanel;
