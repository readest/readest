import React from 'react';
import clsx from 'clsx';
import { RiArrowLeftWideLine, RiArrowRightWideLine } from 'react-icons/ri';
import { RiArrowGoBackLine, RiArrowGoForwardLine } from 'react-icons/ri';
import { FaHeadphones } from 'react-icons/fa6';

import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
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
    eventDispatcher.dispatch('tts-speak', { bookKey, range });
  };

  const pageinfoValid = pageinfo && pageinfo.total > 0 && pageinfo.current >= 0;
  const progressFraction = pageinfoValid ? pageinfo.current / pageinfo.total : 0;
  return (
    <div
      className={clsx(
        'footer-bar absolute bottom-0 z-10 flex h-12 w-full items-center px-4',
        'shadow-xs bg-base-100 rounded-window-bottom-right transition-opacity duration-300',
        !isSideBarVisible && 'rounded-window-bottom-left',
        isHoveredAnim && 'hover-bar-anim',
        hoveredBookKey === bookKey ? `opacity-100` : `opacity-0`,
      )}
      onMouseEnter={() => setHoveredBookKey(bookKey)}
      onMouseLeave={() => setHoveredBookKey('')}
    >
      <Button
        icon={<RiArrowLeftWideLine size={20} />}
        onClick={handleGoPrev}
        tooltip={_('Go Left')}
      />
      <Button
        icon={<RiArrowGoBackLine size={20} />}
        onClick={handleGoBack}
        tooltip={_('Go Back')}
        disabled={!view?.history.canGoBack}
      />
      <Button
        icon={<RiArrowGoForwardLine size={20} />}
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
      <Button icon={<FaHeadphones size={20} />} onClick={handleSpeakText} tooltip={_('Speak')} />
      <Button
        icon={<RiArrowRightWideLine size={20} />}
        onClick={handleGoNext}
        tooltip={_('Go Right')}
      />
    </div>
  );
};

export default FooterBar;
