import React from 'react';
import clsx from 'clsx';
import { RiArrowLeftWideLine, RiArrowRightWideLine } from 'react-icons/ri';
import { RiArrowGoBackLine, RiArrowGoForwardLine } from 'react-icons/ri';
import { FaHeadphones } from 'react-icons/fa6';

import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { isPWA, isTauriAppPlatform } from '@/services/environment';
import Button from '@/components/Button';

interface FooterBarProps {
  bookKey: string;
  pageinfo: { current: number; total: number } | undefined;
  isHoveredAnim: boolean;
}

const FooterBar: React.FC<FooterBarProps> = ({ bookKey, pageinfo, isHoveredAnim }) => {
  const _ = useTranslation();
  const { hoveredBookKey, setHoveredBookKey, getView, getProgress } = useReaderStore();
  const { isSideBarVisible } = useSidebarStore();
  const view = getView(bookKey);
  const progress = getProgress(bookKey);

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

  const pageinfoValid = pageinfo && pageinfo.total > 0 && pageinfo.current >= 0;
  const progressFraction = pageinfoValid ? pageinfo.current / pageinfo.total : 0;
  return (
    <div
      className={clsx(
        'footer-bar absolute bottom-0 z-10 flex h-12 w-full items-center gap-x-4 px-4',
        'shadow-xs bg-base-100 transition-opacity duration-300',
        isPWA() ? 'pb-[env(safe-area-inset-bottom)]' : '',
        isTauriAppPlatform() && 'rounded-window-bottom-right',
        !isSideBarVisible && isTauriAppPlatform() && 'rounded-window-bottom-left',
        isHoveredAnim && 'hover-bar-anim',
        hoveredBookKey === bookKey ? `opacity-100` : `opacity-0`,
      )}
      onMouseEnter={() => setHoveredBookKey(bookKey)}
      onMouseLeave={() => setHoveredBookKey('')}
    >
      <div className='hidden sm:flex'>
        <Button icon={<RiArrowLeftWideLine />} onClick={handleGoPrev} tooltip={_('Go Left')} />
      </div>
      <Button
        icon={<RiArrowGoBackLine />}
        onClick={handleGoBack}
        tooltip={_('Go Back')}
        disabled={!view?.history.canGoBack}
      />
      <Button
        icon={<RiArrowGoForwardLine />}
        onClick={handleGoForward}
        tooltip={_('Go Forward')}
        disabled={!view?.history.canGoForward}
      />
      <span className='mx-2 text-center text-sm'>
        {pageinfoValid ? `${Math.round(progressFraction * 100)}%` : ''}
      </span>
      <input
        type='range'
        className='text-base-content mx-2 w-full'
        min={0}
        max={100}
        value={pageinfoValid ? progressFraction * 100 : 0}
        onChange={(e) => handleProgressChange(e)}
      />
      <Button icon={<FaHeadphones />} onClick={handleSpeakText} tooltip={_('Speak')} />
      <div className='hidden sm:flex'>
        <Button icon={<RiArrowRightWideLine />} onClick={handleGoNext} tooltip={_('Go Right')} />
      </div>
    </div>
  );
};

export default FooterBar;
