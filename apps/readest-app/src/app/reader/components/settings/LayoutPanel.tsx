import React, { useEffect, useState } from 'react';
import { MdOutlineAutoMode } from 'react-icons/md';
import { MdOutlineTextRotationNone, MdTextRotateVertical } from 'react-icons/md';
import { TbTextDirectionRtl } from 'react-icons/tb';

import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { isCJKEnv } from '@/utils/misc';
import { getStyles } from '@/utils/style';
import { getMaxInlineSize } from '@/utils/config';
import { getBookDirFromWritingMode, getBookLangCode } from '@/utils/book';
import { MIGHT_BE_RTL_LANGS } from '@/services/constants';
import NumberInput from './NumberInput';

const LayoutPanel: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { settings, isFontLayoutSettingsGlobal, setSettings } = useSettingsStore();
  const { getView, getViewSettings, setViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const view = getView(bookKey);
  const bookData = getBookData(bookKey)!;
  const viewSettings = getViewSettings(bookKey)!;

  const [paragraphMargin, setParagraphMargin] = useState(viewSettings.paragraphMargin!);
  const [lineHeight, setLineHeight] = useState(viewSettings.lineHeight!);
  const [wordSpacing, setWordSpacing] = useState(viewSettings.wordSpacing!);
  const [letterSpacing, setLetterSpacing] = useState(viewSettings.letterSpacing!);
  const [textIndent, setTextIndent] = useState(viewSettings.textIndent!);
  const [fullJustification, setFullJustification] = useState(viewSettings.fullJustification!);
  const [hyphenation, setHyphenation] = useState(viewSettings.hyphenation!);
  const [marginPx, setMarginPx] = useState(viewSettings.marginPx!);
  const [gapPercent, setGapPercent] = useState(viewSettings.gapPercent!);
  const [maxColumnCount, setMaxColumnCount] = useState(viewSettings.maxColumnCount!);
  const [maxInlineSize, setMaxInlineSize] = useState(viewSettings.maxInlineSize!);
  const [maxBlockSize, setMaxBlockSize] = useState(viewSettings.maxBlockSize!);
  const [writingMode, setWritingMode] = useState(viewSettings.writingMode!);
  const [overrideLayout, setOverrideLayout] = useState(viewSettings.overrideLayout!);
  const [isScrolledMode, setScrolledMode] = useState(viewSettings.scrolled!);
  const [doubleBorder, setDoubleBorder] = useState(viewSettings.doubleBorder!);
  const [borderColor, setBorderColor] = useState(viewSettings.borderColor!);

  useEffect(() => {
    viewSettings.paragraphMargin = paragraphMargin;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.paragraphMargin = paragraphMargin;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paragraphMargin]);

  useEffect(() => {
    viewSettings.lineHeight = lineHeight;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.lineHeight = lineHeight;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineHeight]);

  useEffect(() => {
    viewSettings.wordSpacing = wordSpacing;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.wordSpacing = wordSpacing;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordSpacing]);

  useEffect(() => {
    viewSettings.letterSpacing = letterSpacing;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.letterSpacing = letterSpacing;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letterSpacing]);

  useEffect(() => {
    viewSettings.textIndent = textIndent;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.textIndent = textIndent;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textIndent]);

  useEffect(() => {
    viewSettings.fullJustification = fullJustification;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.fullJustification = fullJustification;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullJustification]);

  useEffect(() => {
    viewSettings.hyphenation = hyphenation;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.hyphenation = hyphenation;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hyphenation]);

  useEffect(() => {
    viewSettings.marginPx = marginPx;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.marginPx = marginPx;
      setSettings(settings);
    }
    view?.renderer.setAttribute('margin', `${marginPx}px`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marginPx]);

  useEffect(() => {
    viewSettings.gapPercent = gapPercent;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.gapPercent = gapPercent;
      setSettings(settings);
    }
    view?.renderer.setAttribute('gap', `${gapPercent}%`);
    if (viewSettings.scrolled) {
      view?.renderer.setAttribute('flow', 'scrolled');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapPercent]);

  useEffect(() => {
    viewSettings.maxColumnCount = maxColumnCount;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.maxColumnCount = maxColumnCount;
      setSettings(settings);
    }
    view?.renderer.setAttribute('max-column-count', maxColumnCount);
    view?.renderer.setAttribute('max-inline-size', `${getMaxInlineSize(viewSettings)}px`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxColumnCount]);

  useEffect(() => {
    viewSettings.maxInlineSize = maxInlineSize;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.maxInlineSize = maxInlineSize;
      setSettings(settings);
    }
    view?.renderer.setAttribute('max-inline-size', `${getMaxInlineSize(viewSettings)}px`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxInlineSize]);

  useEffect(() => {
    viewSettings.maxBlockSize = maxBlockSize;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.maxBlockSize = maxBlockSize;
      setSettings(settings);
    }
    view?.renderer.setAttribute('max-block-size', `${maxBlockSize}px`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxBlockSize]);

  useEffect(() => {
    // global settings are not supported for writing mode
    const prevWritingMode = viewSettings.writingMode;
    viewSettings.writingMode = writingMode;
    if (writingMode.includes('vertical')) {
      viewSettings.vertical = true;
    }
    setViewSettings(bookKey, viewSettings);
    if (view) {
      view.renderer.setStyles?.(getStyles(viewSettings));
      view.book.dir = getBookDirFromWritingMode(writingMode);
    }
    if (
      prevWritingMode !== writingMode &&
      (['horizontal-rl', 'vertical-rl'].includes(writingMode) ||
        ['horizontal-rl', 'vertical-rl'].includes(prevWritingMode))
    ) {
      setTimeout(() => window.location.reload(), 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writingMode]);

  useEffect(() => {
    viewSettings.overrideLayout = overrideLayout;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.overrideLayout = overrideLayout;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideLayout]);

  useEffect(() => {
    viewSettings!.scrolled = isScrolledMode;
    getView(bookKey)?.renderer.setAttribute('flow', isScrolledMode ? 'scrolled' : 'paginated');
    getView(bookKey)?.renderer.setAttribute(
      'max-inline-size',
      `${getMaxInlineSize(viewSettings)}px`,
    );
    getView(bookKey)?.renderer.setStyles?.(getStyles(viewSettings!));
    setViewSettings(bookKey, viewSettings!);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.scrolled = isScrolledMode;
      setSettings(settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScrolledMode]);

  useEffect(() => {
    viewSettings.doubleBorder = doubleBorder;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.doubleBorder = doubleBorder;
      setSettings(settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doubleBorder]);

  useEffect(() => {
    viewSettings.borderColor = borderColor;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.borderColor = borderColor;
      setSettings(settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [borderColor]);

  const langCode = getBookLangCode(bookData.bookDoc?.metadata?.language);
  const mightBeRTLBook = MIGHT_BE_RTL_LANGS.includes(langCode) || isCJKEnv();

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full'>
        <div className='flex items-center justify-between'>
          <h2 className='font-medium'>{_('Scrolled Mode')}</h2>
          <input
            type='checkbox'
            className='toggle'
            checked={isScrolledMode}
            onChange={() => setScrolledMode(!isScrolledMode)}
          />
        </div>
      </div>

      {mightBeRTLBook && (
        <div className='w-full'>
          <div className='flex items-center justify-between'>
            <h2 className='font-medium'>{_('Writing Mode')}</h2>
            <div className='flex gap-4'>
              <div className='lg:tooltip lg:tooltip-bottom' data-tip={_('Default')}>
                <button
                  className={`btn btn-ghost btn-circle btn-sm ${writingMode === 'auto' ? 'btn-active bg-base-300' : ''}`}
                  onClick={() => setWritingMode('auto')}
                >
                  <MdOutlineAutoMode />
                </button>
              </div>

              <div className='lg:tooltip lg:tooltip-bottom' data-tip={_('Horizontal Direction')}>
                <button
                  className={`btn btn-ghost btn-circle btn-sm ${writingMode === 'horizontal-tb' ? 'btn-active bg-base-300' : ''}`}
                  onClick={() => setWritingMode('horizontal-tb')}
                >
                  <MdOutlineTextRotationNone />
                </button>
              </div>

              <div className='lg:tooltip lg:tooltip-bottom' data-tip={_('Vertical Direction')}>
                <button
                  className={`btn btn-ghost btn-circle btn-sm ${writingMode === 'vertical-rl' ? 'btn-active bg-base-300' : ''}`}
                  onClick={() => setWritingMode('vertical-rl')}
                >
                  <MdTextRotateVertical />
                </button>
              </div>

              <div className='lg:tooltip lg:tooltip-bottom' data-tip={_('RTL Direction')}>
                <button
                  className={`btn btn-ghost btn-circle btn-sm ${writingMode === 'horizontal-rl' ? 'btn-active bg-base-300' : ''}`}
                  onClick={() => setWritingMode('horizontal-rl')}
                >
                  <TbTextDirectionRtl />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewSettings.vertical && (
        <>
          <div className='w-full'>
            <div className='flex items-center justify-between'>
              <h2 className='font-medium'>{_('Double Border')}</h2>
              <input
                type='checkbox'
                className='toggle'
                checked={doubleBorder}
                onChange={() => setDoubleBorder(!doubleBorder)}
              />
            </div>
          </div>

          <div className='w-full'>
            <div className='flex items-center justify-between'>
              <h2 className='font-medium'>{_('Border Color')}</h2>
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
        </>
      )}

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Paragraph')}</h2>
        <div className='card bg-base-100 border-base-200 border shadow'>
          <div className='divide-base-200 divide-y'>
            <NumberInput
              className='config-item-top'
              label={_('Paragraph Margin')}
              value={paragraphMargin}
              onChange={setParagraphMargin}
              min={0}
              max={4}
              step={0.5}
            />
            <NumberInput
              label={_('Line Spacing')}
              value={lineHeight}
              onChange={setLineHeight}
              min={1.0}
              max={3.0}
              step={0.1}
            />
            <NumberInput
              label={_('Word Spacing')}
              value={wordSpacing}
              onChange={setWordSpacing}
              min={-4}
              max={8}
              step={0.5}
            />
            <NumberInput
              label={_('Letter Spacing')}
              value={letterSpacing}
              onChange={setLetterSpacing}
              min={-2}
              max={4}
              step={0.1}
            />
            <NumberInput
              label={_('Text Indent')}
              value={textIndent}
              onChange={setTextIndent}
              min={-2}
              max={4}
              step={1}
            />
            <div className='config-item config-item-bottom'>
              <span className=''>{_('Full Justification')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={fullJustification}
                onChange={() => setFullJustification(!fullJustification)}
              />
            </div>
            <div className='config-item config-item-bottom'>
              <span className=''>{_('Hyphenation')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={hyphenation}
                onChange={() => setHyphenation(!hyphenation)}
              />
            </div>
            <div className='config-item config-item-bottom'>
              <span className=''>{_('Override Book Layout')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={overrideLayout}
                onChange={() => setOverrideLayout(!overrideLayout)}
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
              className='config-item-top'
              label={_('Vertical Margins (px)')}
              value={marginPx}
              onChange={setMarginPx}
              min={0}
              max={88}
              step={4}
            />
            <NumberInput
              label={_('Horizontal Margins (%)')}
              value={gapPercent}
              onChange={setGapPercent}
              min={viewSettings.vertical ? 2 : 0}
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
              disabled={maxColumnCount === 1 || viewSettings.scrolled}
              min={400}
              max={9999}
              step={100}
            />
            <NumberInput
              label={viewSettings.vertical ? _('Maximum Column Width') : _('Maximum Column Height')}
              value={maxBlockSize}
              onChange={setMaxBlockSize}
              disabled={maxColumnCount === 1 || viewSettings.scrolled}
              min={400}
              max={9999}
              step={100}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default LayoutPanel;
