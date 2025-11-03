import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { useEinkMode } from '@/hooks/useEinkMode';
import { getStyles } from '@/utils/style';
import { getMaxInlineSize } from '@/utils/config';
import { saveSysSettings, saveViewSettings } from '@/helpers/settings';
import { SettingsPanelPanelProp } from './SettingsDialog';
import { RELOAD_BEFORE_SAVED_TIMEOUT_MS } from '@/services/constants';
import NumberInput from './NumberInput';

const ControlPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getView, getViewSettings, recreateViewer } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const { settings } = useSettingsStore();
  const { applyEinkMode } = useEinkMode();
  const { acquireVolumeKeyInterception, releaseVolumeKeyInterception } = useDeviceControlStore();
  const bookData = getBookData(bookKey);
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [isScrolledMode, setScrolledMode] = useState(viewSettings.scrolled);
  const [isContinuousScroll, setIsContinuousScroll] = useState(viewSettings.continuousScroll);
  const [scrollingOverlap, setScrollingOverlap] = useState(viewSettings.scrollingOverlap);
  const [volumeKeysToFlip, setVolumeKeysToFlip] = useState(viewSettings.volumeKeysToFlip);
  const [isDisableClick, setIsDisableClick] = useState(viewSettings.disableClick);
  const [fullscreenClickArea, setFullscreenClickArea] = useState(viewSettings.fullscreenClickArea);
  const [swapClickArea, setSwapClickArea] = useState(viewSettings.swapClickArea);
  const [isDisableDoubleClick, setIsDisableDoubleClick] = useState(viewSettings.disableDoubleClick);
  const [animated, setAnimated] = useState(viewSettings.animated);
  const [isEink, setIsEink] = useState(viewSettings.isEink);
  const [autoScreenBrightness, setAutoScreenBrightness] = useState(settings.autoScreenBrightness);
  const [allowScript, setAllowScript] = useState(viewSettings.allowScript);

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      scrolled: setScrolledMode,
      continuousScroll: setIsContinuousScroll,
      scrollingOverlap: setScrollingOverlap,
      volumeKeysToFlip: setVolumeKeysToFlip,
      disableClick: setIsDisableClick,
      swapClickArea: setSwapClickArea,
      animated: setAnimated,
      isEink: setIsEink,
      allowScript: setAllowScript,
    });
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isScrolledMode === viewSettings.scrolled) return;
    saveViewSettings(envConfig, bookKey, 'scrolled', isScrolledMode);
    getView(bookKey)?.renderer.setAttribute('flow', isScrolledMode ? 'scrolled' : 'paginated');
    getView(bookKey)?.renderer.setAttribute(
      'max-inline-size',
      `${getMaxInlineSize(viewSettings)}px`,
    );
    getView(bookKey)?.renderer.setStyles?.(getStyles(viewSettings!));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScrolledMode]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'continuousScroll', isContinuousScroll, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContinuousScroll]);

  useEffect(() => {
    if (scrollingOverlap === viewSettings.scrollingOverlap) return;
    saveViewSettings(envConfig, bookKey, 'scrollingOverlap', scrollingOverlap, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollingOverlap]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'volumeKeysToFlip', volumeKeysToFlip, false, false);
    if (appService?.isMobileApp) {
      if (volumeKeysToFlip) {
        acquireVolumeKeyInterception();
      } else {
        releaseVolumeKeyInterception();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volumeKeysToFlip]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'disableClick', isDisableClick, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDisableClick]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'disableDoubleClick', isDisableDoubleClick, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDisableDoubleClick]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'fullscreenClickArea', fullscreenClickArea, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreenClickArea]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'swapClickArea', swapClickArea, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapClickArea]);

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
    saveViewSettings(envConfig, bookKey, 'isEink', isEink);
    if (isEink) {
      getView(bookKey)?.renderer.setAttribute('eink', '');
    } else {
      getView(bookKey)?.renderer.removeAttribute('eink');
    }
    applyEinkMode(isEink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEink]);

  useEffect(() => {
    if (autoScreenBrightness === settings.autoScreenBrightness) return;
    saveSysSettings(envConfig, 'autoScreenBrightness', autoScreenBrightness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScreenBrightness]);

  useEffect(() => {
    if (viewSettings.allowScript === allowScript) return;
    saveViewSettings(envConfig, bookKey, 'allowScript', allowScript, true, false);
    setTimeout(() => {
      recreateViewer(envConfig, bookKey);
    }, RELOAD_BEFORE_SAVED_TIMEOUT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowScript]);

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Scroll')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <span className=''>{_('Scrolled Mode')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={isScrolledMode}
                onChange={() => setScrolledMode(!isScrolledMode)}
              />
            </div>
            <div className='config-item'>
              <span className=''>{_('Continuous Scroll')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={isContinuousScroll}
                onChange={() => setIsContinuousScroll(!isContinuousScroll)}
              />
            </div>
            <NumberInput
              label={_('Overlap Pixels')}
              value={scrollingOverlap}
              onChange={setScrollingOverlap}
              disabled={!viewSettings.scrolled}
              min={0}
              max={200}
              step={10}
            />
          </div>
        </div>
      </div>

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Pagination')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200'>
            <div className='config-item'>
              <span className=''>
                {appService?.isMobileApp ? _('Tap to Paginate') : _('Click to Paginate')}
              </span>
              <input
                type='checkbox'
                className='toggle'
                checked={!isDisableClick}
                onChange={() => setIsDisableClick(!isDisableClick)}
              />
            </div>
            <div className='config-item'>
              <span className=''>
                {appService?.isMobileApp ? _('Tap Both Sides') : _('Click Both Sides')}
              </span>
              <input
                type='checkbox'
                className='toggle'
                checked={fullscreenClickArea}
                disabled={isDisableClick}
                onChange={() => setFullscreenClickArea(!fullscreenClickArea)}
              />
            </div>
            <div className='config-item'>
              <span className=''>
                {appService?.isMobileApp ? _('Swap Tap Sides') : _('Swap Click Sides')}
              </span>
              <input
                type='checkbox'
                className='toggle'
                checked={swapClickArea}
                disabled={isDisableClick || fullscreenClickArea}
                onChange={() => setSwapClickArea(!swapClickArea)}
              />
            </div>
            <div className='config-item'>
              <span className=''>
                {appService?.isMobileApp ? _('Disable Double Tap') : _('Disable Double Click')}
              </span>
              <input
                type='checkbox'
                className='toggle'
                checked={isDisableDoubleClick}
                onChange={() => setIsDisableDoubleClick(!isDisableDoubleClick)}
              />
            </div>
            {appService?.isMobileApp && (
              <div className='config-item'>
                <span className=''>{_('Volume Keys for Page Flip')}</span>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={volumeKeysToFlip}
                  onChange={() => setVolumeKeysToFlip(!volumeKeysToFlip)}
                />
              </div>
            )}
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

      {(appService?.isMobileApp || appService?.appPlatform === 'web') && (
        <div className='w-full'>
          <h2 className='mb-2 font-medium'>{_('Device')}</h2>
          <div className='card border-base-200 bg-base-100 border shadow'>
            <div className='divide-base-200 divide-y'>
              {(appService?.isAndroidApp || appService?.appPlatform === 'web') && (
                <div className='config-item'>
                  <span className=''>{_('E-Ink Mode')}</span>
                  <input
                    type='checkbox'
                    className='toggle'
                    checked={isEink}
                    onChange={() => setIsEink(!isEink)}
                  />
                </div>
              )}
              {appService?.isMobileApp && (
                <div className='config-item'>
                  <span className=''>{_('Auto Screen Brightness')}</span>
                  <input
                    type='checkbox'
                    className='toggle'
                    checked={autoScreenBrightness}
                    onChange={() => setAutoScreenBrightness(!autoScreenBrightness)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Security')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item !h-16'>
              <div className='flex flex-col gap-1'>
                <span className=''>{_('Allow JavaScript')}</span>
                <span className='text-xs'>{_('Enable only if you trust the file.')}</span>
              </div>
              <input
                type='checkbox'
                className='toggle'
                checked={allowScript}
                disabled={bookData?.book?.format !== 'EPUB'}
                onChange={() => setAllowScript(!allowScript)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ControlPanel;
