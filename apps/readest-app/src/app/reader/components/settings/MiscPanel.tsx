import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { IoPhoneLandscapeOutline, IoPhonePortraitOutline } from 'react-icons/io5';
import { MdOutlineScreenRotation } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getStyles } from '@/utils/style';
import { lockScreenOrientation } from '@/utils/bridge';
import { saveViewSettings } from '../../utils/viewSettingsHelper';
import cssbeautify from 'cssbeautify';
import cssValidate from '@/utils/css';

const MiscPanel: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, isFontLayoutSettingsGlobal, setSettings } = useSettingsStore();
  const { getView, getViewSettings, setViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey)!;

  const [draftStylesheet, setDraftStylesheet] = useState(viewSettings.userStylesheet!);
  const [draftStylesheetSaved, setDraftStylesheetSaved] = useState(true);
  const [screenOrientation, setScreenOrientation] = useState(viewSettings.screenOrientation!);

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

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'screenOrientation', screenOrientation, false, false);
    if (appService?.isMobileApp) {
      lockScreenOrientation({ orientation: screenOrientation });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenOrientation]);

  return (
    <div
      className={clsx(
        'my-4 w-full space-y-6',
        inputFocusInAndroid && 'h-[50%] overflow-y-auto pb-[200px]',
      )}
    >
      {appService?.isMobileApp && (
        <div className='w-full'>
          <h2 className='mb-2 font-medium'>{_('Screen')}</h2>
          <div className='card border-base-200 bg-base-100 border shadow'>
            <div className='divide-base-200 divide-y'>
              <div className='config-item'>
                <span className=''>{_('Orientation')}</span>
                <div className='flex gap-4'>
                  <div className='lg:tooltip lg:tooltip-bottom' data-tip={_('Auto')}>
                    <button
                      className={`btn btn-ghost btn-circle btn-sm ${screenOrientation === 'auto' ? 'btn-active bg-base-300' : ''}`}
                      onClick={() => setScreenOrientation('auto')}
                    >
                      <MdOutlineScreenRotation />
                    </button>
                  </div>

                  <div className='lg:tooltip lg:tooltip-bottom' data-tip={_('Portrait')}>
                    <button
                      className={`btn btn-ghost btn-circle btn-sm ${screenOrientation === 'portrait' ? 'btn-active bg-base-300' : ''}`}
                      onClick={() => setScreenOrientation('portrait')}
                    >
                      <IoPhonePortraitOutline />
                    </button>
                  </div>

                  <div className='lg:tooltip lg:tooltip-bottom' data-tip={_('Landscape')}>
                    <button
                      className={`btn btn-ghost btn-circle btn-sm ${screenOrientation === 'landscape' ? 'btn-active bg-base-300' : ''}`}
                      onClick={() => setScreenOrientation('landscape')}
                    >
                      <IoPhoneLandscapeOutline />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
