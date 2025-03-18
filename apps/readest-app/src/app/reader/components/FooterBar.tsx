import React from 'react';
import clsx from 'clsx';
import { RiArrowLeftWideLine, RiArrowRightWideLine } from 'react-icons/ri';
import { RiArrowGoBackLine, RiArrowGoForwardLine } from 'react-icons/ri';
import { FaHeadphones } from 'react-icons/fa6';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { PageInfo } from '@/types/book';
import Button from '@/components/Button';

interface FooterBarProps {
  bookKey: string;
  bookFormat: string;
  section?: PageInfo;
  pageinfo?: PageInfo;
  isHoveredAnim: boolean;
}

const FooterBar: React.FC<FooterBarProps> = ({
  bookKey,
  bookFormat,
  section,
  pageinfo,
  isHoveredAnim,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { hoveredBookKey, setHoveredBookKey, getView, getProgress, getViewSettings } =
    useReaderStore();
  const { isSideBarVisible } = useSidebarStore();
  const view = getView(bookKey);
  const progress = getProgress(bookKey);
  const viewSettings = getViewSettings(bookKey);

  const handleProgressChange = (event: React.ChangeEvent) => {
    const newProgress = parseInt((event.target as HTMLInputElement).value, 10);
    view?.goToFraction(newProgress / 100.0);
  };

  const handleGoPrev = () => {
    view?.goLeft();
  };

  const handleGoNext = () => {
    view?.goRight();
  };

  const handleGoBack = () => {
    view?.history.back();
  };

  const handleGoForward = () => {
    view?.history.forward();
  };

  const handleSpeakText = async () => {
    if (!view || !progress) return;
    const { range } = progress;
    if (eventDispatcher.dispatchSync('tts-is-speaking')) {
      eventDispatcher.dispatch('tts-stop', { bookKey });
    } else {
      eventDispatcher.dispatch('tts-speak', { bookKey, range });
    }
  };

  const isVisible = hoveredBookKey === bookKey;
  const progressInfo = bookFormat === 'PDF' ? section : pageinfo;
  const progressValid = !!progressInfo;
  const progressFraction = progressValid
    ? ((progressInfo!.next ?? progressInfo!.current) + 1) / progressInfo!.total
    : 0;

  return (
    <>
      <div
        className={clsx(
          'absolute bottom-0 left-0 z-10 h-12 w-full',
          viewSettings?.vertical && viewSettings?.scrolled ? 'bottom-3 !h-6' : '',
        )}
        onMouseEnter={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
        onTouchStart={() => !appService?.isMobile && setHoveredBookKey(bookKey)}
      />
      <div
        className={clsx(
          'footer-bar absolute bottom-0 z-10 flex h-12 w-full items-center gap-x-4 px-4',
          'shadow-xs bg-base-100 transition-opacity duration-300',
          appService?.hasSafeAreaInset && 'pb-[env(safe-area-inset-bottom)]',
          appService?.hasRoundedWindow && 'rounded-window-bottom-right',
          !isSideBarVisible && appService?.hasRoundedWindow && 'rounded-window-bottom-left',
          isHoveredAnim && 'hover-bar-anim',
          viewSettings?.vertical && viewSettings?.scrolled ? 'mb-3 !h-6' : '',
          isVisible ? `pointer-events-auto opacity-100` : `pointer-events-none opacity-0`,
        )}
        dir={viewSettings?.rtl ? 'rtl' : 'ltr'}
        onMouseLeave={() => setHoveredBookKey('')}
        aria-hidden={!isVisible}
      >
        <div className='hidden sm:flex'>
          <Button
            icon={viewSettings?.rtl ? <RiArrowRightWideLine /> : <RiArrowLeftWideLine />}
            onClick={viewSettings?.rtl ? handleGoNext : handleGoPrev}
            tooltip={viewSettings?.rtl ? _('Go Right') : _('Go Left')}
          />
        </div>
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
          onChange={(e) => handleProgressChange(e)}
        />
        <Button icon={<FaHeadphones />} onClick={handleSpeakText} tooltip={_('Speak')} />
        <div className='hidden sm:flex'>
          <Button
            icon={viewSettings?.rtl ? <RiArrowLeftWideLine /> : <RiArrowRightWideLine />}
            onClick={viewSettings?.rtl ? handleGoPrev : handleGoNext}
            tooltip={viewSettings?.rtl ? _('Go Left') : _('Go Right')}
          />
        </div>
      </div>
    </>
  );
};

export default FooterBar;
