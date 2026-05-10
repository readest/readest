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
import { annotationToolQuickActions } from '@/app/reader/components/annotator/AnnotationTools';
import { BoxedList, SettingsRow, SettingsSelect, SettingsSwitchRow } from './primitives';
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
  const [noContinuousScroll, setNoContinuousScroll] = useState(viewSettings.noContinuousScroll);
  const [scrollingOverlap, setScrollingOverlap] = useState(viewSettings.scrollingOverlap);
  const [hideScrollbar, setHideScrollbar] = useState(viewSettings.hideScrollbar || false);
  const [volumeKeysToFlip, setVolumeKeysToFlip] = useState(viewSettings.volumeKeysToFlip);
  const [showPaginationButtons, setShowPaginationButtons] = useState(
    viewSettings.showPaginationButtons,
  );
  const [isDisableClick, setIsDisableClick] = useState(viewSettings.disableClick);
  const [fullscreenClickArea, setFullscreenClickArea] = useState(viewSettings.fullscreenClickArea);
  const [swapClickArea, setSwapClickArea] = useState(viewSettings.swapClickArea);
  const [isDisableDoubleClick, setIsDisableDoubleClick] = useState(viewSettings.disableDoubleClick);
  const [enableAnnotationQuickActions, setEnableAnnotationQuickActions] = useState(
    viewSettings.enableAnnotationQuickActions,
  );
  const [annotationQuickAction, setAnnotationQuickAction] = useState(
    viewSettings.annotationQuickAction,
  );
  const [copyToNotebook, setCopyToNotebook] = useState(viewSettings.copyToNotebook);
  const [animated, setAnimated] = useState(viewSettings.animated);
  const [isEink, setIsEink] = useState(viewSettings.isEink);
  const [isColorEink, setIsColorEink] = useState(viewSettings.isColorEink);
  const [autoScreenBrightness, setAutoScreenBrightness] = useState(settings.autoScreenBrightness);
  const [screenWakeLock, setScreenWakeLock] = useState(settings.screenWakeLock);
  const [allowScript, setAllowScript] = useState(viewSettings.allowScript);

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      scrolled: setScrolledMode,
      noContinuousScroll: setNoContinuousScroll,
      scrollingOverlap: setScrollingOverlap,
      hideScrollbar: setHideScrollbar,
      volumeKeysToFlip: setVolumeKeysToFlip,
      showPaginationButtons: setShowPaginationButtons,
      disableClick: setIsDisableClick,
      swapClickArea: setSwapClickArea,
      animated: setAnimated,
      isEink: setIsEink,
      allowScript: setAllowScript,
      fullscreenClickArea: setFullscreenClickArea,
      disableDoubleClick: setIsDisableDoubleClick,
      enableAnnotationQuickActions: setEnableAnnotationQuickActions,
      copyToNotebook: setCopyToNotebook,
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
    if (noContinuousScroll === viewSettings.noContinuousScroll) return;
    saveViewSettings(envConfig, bookKey, 'noContinuousScroll', noContinuousScroll);
    if (noContinuousScroll) {
      getView(bookKey)?.renderer.setAttribute('no-continuous-scroll', '');
    } else {
      getView(bookKey)?.renderer.removeAttribute('no-continuous-scroll');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noContinuousScroll]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'hideScrollbar', hideScrollbar, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideScrollbar]);

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
    saveViewSettings(
      envConfig,
      bookKey,
      'showPaginationButtons',
      showPaginationButtons,
      false,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPaginationButtons]);

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
    saveViewSettings(envConfig, bookKey, 'isColorEink', isColorEink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isColorEink]);

  useEffect(() => {
    if (autoScreenBrightness === settings.autoScreenBrightness) return;
    saveSysSettings(envConfig, 'autoScreenBrightness', autoScreenBrightness);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScreenBrightness]);

  useEffect(() => {
    if (screenWakeLock === settings.screenWakeLock) return;
    saveSysSettings(envConfig, 'screenWakeLock', screenWakeLock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenWakeLock]);

  useEffect(() => {
    if (viewSettings.allowScript === allowScript) return;
    saveViewSettings(envConfig, bookKey, 'allowScript', allowScript, true, false).then(() => {
      recreateViewer(envConfig, bookKey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowScript]);

  useEffect(() => {
    saveViewSettings(
      envConfig,
      bookKey,
      'enableAnnotationQuickActions',
      enableAnnotationQuickActions,
      false,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableAnnotationQuickActions]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'copyToNotebook', copyToNotebook, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyToNotebook]);

  const getQuickActionOptions = () => {
    return [
      {
        value: '',
        label: _('None'),
      },
      ...annotationToolQuickActions.map((button) => ({
        value: button.type,
        label: _(button.label),
      })),
    ];
  };

  const handleSelectAnnotationQuickAction = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const action = event.target.value as typeof annotationQuickAction;
    setAnnotationQuickAction(action);
    saveViewSettings(envConfig, bookKey, 'annotationQuickAction', action, false, true);
  };

  return (
    <div className='my-4 w-full space-y-6'>
      <BoxedList title={_('Scroll')} data-setting-id='settings.control.scrolledMode'>
        <SettingsSwitchRow
          label={_('Scrolled Mode')}
          checked={isScrolledMode}
          disabled={bookData?.isFixedLayout}
          onChange={() => setScrolledMode(!isScrolledMode)}
        />
        <SettingsSwitchRow
          label={_('Single Section Scroll')}
          checked={noContinuousScroll}
          disabled={!viewSettings.scrolled}
          onChange={() => setNoContinuousScroll(!noContinuousScroll)}
          data-setting-id='settings.control.scroll.noContinuousScroll'
        />
        <NumberInput
          label={_('Overlap Pixels')}
          value={scrollingOverlap}
          onChange={setScrollingOverlap}
          disabled={!viewSettings.scrolled}
          min={0}
          max={200}
          step={10}
          data-setting-id='settings.control.overlapPixels'
        />
        <SettingsSwitchRow
          label={_('Hide Scrollbar')}
          checked={hideScrollbar}
          disabled={!viewSettings.scrolled}
          onChange={() => setHideScrollbar(!hideScrollbar)}
          data-setting-id='settings.control.scroll.hideScrollbar'
        />
      </BoxedList>

      <BoxedList title={_('Pagination')} data-setting-id='settings.control.clickToPaginate'>
        <SettingsSwitchRow
          label={appService?.isMobileApp ? _('Tap to Paginate') : _('Click to Paginate')}
          checked={!isDisableClick}
          onChange={() => setIsDisableClick(!isDisableClick)}
        />
        <SettingsSwitchRow
          label={appService?.isMobileApp ? _('Tap Both Sides') : _('Click Both Sides')}
          checked={fullscreenClickArea}
          disabled={isDisableClick}
          onChange={() => setFullscreenClickArea(!fullscreenClickArea)}
          data-setting-id='settings.control.clickBothSides'
        />
        <SettingsSwitchRow
          label={appService?.isMobileApp ? _('Swap Tap Sides') : _('Swap Click Sides')}
          checked={swapClickArea}
          disabled={isDisableClick || fullscreenClickArea}
          onChange={() => setSwapClickArea(!swapClickArea)}
          data-setting-id='settings.control.swapClickSides'
        />
        <SettingsSwitchRow
          label={appService?.isMobileApp ? _('Disable Double Tap') : _('Disable Double Click')}
          checked={isDisableDoubleClick}
          onChange={() => setIsDisableDoubleClick(!isDisableDoubleClick)}
          data-setting-id='settings.control.disableDoubleClick'
        />
        {appService?.isMobileApp && (
          <SettingsSwitchRow
            label={_('Volume Keys for Page Flip')}
            checked={volumeKeysToFlip}
            onChange={() => setVolumeKeysToFlip(!volumeKeysToFlip)}
          />
        )}
        <SettingsSwitchRow
          label={_('Show Page Navigation Buttons')}
          checked={showPaginationButtons}
          onChange={() => setShowPaginationButtons(!showPaginationButtons)}
          data-setting-id='settings.control.showPaginationButtons'
        />
      </BoxedList>

      <BoxedList
        title={_('Annotation Tools')}
        data-setting-id='settings.control.enableQuickActions'
      >
        <SettingsSwitchRow
          label={_('Enable Quick Actions')}
          checked={enableAnnotationQuickActions}
          onChange={() => setEnableAnnotationQuickActions(!enableAnnotationQuickActions)}
        />
        <SettingsRow label={_('Quick Action')} data-setting-id='settings.control.quickAction'>
          <SettingsSelect
            value={annotationQuickAction || ''}
            onChange={handleSelectAnnotationQuickAction}
            ariaLabel={_('Quick Action')}
            options={getQuickActionOptions()}
            disabled={!enableAnnotationQuickActions}
          />
        </SettingsRow>
        <SettingsSwitchRow
          label={_('Copy to Notebook')}
          checked={copyToNotebook}
          onChange={() => setCopyToNotebook(!copyToNotebook)}
          data-setting-id='settings.control.copyToNotebook'
        />
      </BoxedList>

      <BoxedList title={_('Animation')} data-setting-id='settings.control.pagingAnimation'>
        <SettingsSwitchRow
          label={_('Paging Animation')}
          checked={animated}
          onChange={() => setAnimated(!animated)}
        />
      </BoxedList>

      <BoxedList title={_('Device')} data-setting-id='settings.control.device'>
        {(appService?.isAndroidApp || appService?.appPlatform === 'web') && (
          <SettingsSwitchRow
            label={_('E-Ink Mode')}
            checked={isEink}
            onChange={() => setIsEink(!isEink)}
            data-setting-id='settings.control.einkMode'
          />
        )}
        {(appService?.isAndroidApp || appService?.appPlatform === 'web') && (
          <SettingsSwitchRow
            label={_('Color E-Ink Mode')}
            checked={isColorEink}
            disabled={!isEink}
            onChange={() => setIsColorEink(!isColorEink)}
            data-setting-id='settings.control.colorEinkMode'
          />
        )}
        {appService?.isMobileApp && (
          <SettingsSwitchRow
            label={_('System Screen Brightness')}
            checked={autoScreenBrightness}
            onChange={() => setAutoScreenBrightness(!autoScreenBrightness)}
          />
        )}
        <SettingsSwitchRow
          label={_('Keep Screen Awake')}
          checked={screenWakeLock}
          onChange={() => setScreenWakeLock(!screenWakeLock)}
          data-setting-id='settings.control.screenWakeLock'
        />
      </BoxedList>

      <BoxedList title={_('Security')} data-setting-id='settings.control.allowJavascript'>
        <SettingsSwitchRow
          label={_('Allow JavaScript')}
          description={_('Enable only if you trust the file.')}
          checked={allowScript}
          disabled={bookData?.book?.format !== 'EPUB'}
          onChange={() => setAllowScript(!allowScript)}
        />
      </BoxedList>
    </div>
  );
};

export default ControlPanel;
