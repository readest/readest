import React, { useEffect, useState } from 'react';
import { MdOutlineAutoMode } from 'react-icons/md';
import { MdOutlineTextRotationDown, MdOutlineTextRotationNone } from 'react-icons/md';

import { ONE_COLUMN_MAX_INLINE_SIZE } from '@/services/constants';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useTheme } from '@/hooks/useTheme';
import { getStyles } from '@/utils/style';
import { getBookLangCode } from '@/utils/book';
import NumberInput from './NumberInput';

const LayoutPanel: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { settings, isFontLayoutSettingsGlobal, setSettings } = useSettingsStore();
  const { getView, getViewSettings, setViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const view = getView(bookKey);
  const bookData = getBookData(bookKey)!;
  const viewSettings = getViewSettings(bookKey)!;
  const { themeCode } = useTheme();

  const [lineHeight, setLineHeight] = useState(viewSettings.lineHeight!);
  const [fullJustification, setFullJustification] = useState(viewSettings.fullJustification!);
  const [hyphenation, setHyphenation] = useState(viewSettings.hyphenation!);
  const [marginPx, setMarginPx] = useState(viewSettings.marginPx!);
  const [gapPercent, setGapPercent] = useState(viewSettings.gapPercent!);
  const [maxColumnCount, setMaxColumnCount] = useState(viewSettings.maxColumnCount!);
  const [maxInlineSize, setMaxInlineSize] = useState(viewSettings.maxInlineSize!);
  const [maxBlockSize, setMaxBlockSize] = useState(viewSettings.maxBlockSize!);
  const [writingMode, setWritingMode] = useState(viewSettings.writingMode!);

  useEffect(() => {
    viewSettings.lineHeight = lineHeight;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.lineHeight = lineHeight;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings, themeCode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineHeight]);

  useEffect(() => {
    viewSettings.fullJustification = fullJustification;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.fullJustification = fullJustification;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings, themeCode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullJustification]);

  useEffect(() => {
    viewSettings.hyphenation = hyphenation;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.hyphenation = hyphenation;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings, themeCode));
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
    view?.renderer.setAttribute(
      'max-inline-size',
      `${maxColumnCount === 1 || viewSettings.scrolled ? ONE_COLUMN_MAX_INLINE_SIZE : maxInlineSize}px`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxColumnCount]);

  useEffect(() => {
    viewSettings.maxInlineSize = maxInlineSize;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.maxInlineSize = maxInlineSize;
      setSettings(settings);
    }
    view?.renderer.setAttribute(
      'max-inline-size',
      `${maxColumnCount === 1 || viewSettings.scrolled ? ONE_COLUMN_MAX_INLINE_SIZE : maxInlineSize}px`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxInlineSize]);

  useEffect(() => {
    // global settings are not supported for writing mode
    viewSettings.writingMode = writingMode;
    setViewSettings(bookKey, viewSettings);
    view?.renderer.setStyles?.(getStyles(viewSettings, themeCode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writingMode]);

  const langCode = getBookLangCode(bookData.bookDoc?.metadata?.language);
  const isCJKBook = langCode === 'zh' || langCode === 'ja' || langCode === 'ko';

  return (
    <div className='my-4 w-full space-y-6'>
      {isCJKBook && (
        <div className='w-full'>
          <div className='flex items-center justify-between'>
            <h2 className='font-medium'>{_('Writing Mode')}</h2>
            <div className='flex gap-2'>
              <div className='tooltip tooltip-bottom' data-tip={_('Default')}>
                <button
                  className={`btn btn-ghost btn-circle ${writingMode === 'auto' ? 'btn-active bg-base-300' : ''}`}
                  onClick={() => setWritingMode('auto')}
                >
                  <MdOutlineAutoMode size={20} />
                </button>
              </div>

              <div className='tooltip tooltip-bottom' data-tip={_('Horizontal Direction')}>
                <button
                  className={`btn btn-ghost btn-circle ${writingMode === 'horizontal-tb' ? 'btn-active bg-base-300' : ''}`}
                  onClick={() => setWritingMode('horizontal-tb')}
                >
                  <MdOutlineTextRotationNone size={20} />
                </button>
              </div>

              <div className='tooltip tooltip-bottom' data-tip={_('Vertical Direction')}>
                <button
                  className={`btn btn-ghost btn-circle ${writingMode === 'vertical-rl' ? 'btn-active bg-base-300' : ''}`}
                  onClick={() => setWritingMode('vertical-rl')}
                >
                  <MdOutlineTextRotationDown size={20} />
                </button>
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
              className='config-item-top'
              label={_('Line Height')}
              value={lineHeight}
              onChange={setLineHeight}
              min={1.0}
              max={3.0}
              step={0.1}
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
          </div>
        </div>
      </div>

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Page')}</h2>
        <div className='card bg-base-100 border-base-200 border shadow'>
          <div className='divide-base-200 divide-y'>
            <NumberInput
              className='config-item-top'
              label={_('Margins (px)')}
              value={marginPx}
              onChange={setMarginPx}
              min={0}
              max={88}
              step={4}
            />
            <NumberInput
              label={_('Gaps (%)')}
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
              max={2}
            />
            <NumberInput
              label={_('Maximum Inline Size')}
              value={maxInlineSize}
              onChange={setMaxInlineSize}
              min={500}
              max={9999}
              step={100}
            />
            <NumberInput
              label={_('Maximum Block Size')}
              value={maxBlockSize}
              onChange={setMaxBlockSize}
              min={500}
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
