import clsx from 'clsx';
import React from 'react';
import { IoIosList as TOCIcon } from 'react-icons/io';
import { RxSlider as SliderIcon } from 'react-icons/rx';
import { RiFontFamily as FontIcon } from 'react-icons/ri';
import { PiSun as ColorIcon } from 'react-icons/pi';
import { MdOutlineHeadphones as TTSIcon } from 'react-icons/md';
import { MdPlayArrow, MdOutlinePause, MdReplay10, MdForward10 } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';
import { Insets } from '@/types/misc';
import { AudiobookPlayerState } from './types';

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

interface NavigationBarProps {
  bookKey: string;
  actionTab: string;
  gridInsets: Insets;
  forceMobileLayout: boolean;
  onSetActionTab: (tab: string) => void;
  audiobookPlayer?: AudiobookPlayerState;
}

export const NavigationBar: React.FC<NavigationBarProps> = ({
  bookKey,
  actionTab,
  gridInsets,
  forceMobileLayout,
  onSetActionTab,
  audiobookPlayer,
}) => {
  const isMobile = forceMobileLayout || window.innerWidth < 640 || window.innerHeight < 640;
  const _ = useTranslation();
  const { appService } = useEnv();
  const { getViewState } = useReaderStore();
  const viewState = getViewState(bookKey);
  const tocIconSize = useResponsiveSize(23);
  const fontIconSize = useResponsiveSize(18);
  const navPadding = isMobile ? `${gridInsets.bottom * 0.33 + 16}px` : '0px';

  return (
    <div
      className={clsx(
        'bg-base-200 z-30 mt-auto flex w-full flex-col px-8 pt-4',
        !forceMobileLayout && 'sm:hidden',
      )}
      style={{
        paddingBottom: appService?.isAndroidApp
          ? `calc(env(safe-area-inset-bottom) + 16px)`
          : navPadding,
      }}
    >
      {/* Compact audiobook strip — only when an audiobook file is attached */}
      {audiobookPlayer && !audiobookPlayer.loadError && (
        <div className='mb-3 flex items-center justify-center gap-x-3'>
          {/* TODO: when sync-map is available, page-turn handlers can seek audio to the mapped timestamp here */}
          <button
            onClick={audiobookPlayer.onSkipBack}
            disabled={!audiobookPlayer.isLoaded}
            title={_('Skip Back 10s')}
            aria-label={_('Skip Back 10s')}
            className='p-1.5'
          >
            <MdReplay10 size={tocIconSize - 4} />
          </button>
          <button
            onClick={audiobookPlayer.onTogglePlay}
            disabled={!audiobookPlayer.isLoaded}
            title={audiobookPlayer.isPlaying ? _('Pause') : _('Play')}
            aria-label={audiobookPlayer.isPlaying ? _('Pause') : _('Play')}
            className='p-1.5'
          >
            {audiobookPlayer.isPlaying ? (
              <MdOutlinePause size={tocIconSize} />
            ) : (
              <MdPlayArrow size={tocIconSize} />
            )}
          </button>
          <button
            onClick={audiobookPlayer.onSkipForward}
            disabled={!audiobookPlayer.isLoaded}
            title={_('Skip Forward 10s')}
            aria-label={_('Skip Forward 10s')}
            className='p-1.5'
          >
            <MdForward10 size={tocIconSize - 4} />
          </button>
          <input
            type='range'
            className='w-[80px]'
            min={0}
            max={audiobookPlayer.duration > 0 ? audiobookPlayer.duration : 1}
            step={1}
            value={Number.isFinite(audiobookPlayer.currentTime) ? audiobookPlayer.currentTime : 0}
            disabled={!audiobookPlayer.isLoaded}
            onChange={(e) => audiobookPlayer.onSeek(parseFloat(e.target.value))}
            title={audiobookPlayer.fileName || 'Audiobook'}
            aria-label={_('Audio Seek')}
            style={{ accentColor: '#c49f59' }}
          />
          <span className='font-mono text-[10px] tabular-nums text-[#b89a60]'>
            {formatAudioTime(audiobookPlayer.currentTime)} /{' '}
            {formatAudioTime(audiobookPlayer.duration)}
          </span>
        </div>
      )}
      {audiobookPlayer?.loadError && (
        <div className='mb-2 text-center text-[10px] text-[#c47a5a]'>{_('Audio error')}</div>
      )}

      <div className='flex w-full justify-between pb-4'>
        <Button
          label={_('Table of Contents')}
          icon={<TOCIcon size={tocIconSize} />}
          onClick={() => onSetActionTab('toc')}
        />
        <Button
          label={_('Color')}
          icon={<ColorIcon className={clsx(actionTab === 'color' && 'text-blue-500')} />}
          onClick={() => onSetActionTab('color')}
        />
        <Button
          label={_('Reading Progress')}
          icon={<SliderIcon className={clsx(actionTab === 'progress' && 'text-blue-500')} />}
          onClick={() => onSetActionTab('progress')}
        />
        <Button
          label={_('Font & Layout')}
          icon={
            <FontIcon
              size={fontIconSize}
              className={clsx(actionTab === 'font' && 'text-blue-500')}
            />
          }
          onClick={() => onSetActionTab('font')}
        />
        <Button
          label={_('Speak')}
          icon={<TTSIcon className={viewState?.ttsEnabled ? 'text-blue-500' : ''} />}
          onClick={() => onSetActionTab('tts')}
        />
      </div>
    </div>
  );
};
