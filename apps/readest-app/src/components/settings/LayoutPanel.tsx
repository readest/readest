import React, { useEffect, useState } from 'react';
import { MdOutlineAutoMode, MdOutlineScreenRotation } from 'react-icons/md';
import { MdOutlineTextRotationNone, MdTextRotateVertical } from 'react-icons/md';
import { IoPhoneLandscapeOutline, IoPhonePortraitOutline } from 'react-icons/io5';
import { TbTextDirectionRtl } from 'react-icons/tb';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { isCJKEnv } from '@/utils/misc';
import { getStyles } from '@/utils/style';
import { getMaxInlineSize } from '@/utils/config';
import { lockScreenOrientation } from '@/utils/bridge';
import { saveViewSettings } from '@/helpers/settings';
import { getBookDirFromWritingMode, getBookLangCode } from '@/utils/book';
import { MIGHT_BE_RTL_LANGS, RELOAD_BEFORE_SAVED_TIMEOUT_MS } from '@/services/constants';
import { SettingsPanelPanelProp } from './SettingsDialog';
import Select from '@/components/Select';
import NumberInput from './NumberInput';

const LayoutPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getView, getViewSettings, getGridInsets } = useReaderStore();
  const { setViewSettings, recreateViewer } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const view = getView(bookKey);
  const bookData = getBookData(bookKey);
  const gridInsets = getGridInsets(bookKey) || { top: 0, bottom: 0, left: 0, right: 0 };

  const [paragraphMargin, setParagraphMargin] = useState(viewSettings.paragraphMargin);
  const [lineHeight, setLineHeight] = useState(viewSettings.lineHeight);
  const [wordSpacing, setWordSpacing] = useState(viewSettings.wordSpacing);
  const [letterSpacing, setLetterSpacing] = useState(viewSettings.letterSpacing);
  const [textIndent, setTextIndent] = useState(viewSettings.textIndent!);
  const [fullJustification, setFullJustification] = useState(viewSettings.fullJustification);
  const [hyphenation, setHyphenation] = useState(viewSettings.hyphenation);
  const [marginTopPx, setMarginTopPx] = useState(viewSettings.marginPx || viewSettings.marginTopPx);
  const [marginBottomPx, setMarginBottomPx] = useState(viewSettings.marginBottomPx);
  const [marginLeftPx, setMarginLeftPx] = useState(viewSettings.marginLeftPx);
  const [marginRightPx, setMarginRightPx] = useState(viewSettings.marginRightPx);
  const [compactMarginTopPx, setCompactMarginTopPx] = useState(
    viewSettings.compactMarginPx || viewSettings.compactMarginTopPx,
  );
  const [compactMarginBottomPx, setCompactMarginBottomPx] = useState(
    viewSettings.compactMarginBottomPx,
  );
  const [gapPercent, setGapPercent] = useState(viewSettings.gapPercent);
  const [compactMarginLeftPx, setCompactMarginLeftPx] = useState(viewSettings.compactMarginLeftPx);
  const [compactMarginRightPx, setCompactMarginRightPx] = useState(
    viewSettings.compactMarginRightPx,
  );
  const [maxColumnCount, setMaxColumnCount] = useState(viewSettings.maxColumnCount);
  const [maxInlineSize, setMaxInlineSize] = useState(viewSettings.maxInlineSize);
  const [maxBlockSize, setMaxBlockSize] = useState(viewSettings.maxBlockSize);
  const [writingMode, setWritingMode] = useState(viewSettings.writingMode);
  const [overrideLayout, setOverrideLayout] = useState(viewSettings.overrideLayout);
  const [doubleBorder, setDoubleBorder] = useState(viewSettings.doubleBorder);
  const [borderColor, setBorderColor] = useState(viewSettings.borderColor);
  const [showHeader, setShowHeader] = useState(viewSettings.showHeader);
  const [showFooter, setShowFooter] = useState(viewSettings.showFooter);
  const [showBarsOnScroll, setShowBarsOnScroll] = useState(viewSettings.showBarsOnScroll);
  const [showRemainingTime, setShowRemainingTime] = useState(viewSettings.showRemainingTime);
  const [showRemainingPages, setShowRemainingPages] = useState(viewSettings.showRemainingPages);
  const [showProgressInfo, setShowProgressInfo] = useState(viewSettings.showProgressInfo);
  const [progressStyle, setProgressStyle] = useState(viewSettings.progressStyle);
  const [screenOrientation, setScreenOrientation] = useState(viewSettings.screenOrientation);
  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      paragraphMargin: setParagraphMargin,
      lineHeight: setLineHeight,
      wordSpacing: setWordSpacing,
      letterSpacing: setLetterSpacing,
      textIndent: setTextIndent,
      fullJustification: setFullJustification,
      hyphenation: setHyphenation,
      marginTopPx: setMarginTopPx,
      marginBottomPx: setMarginBottomPx,
      marginLeftPx: setMarginLeftPx,
      marginRightPx: setMarginRightPx,
      compactMarginTopPx: setCompactMarginTopPx,
      compactMarginBottomPx: setCompactMarginBottomPx,
      compactMarginLeftPx: setCompactMarginLeftPx,
      compactMarginRightPx: setCompactMarginRightPx,
      gapPercent: setGapPercent,
      maxColumnCount: setMaxColumnCount,
      maxInlineSize: setMaxInlineSize,
      maxBlockSize: setMaxBlockSize,
      overrideLayout: setOverrideLayout,
      doubleBorder: setDoubleBorder,
      borderColor: setBorderColor,
      showHeader: setShowHeader,
      showFooter: setShowFooter,
      showBarsOnScroll: setShowBarsOnScroll,
      showRemainingTime: setShowRemainingTime,
      showRemainingPages: setShowRemainingPages,
      showProgressInfo: setShowProgressInfo,
    });
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'paragraphMargin', paragraphMargin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paragraphMargin]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'lineHeight', lineHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineHeight]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'wordSpacing', wordSpacing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordSpacing]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'letterSpacing', letterSpacing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letterSpacing]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'textIndent', textIndent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textIndent]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'fullJustification', fullJustification);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullJustification]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'hyphenation', hyphenation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hyphenation]);

  useEffect(() => {
    if (marginTopPx === viewSettings.marginTopPx) return;
    if (viewSettings.marginPx !== undefined) {
      saveViewSettings(envConfig, bookKey, 'marginPx', undefined, false, false);
    }
    saveViewSettings(envConfig, bookKey, 'marginTopPx', marginTopPx, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marginTopPx]);

  useEffect(() => {
    if (marginBottomPx === viewSettings.marginBottomPx) return;
    if (viewSettings.marginPx !== undefined) {
      saveViewSettings(envConfig, bookKey, 'marginPx', undefined, false, false);
    }
    saveViewSettings(envConfig, bookKey, 'marginBottomPx', marginBottomPx, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marginBottomPx]);

  useEffect(() => {
    if (marginRightPx === viewSettings.marginRightPx) return;
    if (viewSettings.marginPx !== undefined) {
      saveViewSettings(envConfig, bookKey, 'marginPx', undefined, false, false);
    }
    saveViewSettings(envConfig, bookKey, 'marginRightPx', marginRightPx, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marginRightPx]);

  useEffect(() => {
    if (marginLeftPx === viewSettings.marginLeftPx) return;
    if (viewSettings.marginPx !== undefined) {
      saveViewSettings(envConfig, bookKey, 'marginPx', undefined, false, false);
    }
    saveViewSettings(envConfig, bookKey, 'marginLeftPx', marginLeftPx, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marginLeftPx]);

  useEffect(() => {
    if (compactMarginTopPx === viewSettings.compactMarginTopPx) return;
    if (viewSettings.compactMarginPx !== undefined) {
      saveViewSettings(envConfig, bookKey, 'compactMarginPx', undefined, false, false);
    }
    saveViewSettings(envConfig, bookKey, 'compactMarginTopPx', compactMarginTopPx, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactMarginTopPx]);

  useEffect(() => {
    if (compactMarginBottomPx === viewSettings.compactMarginBottomPx) return;
    if (viewSettings.compactMarginPx !== undefined) {
      saveViewSettings(envConfig, bookKey, 'compactMarginPx', undefined, false, false);
    }
    saveViewSettings(
      envConfig,
      bookKey,
      'compactMarginBottomPx',
      compactMarginBottomPx,
      false,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactMarginBottomPx]);

  useEffect(() => {
    if (compactMarginRightPx === viewSettings.compactMarginRightPx) return;
    if (viewSettings.compactMarginPx !== undefined) {
      saveViewSettings(envConfig, bookKey, 'compactMarginPx', undefined, false, false);
    }
    saveViewSettings(
      envConfig,
      bookKey,
      'compactMarginRightPx',
      compactMarginRightPx,
      false,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactMarginRightPx]);

  useEffect(() => {
    if (compactMarginLeftPx === viewSettings.compactMarginLeftPx) return;
    if (viewSettings.compactMarginPx !== undefined) {
      saveViewSettings(envConfig, bookKey, 'compactMarginPx', undefined, false, false);
    }
    saveViewSettings(envConfig, bookKey, 'compactMarginLeftPx', compactMarginLeftPx, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactMarginLeftPx]);

  useEffect(() => {
    if (gapPercent === viewSettings.gapPercent) return;
    saveViewSettings(envConfig, bookKey, 'gapPercent', gapPercent, false, false);
    view?.renderer.setAttribute('gap', `${gapPercent}%`);
    if (viewSettings.scrolled) {
      view?.renderer.setAttribute('flow', 'scrolled');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapPercent]);

  useEffect(() => {
    if (maxColumnCount === viewSettings.maxColumnCount) return;
    saveViewSettings(envConfig, bookKey, 'maxColumnCount', maxColumnCount, false, false);
    view?.renderer.setAttribute('max-column-count', maxColumnCount);
    view?.renderer.setAttribute('max-inline-size', `${getMaxInlineSize(viewSettings)}px`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxColumnCount]);

  useEffect(() => {
    if (maxInlineSize === viewSettings.maxInlineSize) return;
    saveViewSettings(envConfig, bookKey, 'maxInlineSize', maxInlineSize, false, false);
    view?.renderer.setAttribute('max-inline-size', `${getMaxInlineSize(viewSettings)}px`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxInlineSize]);

  useEffect(() => {
    if (maxBlockSize === viewSettings.maxBlockSize) return;
    saveViewSettings(envConfig, bookKey, 'maxBlockSize', maxBlockSize, false, false);
    view?.renderer.setAttribute('max-block-size', `${maxBlockSize}px`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxBlockSize]);

  useEffect(() => {
    if (writingMode === viewSettings.writingMode) return;
    // global settings are not supported for writing mode
    const prevWritingMode = viewSettings.writingMode;
    if (writingMode.includes('vertical')) {
      viewSettings.vertical = true;
    } else {
      viewSettings.vertical = false;
    }
    saveViewSettings(envConfig, bookKey, 'writingMode', writingMode, true);
    if (view) {
      view.renderer.setStyles?.(getStyles(viewSettings));
      view.book.dir = getBookDirFromWritingMode(writingMode);
    }
    if (
      prevWritingMode !== writingMode &&
      (['horizontal-rl', 'vertical-rl'].includes(writingMode) ||
        ['horizontal-rl', 'vertical-rl'].includes(prevWritingMode))
    ) {
      setTimeout(() => recreateViewer(envConfig, bookKey), RELOAD_BEFORE_SAVED_TIMEOUT_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writingMode]);

  useEffect(() => {
    if (overrideLayout === viewSettings.overrideLayout) return;
    saveViewSettings(envConfig, bookKey, 'overrideLayout', overrideLayout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideLayout]);

  useEffect(() => {
    if (doubleBorder === viewSettings.doubleBorder) return;
    saveViewSettings(envConfig, bookKey, 'doubleBorder', doubleBorder, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doubleBorder]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'borderColor', borderColor, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [borderColor]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'showBarsOnScroll', showBarsOnScroll, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBarsOnScroll]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'showRemainingTime', showRemainingTime, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRemainingTime]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'showRemainingPages', showRemainingPages, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRemainingPages]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'showProgressInfo', showProgressInfo, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showProgressInfo]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'progressStyle', progressStyle, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressStyle]);

  useEffect(() => {
    if (showHeader === viewSettings.showHeader) return;
    if (showHeader && !viewSettings.vertical) {
      const minMarginTop = Math.max(0, Math.round((44 - gridInsets.top) / 4) * 4);
      viewSettings.marginTopPx = Math.max(viewSettings.marginTopPx, minMarginTop);
      setMarginTopPx(viewSettings.marginTopPx);
      setViewSettings(bookKey, viewSettings);
    }
    saveViewSettings(envConfig, bookKey, 'showHeader', showHeader, false, false);
    // Margin and gap settings will be applied in FoliateViewer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHeader]);

  useEffect(() => {
    if (showFooter === viewSettings.showFooter) return;
    if (showFooter && !viewSettings.vertical) {
      const minMarginBottom = Math.max(0, Math.round((44 - gridInsets.bottom) / 4) * 4);
      viewSettings.marginBottomPx = Math.max(viewSettings.marginBottomPx, minMarginBottom);
      setMarginBottomPx(viewSettings.marginBottomPx);
      setViewSettings(bookKey, viewSettings);
    }
    saveViewSettings(envConfig, bookKey, 'showFooter', showFooter, false, false);
    // Margin and gap settings will be applied in FoliateViewer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFooter]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'screenOrientation', screenOrientation, false, false);
    if (appService?.isMobileApp) {
      lockScreenOrientation({ orientation: screenOrientation });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenOrientation]);

  const langCode = getBookLangCode(bookData?.bookDoc?.metadata?.language);
  const mightBeRTLBook = MIGHT_BE_RTL_LANGS.includes(langCode) || isCJKEnv();
  const isVertical = viewSettings.vertical || writingMode.includes('vertical');

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='flex items-center justify-between'>
        <h2 className='font-medium'>{_('Override Book Layout')}</h2>
        <input
          type='checkbox'
          className='toggle'
          checked={overrideLayout}
          onChange={() => setOverrideLayout(!overrideLayout)}
        />
      </div>
      {mightBeRTLBook && (
        <div className='flex items-center justify-between'>
          <h2 className='font-medium'>{_('Writing Mode')}</h2>
          <div className='flex gap-4'>
            <button
              title={_('Default')}
              className={`btn btn-ghost btn-circle btn-sm ${writingMode === 'auto' ? 'btn-active bg-base-300' : ''}`}
              onClick={() => setWritingMode('auto')}
            >
              <MdOutlineAutoMode />
            </button>

            <button
              title={_('Horizontal Direction')}
              className={`btn btn-ghost btn-circle btn-sm ${writingMode === 'horizontal-tb' ? 'btn-active bg-base-300' : ''}`}
              onClick={() => setWritingMode('horizontal-tb')}
            >
              <MdOutlineTextRotationNone />
            </button>

            <button
              title={_('Vertical Direction')}
              className={`btn btn-ghost btn-circle btn-sm ${writingMode === 'vertical-rl' ? 'btn-active bg-base-300' : ''}`}
              onClick={() => setWritingMode('vertical-rl')}
            >
              <MdTextRotateVertical />
            </button>

            <button
              title={_('RTL Direction')}
              className={`btn btn-ghost btn-circle btn-sm ${writingMode === 'horizontal-rl' ? 'btn-active bg-base-300' : ''}`}
              onClick={() => setWritingMode('horizontal-rl')}
            >
              <TbTextDirectionRtl />
            </button>
          </div>
        </div>
      )}

      {viewSettings.vertical && (
        <div className='w-full'>
          <h2 className='mb-2 font-medium'>{_('Border Frame')}</h2>
          <div className='card bg-base-100 border-base-200 border shadow'>
            <div className='divide-base-200 divide-y'>
              <div className='config-item'>
                <span className=''>{_('Double Border')}</span>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={doubleBorder}
                  onChange={() => setDoubleBorder(!doubleBorder)}
                />
              </div>

              <div className='config-item'>
                <span className=''>{_('Border Color')}</span>
                <div className='flex gap-4'>
                  <button
                    className={`btn btn-circle btn-sm bg-red-300 hover:bg-red-500 ${borderColor === 'red' ? 'btn-active !bg-red-500' : ''}`}
                    onClick={() => setBorderColor('red')}
                  ></button>

                  <button
                    className={`btn btn-circle btn-sm bg-black/50 hover:bg-black ${borderColor === 'black' ? 'btn-active !bg-black' : ''}`}
                    onClick={() => setBorderColor('black')}
                  ></button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Paragraph')}</h2>
        <div className='card bg-base-100 border-base-200 border shadow'>
          <div className='divide-base-200 divide-y'>
            <NumberInput
              label={_('Paragraph Margin')}
              value={paragraphMargin}
              onChange={setParagraphMargin}
              min={0}
              max={4}
              step={0.1}
            />
            <NumberInput
              label={_('Line Spacing')}
              value={lineHeight}
              onChange={setLineHeight}
              min={1.0}
              max={3.0}
              step={0.1}
            />
            {langCode !== 'zh' && (
              <NumberInput
                label={_('Word Spacing')}
                value={wordSpacing}
                onChange={setWordSpacing}
                min={-4}
                max={8}
                step={0.5}
              />
            )}
            <NumberInput
              label={_('Letter Spacing')}
              value={letterSpacing}
              onChange={setLetterSpacing}
              min={-2}
              max={4}
              step={0.5}
            />
            <NumberInput
              label={_('Text Indent')}
              value={textIndent}
              onChange={setTextIndent}
              min={-2}
              max={4}
              step={1}
            />
            <div className='config-item'>
              <span className=''>{_('Full Justification')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={fullJustification}
                onChange={() => setFullJustification(!fullJustification)}
              />
            </div>
            <div className='config-item'>
              <span className=''>{_('Hyphenation')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={hyphenation}
                onChange={() => setHyphenation(!hyphenation)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Page')}</h2>
        <div className='card bg-base-100 border-base-200 border shadow'>
          <div className='divide-base-200 divide-y'>
            <NumberInput
              label={_('Top Margin (px)')}
              value={showHeader && !isVertical ? marginTopPx : compactMarginTopPx}
              onChange={showHeader && !isVertical ? setMarginTopPx : setCompactMarginTopPx}
              min={
                showHeader && !isVertical
                  ? Math.max(0, Math.round((44 - gridInsets.top) / 4) * 4)
                  : 0
              }
              max={88}
              step={4}
            />
            <NumberInput
              label={_('Bottom Margin (px)')}
              value={showFooter && !isVertical ? marginBottomPx : compactMarginBottomPx}
              onChange={showFooter && !isVertical ? setMarginBottomPx : setCompactMarginBottomPx}
              min={
                showFooter && !isVertical
                  ? Math.max(0, Math.round((44 - gridInsets.bottom) / 4) * 4)
                  : 0
              }
              max={88}
              step={4}
            />
            <NumberInput
              label={_('Left Margin (px)')}
              value={showFooter && isVertical ? marginLeftPx : compactMarginLeftPx}
              onChange={showFooter && isVertical ? setMarginLeftPx : setCompactMarginLeftPx}
              min={0}
              max={88}
              step={4}
            />
            <NumberInput
              label={_('Right Margin (px)')}
              value={showHeader && isVertical ? marginRightPx : compactMarginRightPx}
              onChange={showHeader && isVertical ? setMarginRightPx : setCompactMarginRightPx}
              min={0}
              max={88}
              step={4}
            />
            <NumberInput
              label={_('Column Gap (%)')}
              value={gapPercent}
              onChange={setGapPercent}
              min={0}
              max={30}
            />
            <NumberInput
              label={_('Maximum Number of Columns')}
              value={maxColumnCount}
              onChange={setMaxColumnCount}
              min={1}
              max={4}
            />
            <NumberInput
              label={viewSettings.vertical ? _('Maximum Column Height') : _('Maximum Column Width')}
              value={maxInlineSize}
              onChange={setMaxInlineSize}
              disabled={false}
              min={200}
              max={9999}
              step={50}
            />
            <NumberInput
              label={viewSettings.vertical ? _('Maximum Column Width') : _('Maximum Column Height')}
              value={maxBlockSize}
              onChange={setMaxBlockSize}
              disabled={false}
              min={400}
              max={9999}
              step={50}
            />
          </div>
        </div>
      </div>

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Header & Footer')}</h2>
        <div className='card bg-base-100 border-base-200 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <span className=''>{_('Show Header')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={showHeader}
                onChange={() => setShowHeader(!showHeader)}
              />
            </div>
            <div className='config-item'>
              <span className=''>{_('Show Footer')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={showFooter}
                onChange={() => setShowFooter(!showFooter)}
              />
            </div>
            <div className='config-item'>
              <span className=''>{_('Show Remaining Time')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={showRemainingTime}
                disabled={!showFooter}
                onChange={() => {
                  if (!showRemainingTime) {
                    setShowRemainingTime(true);
                    setShowRemainingPages(false);
                  } else {
                    setShowRemainingTime(false);
                  }
                }}
              />
            </div>
            <div className='config-item'>
              <span className=''>{_('Show Remaining Pages')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={showRemainingPages}
                disabled={!showFooter}
                onChange={() => {
                  if (!showRemainingPages) {
                    setShowRemainingPages(true);
                    setShowRemainingTime(false);
                  } else {
                    setShowRemainingPages(false);
                  }
                }}
              />
            </div>
            <div className='config-item'>
              <span className=''>{_('Show Reading Progress')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={showProgressInfo}
                disabled={!showFooter}
                onChange={() => setShowProgressInfo(!showProgressInfo)}
              />
            </div>
            <div className='config-item'>
              <span className=''>{_('Reading Progress Style')}</span>
              <Select
                value={progressStyle}
                onChange={(e) => setProgressStyle(e.target.value as 'percentage' | 'fraction')}
                options={[
                  { value: 'fraction', label: _('Page Number') },
                  { value: 'percentage', label: _('Percentage') },
                ]}
                disabled={!showProgressInfo}
              />
            </div>
            <div className='config-item'>
              <span className=''>{_('Apply also in Scrolled Mode')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={showBarsOnScroll}
                onChange={() => setShowBarsOnScroll(!showBarsOnScroll)}
              />
            </div>
          </div>
        </div>
      </div>

      {appService?.hasOrientationLock && (
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
    </div>
  );
};

export default LayoutPanel;
