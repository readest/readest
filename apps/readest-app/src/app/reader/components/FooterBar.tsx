import React, { useEffect } from 'react';
import clsx from 'clsx';
import { RiArrowLeftSLine, RiArrowRightSLine } from 'react-icons/ri';
import { RiArrowGoBackLine, RiArrowGoForwardLine } from 'react-icons/ri';
import { RiArrowLeftDoubleLine, RiArrowRightDoubleLine } from 'react-icons/ri';
import { FaHeadphones } from 'react-icons/fa6';
import { IoIosList as TOCIcon } from 'react-icons/io';
import { PiNotePencil as NoteIcon } from 'react-icons/pi';
import { RxSlider as SliderIcon } from 'react-icons/rx';
import { RiFontFamily as FontIcon } from 'react-icons/ri';
import { MdOutlineHeadphones as TTSIcon } from 'react-icons/md';
import { TbBoxMargin } from 'react-icons/tb';
import { RxLineHeight } from 'react-icons/rx';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { eventDispatcher } from '@/utils/event';
import { viewPagination } from '../hooks/usePagination';
import { saveViewSettings } from '../utils/viewSettingsHelper';
import { PageInfo } from '@/types/book';
import { Insets } from '@/types/misc';
import Button from '@/components/Button';
import Slider from '@/components/Slider';
import TTSControl from './tts/TTSControl';

interface FooterBarProps {
  bookKey: string;
  bookFormat: string;
  section?: PageInfo;
  pageinfo?: PageInfo;
  isHoveredAnim: boolean;
  gridInsets: Insets;
}

const FooterBar: React.FC<FooterBarProps> = ({
  bookKey,
  bookFormat,
  section,
  pageinfo,
  isHoveredAnim,
  gridInsets,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getConfig, setConfig } = useBookDataStore();
  const { hoveredBookKey, setHoveredBookKey } = useReaderStore();
  const { getView, getViewState, getProgress, getViewSettings } = useReaderStore();
  const { isSideBarVisible, setSideBarVisible } = useSidebarStore();
  const [actionTab, setActionTab] = React.useState('');
  const sliderHeight = useResponsiveSize(28);
  const tocIconSize = useResponsiveSize(23);
  const fontIconSize = useResponsiveSize(18);
  const marginIconSize = useResponsiveSize(20);

  const view = getView(bookKey);
  const config = getConfig(bookKey);
  const progress = getProgress(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const viewState = getViewState(bookKey);

  const handleProgressChange = (value: number) => {
    view?.goToFraction(value / 100.0);
  };

  const handleFontSizeChange = (value: number) => {
    saveViewSettings(envConfig, bookKey, 'defaultFontSize', value);
  };

  const handleMarginChange = (value: number) => {
    const viewSettings = getViewSettings(bookKey)!;
    const marginPx = Math.round((value / 100) * 88);
    const gapPercent = Math.round((value / 100) * 10);
    viewSettings.marginTopPx = marginPx;
    viewSettings.marginBottomPx = marginPx / 2;
    viewSettings.marginLeftPx = marginPx / 2;
    viewSettings.marginRightPx = marginPx / 2;
    saveViewSettings(envConfig, bookKey, 'gapPercent', gapPercent, false, false);
    view?.renderer.setAttribute('margin', `${marginPx}px`);
    view?.renderer.setAttribute('gap', `${gapPercent}%`);
    if (viewSettings?.scrolled) {
      view?.renderer.setAttribute('flow', 'scrolled');
    }
  };

  const handleLineHeightChange = (value: number) => {
    saveViewSettings(envConfig, bookKey, 'lineHeight', value / 10);
  };

  const handleGoPrevPage = () => {
    viewPagination(view, viewSettings, 'left');
  };

  const handleGoNextPage = () => {
    viewPagination(view, viewSettings, 'right');
  };

  const handleGoPrevSection = () => {
    if (view?.renderer.prevSection) {
      view?.renderer.prevSection();
    }
  };

  const handleGoNextSection = () => {
    if (view?.renderer.nextSection) {
      view?.renderer.nextSection();
    }
  };

  const handleGoBack = () => {
    view?.history.back();
  };

  const handleGoForward = () => {
    view?.history.forward();
  };

  const handleSpeakText = async () => {
    if (!view || !progress || !viewState) return;
    if (viewState.ttsEnabled) {
      eventDispatcher.dispatch('tts-stop', { bookKey });
    } else {
      eventDispatcher.dispatch('tts-speak', { bookKey });
    }
  };

  const handleSetActionTab = (tab: string) => {
    setActionTab(actionTab === tab ? '' : tab);
    if (tab === 'tts') {
      setHoveredBookKey('');
      handleSpeakText();
    } else if (tab === 'toc') {
      setHoveredBookKey('');
      if (config && config.viewSettings) {
        config.viewSettings.sideBarTab = 'toc';
        setConfig(bookKey, config);
      }
      setSideBarVisible(true);
    } else if (tab === 'note') {
      setHoveredBookKey('');
      setSideBarVisible(true);
      if (config && config.viewSettings) {
        config.viewSettings.sideBarTab = 'annotations';
        setConfig(bookKey, config);
      }
    }
  };

  useEffect(() => {
    if (hoveredBookKey !== bookKey) {
      setActionTab('');
    }
  }, [hoveredBookKey, bookKey]);

  const getMarginProgressValue = (marginPx: number, gapPercent: number) => {
    return (marginPx / 88 + gapPercent / 10) * 50;
  };

  const isVisible = hoveredBookKey === bookKey;
  const ttsEnabled = viewState?.ttsEnabled;
  const progressInfo = bookFormat === 'PDF' ? section : pageinfo;
  const progressValid = !!progressInfo;
  const progressFraction =
    progressValid && progressInfo?.total > 0
      ? (progressInfo!.current + 1) / progressInfo!.total || 0
      : 0;

  const isMobile = window.innerWidth < 640 || window.innerHeight < 640;

  return (
    <>
      <div
        className={clsx(
          'absolute bottom-0 left-0 z-10 hidden w-full sm:flex sm:h-[52px]',
          // show scroll bar when vertical and scrolled in desktop
          viewSettings?.vertical && viewSettings?.scrolled && 'sm:!bottom-3 sm:!h-7',
        )}
        onMouseEnter={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
        onTouchStart={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
      />
      <div
        className={clsx(
          'footer-bar shadow-xs bottom-0 z-50 flex w-full flex-col',
          'sm:h-[52px] sm:justify-center',
          'sm:bg-base-100 border-base-300/50 border-t sm:border-none',
          'transition-[opacity,transform] duration-300',
          appService?.isMobile ? 'fixed' : 'absolute',
          appService?.hasRoundedWindow && 'rounded-window-bottom-right',
          !isSideBarVisible && appService?.hasRoundedWindow && 'rounded-window-bottom-left',
          isHoveredAnim && 'hover-bar-anim',
          // show scroll bar when vertical and scrolled in desktop
          viewSettings?.vertical && viewSettings?.scrolled && 'sm:!bottom-3 sm:!h-7',
          isVisible
            ? `pointer-events-auto translate-y-0 opacity-100`
            : `pointer-events-none translate-y-full opacity-0 sm:translate-y-0`,
        )}
        dir={viewSettings?.rtl ? 'rtl' : 'ltr'}
        onMouseLeave={() => window.innerWidth >= 640 && setHoveredBookKey('')}
        aria-hidden={!isVisible}
      >
        {/* Mobile footer bar */}
        <div
          className={clsx(
            'footerbar-progress-mobile bg-base-200 absolute flex w-full flex-col items-center gap-y-8 px-4 transition-all sm:hidden',
            actionTab === 'progress'
              ? 'pointer-events-auto translate-y-0 pb-4 pt-8 ease-out'
              : 'pointer-events-none invisible translate-y-full overflow-hidden pb-0 pt-0 ease-in',
          )}
          style={{
            bottom: isMobile ? `${gridInsets.bottom + 64}px` : '64px',
          }}
        >
          <div className='flex w-full items-center justify-between gap-x-6'>
            <Slider
              heightPx={sliderHeight}
              bubbleLabel={`${Math.round(progressFraction * 100)}%`}
              initialValue={progressValid ? progressFraction * 100 : 0}
              onChange={(e) => handleProgressChange(e)}
            />
          </div>
          <div className='flex w-full items-center justify-between gap-x-6'>
            <Button
              icon={viewSettings?.rtl ? <RiArrowRightDoubleLine /> : <RiArrowLeftDoubleLine />}
              onClick={viewSettings?.rtl ? handleGoNextSection : handleGoPrevSection}
              tooltip={viewSettings?.rtl ? _('Next Section') : _('Previous Section')}
            />
            <Button
              icon={viewSettings?.rtl ? <RiArrowRightSLine /> : <RiArrowLeftSLine />}
              onClick={viewSettings?.rtl ? handleGoNextPage : handleGoPrevPage}
              tooltip={viewSettings?.rtl ? _('Next Page') : _('Previous Page')}
            />
            <Button
              icon={viewSettings?.rtl ? <RiArrowGoForwardLine /> : <RiArrowGoBackLine />}
              onClick={handleGoBack}
              tooltip={_('Go Back')}
              disabled={!view?.history.canGoBack}
            />
            <Button
              icon={viewSettings?.rtl ? <RiArrowGoBackLine /> : <RiArrowGoForwardLine />}
              onClick={handleGoForward}
              tooltip={_('Go Forward')}
              disabled={!view?.history.canGoForward}
            />
            <Button
              icon={viewSettings?.rtl ? <RiArrowLeftSLine /> : <RiArrowRightSLine />}
              onClick={viewSettings?.rtl ? handleGoPrevPage : handleGoNextPage}
              tooltip={viewSettings?.rtl ? _('Previous Page') : _('Next Page')}
            />
            <Button
              icon={viewSettings?.rtl ? <RiArrowLeftDoubleLine /> : <RiArrowRightDoubleLine />}
              onClick={viewSettings?.rtl ? handleGoPrevSection : handleGoNextSection}
              tooltip={viewSettings?.rtl ? _('Previous Section') : _('Next Section')}
            />
          </div>
        </div>
        <div
          className={clsx(
            'footerbar-font-mobile bg-base-200 absolute flex w-full flex-col items-center gap-y-8 px-4 transition-all sm:hidden',
            actionTab === 'font'
              ? 'pointer-events-auto translate-y-0 pb-4 pt-8 ease-out'
              : 'pointer-events-none invisible translate-y-full overflow-hidden pb-0 pt-0 ease-in',
          )}
          style={{
            bottom: isMobile ? `${gridInsets.bottom + 64}px` : '64px',
          }}
        >
          <Slider
            initialValue={viewSettings?.defaultFontSize ?? 16}
            bubbleLabel={`${viewSettings?.defaultFontSize ?? 16}`}
            minLabel='A'
            maxLabel='A'
            minClassName='text-xs'
            maxClassName='text-base'
            onChange={handleFontSizeChange}
            min={8}
            max={30}
          />
          <div className='flex w-full items-center justify-between gap-x-6'>
            <Slider
              initialValue={getMarginProgressValue(
                viewSettings?.marginTopPx ?? 44,
                viewSettings?.gapPercent ?? 5,
              )}
              bubbleElement={<TbBoxMargin size={marginIconSize} />}
              minLabel={_('Small')}
              maxLabel={_('Large')}
              step={10}
              onChange={handleMarginChange}
            />
            <Slider
              initialValue={(viewSettings?.lineHeight ?? 1.6) * 10}
              bubbleElement={<RxLineHeight size={marginIconSize} />}
              minLabel={_('Small')}
              maxLabel={_('Large')}
              min={8}
              max={24}
              onChange={handleLineHeightChange}
            />
          </div>
        </div>
        <div
          className={clsx(
            'bg-base-200 z-50 mt-auto flex w-full justify-between px-8 py-4 sm:hidden',
          )}
          style={{
            paddingBottom: isMobile ? `${gridInsets.bottom + 16}px` : '0px',
          }}
        >
          <Button
            icon={<TOCIcon size={tocIconSize} className='' />}
            onClick={() => handleSetActionTab('toc')}
          />
          <Button icon={<NoteIcon className='' />} onClick={() => handleSetActionTab('note')} />
          <Button
            icon={<SliderIcon className={clsx(actionTab === 'progress' && 'text-blue-500')} />}
            onClick={() => handleSetActionTab('progress')}
          />
          <Button
            icon={
              <FontIcon
                size={fontIconSize}
                className={clsx(actionTab === 'font' && 'text-blue-500')}
              />
            }
            onClick={() => handleSetActionTab('font')}
          />
          <Button
            icon={<TTSIcon className={ttsEnabled ? 'text-blue-500' : ''} />}
            onClick={() => handleSetActionTab('tts')}
          />
        </div>
        {/* Desktop / Pad footer bar */}
        <div
          className='absolute hidden h-full w-full items-center gap-x-4 px-4 sm:flex'
          style={{
            bottom: isMobile ? `${gridInsets.bottom / 2}px` : '0px',
          }}
        >
          <Button
            icon={viewSettings?.rtl ? <RiArrowRightDoubleLine /> : <RiArrowLeftDoubleLine />}
            onClick={viewSettings?.rtl ? handleGoNextSection : handleGoPrevSection}
            tooltip={viewSettings?.rtl ? _('Next Section') : _('Previous Section')}
          />
          <Button
            icon={viewSettings?.rtl ? <RiArrowRightSLine /> : <RiArrowLeftSLine />}
            onClick={viewSettings?.rtl ? handleGoNextPage : handleGoPrevPage}
            tooltip={viewSettings?.rtl ? _('Next Page') : _('Previous Page')}
          />
          <Button
            icon={viewSettings?.rtl ? <RiArrowGoForwardLine /> : <RiArrowGoBackLine />}
            onClick={handleGoBack}
            tooltip={_('Go Back')}
            disabled={!view?.history.canGoBack}
          />
          <Button
            icon={viewSettings?.rtl ? <RiArrowGoBackLine /> : <RiArrowGoForwardLine />}
            onClick={handleGoForward}
            tooltip={_('Go Forward')}
            disabled={!view?.history.canGoForward}
          />
          <span className='mx-2 text-center text-sm'>
            {progressValid ? `${Math.round(progressFraction * 100)}%` : ''}
          </span>
          <input
            type='range'
            className='text-base-content mx-2 w-full'
            min={0}
            max={100}
            value={progressValid ? progressFraction * 100 : 0}
            onChange={(e) =>
              handleProgressChange(parseInt((e.target as HTMLInputElement).value, 10))
            }
          />
          <Button
            icon={<FaHeadphones className={ttsEnabled ? 'text-blue-500' : ''} />}
            onClick={handleSpeakText}
            tooltip={_('Speak')}
          />
          <Button
            icon={viewSettings?.rtl ? <RiArrowLeftSLine /> : <RiArrowRightSLine />}
            onClick={viewSettings?.rtl ? handleGoPrevPage : handleGoNextPage}
            tooltip={viewSettings?.rtl ? _('Previous Page') : _('Next Page')}
          />
          <Button
            icon={viewSettings?.rtl ? <RiArrowLeftDoubleLine /> : <RiArrowRightDoubleLine />}
            onClick={viewSettings?.rtl ? handleGoPrevSection : handleGoNextSection}
            tooltip={viewSettings?.rtl ? _('Previous Section') : _('Next Section')}
          />
        </div>
      </div>
      <TTSControl bookKey={bookKey} />
    </>
  );
};

export default FooterBar;
