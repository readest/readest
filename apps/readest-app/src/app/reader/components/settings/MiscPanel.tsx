import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getStyles } from '@/utils/style';
import { useTheme } from '@/hooks/useTheme';
import cssbeautify from 'cssbeautify';
import cssValidate from '@/utils/css';

const MiscPanel: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { settings, isFontLayoutSettingsGlobal, setSettings } = useSettingsStore();
  const { getView, getViewSettings, setViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey)!;
  const { themeCode } = useTheme();

  const [animated, setAnimated] = useState(viewSettings.animated!);
  const [isDisableClick, setIsDisableClick] = useState(viewSettings.disableClick!);
  const [draftStylesheet, setDraftStylesheet] = useState(viewSettings.userStylesheet!);
  const [draftStylesheetSaved, setDraftStylesheetSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    setViewSettings(bookKey, viewSettings);

    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.userStylesheet = formattedCSS;
      setSettings(settings);
    }

    getView(bookKey)?.renderer.setStyles?.(getStyles(viewSettings, themeCode));
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
  };

  useEffect(() => {
    viewSettings.animated = animated;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.animated = animated;
      setSettings(settings);
    }
    if (animated) {
      getView(bookKey)?.renderer.setAttribute('animated', '');
    } else {
      getView(bookKey)?.renderer.removeAttribute('animated');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animated]);

  useEffect(() => {
    viewSettings.disableClick = isDisableClick;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.disableClick = isDisableClick;
      setSettings(settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDisableClick]);

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Animation')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-y'>
            <div className='config-item config-item-top config-item-bottom'>
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
          <div className='divide-y'>
            <div className='config-item config-item-top config-item-bottom'>
              <span className=''>{_('Disable Click-to-Flip')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={isDisableClick}
                onChange={() => setIsDisableClick(!isDisableClick)}
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
              className={clsx(
                'textarea textarea-ghost h-48 w-full border-0 p-3 text-base !outline-none sm:text-sm',
                'placeholder:text-base-content/70',
              )}
              placeholder={_('Enter your custom CSS here...')}
              spellCheck='false'
              value={draftStylesheet}
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
