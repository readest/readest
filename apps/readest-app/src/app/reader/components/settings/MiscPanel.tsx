import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import i18n from 'i18next';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getStyles } from '@/utils/style';
import { saveViewSettings } from '../../utils/viewSettingsHelper';
import { TRANSLATED_LANGS } from '@/services/constants';
import cssbeautify from 'cssbeautify';
import cssValidate from '@/utils/css';
import DropDown from './DropDown';

const MiscPanel: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, isFontLayoutSettingsGlobal, setSettings } = useSettingsStore();
  const { getView, getViewSettings, setViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey)!;

  const [animated, setAnimated] = useState(viewSettings.animated!);
  const [isDisableClick, setIsDisableClick] = useState(viewSettings.disableClick!);
  const [swapClickArea, setSwapClickArea] = useState(viewSettings.swapClickArea!);
  const [isContinuousScroll, setIsContinuousScroll] = useState(viewSettings.continuousScroll!);
  const [draftStylesheet, setDraftStylesheet] = useState(viewSettings.userStylesheet!);
  const [draftStylesheetSaved, setDraftStylesheetSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inputFocusInAndroid, setInputFocusInAndroid] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleUserStylesheetChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const cssInput = e.target.value;
    setDraftStylesheet(cssInput);
    setDraftStylesheetSaved(false);

    try {
      const { isValid, error } = cssValidate(cssInput);
      if (cssInput && !isValid) {
        throw new Error(error || 'Invalid CSS');
      }
      setError(null);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Invalid CSS: Please check your input.');
      }
      console.log('CSS Error:', err);
    }
  };

  const applyStyles = () => {
    const formattedCSS = cssbeautify(draftStylesheet, {
      indent: '  ',
      openbrace: 'end-of-line',
      autosemicolon: true,
    });

    setDraftStylesheet(formattedCSS);
    setDraftStylesheetSaved(true);
    viewSettings.userStylesheet = formattedCSS;
    setViewSettings(bookKey, { ...viewSettings });

    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.userStylesheet = formattedCSS;
      setSettings(settings);
    }

    getView(bookKey)?.renderer.setStyles?.(getStyles(viewSettings));
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
  };

  const handleInputFocus = () => {
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

  const getUILangOptions = () => {
    const langs = TRANSLATED_LANGS as Record<string, string>;
    const options = Object.entries(langs).map(([option, label]) => ({ option, label }));
    options.sort((a, b) => a.label.localeCompare(b.label));
    options.unshift({ option: '', label: _('Auto') });
    return options;
  };

  const handleSelectUILang = (option: string) => {
    saveViewSettings(envConfig, bookKey, 'uiLanguage', option, false, false);
    i18n.changeLanguage(option ? option : navigator.language);
  };

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'animated', animated, false, false);
    if (animated) {
      getView(bookKey)?.renderer.setAttribute('animated', '');
    } else {
      getView(bookKey)?.renderer.removeAttribute('animated');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animated]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'disableClick', isDisableClick, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDisableClick]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'swapClickArea', swapClickArea, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapClickArea]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'continuousScroll', isContinuousScroll, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContinuousScroll]);

  return (
    <div
      className={clsx(
        'my-4 w-full space-y-6',
        inputFocusInAndroid && 'h-[50%] overflow-y-auto pb-[200px]',
      )}
    >
      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Language')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <span className=''>{_('Language')}</span>
              <DropDown
                selected={getCurrentUILangOption()}
                options={getUILangOptions()}
                onSelect={handleSelectUILang}
              />
            </div>
          </div>
        </div>
      </div>

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Animation')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <span className=''>{_('Paging Animation')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={animated}
                onChange={() => setAnimated(!animated)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Behavior')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <span className=''>{_('Continuous Scroll')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={isContinuousScroll}
                onChange={() => setIsContinuousScroll(!isContinuousScroll)}
              />
            </div>
            <div className='config-item'>
              <span className=''>{_('Disable Click-to-Flip')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={isDisableClick}
                onChange={() => setIsDisableClick(!isDisableClick)}
              />
            </div>
            <div className='config-item'>
              <span className=''>{_('Swap Click-to-Flip Area')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={swapClickArea}
                disabled={isDisableClick}
                onChange={() => setSwapClickArea(!swapClickArea)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Custom CSS')}</h2>
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
              placeholder={_('Enter your custom CSS here...')}
              spellCheck='false'
              value={draftStylesheet}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              onInput={handleInput}
              onKeyDown={handleInput}
              onKeyUp={handleInput}
              onChange={handleUserStylesheetChange}
            />
            <button
              className={clsx(
                'btn btn-ghost bg-base-200 absolute bottom-2 right-4 h-8 min-h-8 px-4 py-2',
                draftStylesheetSaved ? 'hidden' : '',
                error ? 'btn-disabled' : '',
              )}
              onClick={applyStyles}
              disabled={!!error}
            >
              {_('Apply')}
            </button>
          </div>
        </div>
        {error && <p className='mt-1 text-sm text-red-500'>{error}</p>}
      </div>
    </div>
  );
};

export default MiscPanel;
