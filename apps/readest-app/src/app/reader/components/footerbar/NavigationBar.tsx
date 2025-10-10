import clsx from 'clsx';
import React from 'react';
import { IoIosList as TOCIcon } from 'react-icons/io';
import { RxSlider as SliderIcon } from 'react-icons/rx';
import { RiFontFamily as FontIcon } from 'react-icons/ri';
import { PiSun as ColorIcon } from 'react-icons/pi';
import { MdOutlineHeadphones as TTSIcon } from 'react-icons/md';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';

interface NavigationBarProps {
  bookKey: string;
  actionTab: string;
  navPadding: string;
  onSetActionTab: (tab: string) => void;
}

export const NavigationBar: React.FC<NavigationBarProps> = ({
  bookKey,
  actionTab,
  navPadding: mobileNavPadding,
  onSetActionTab,
}) => {
  const _ = useTranslation();
  const { getViewState } = useReaderStore();
  const viewState = getViewState(bookKey);
  const tocIconSize = useResponsiveSize(23);
  const fontIconSize = useResponsiveSize(18);

  return (
    <div
      className={clsx('bg-base-200 z-30 mt-auto flex w-full justify-between px-8 py-4 sm:hidden')}
      style={{ paddingBottom: mobileNavPadding }}
    >
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
          <FontIcon size={fontIconSize} className={clsx(actionTab === 'font' && 'text-blue-500')} />
        }
        onClick={() => onSetActionTab('font')}
      />
      <Button
        label={_('Speak')}
        icon={<TTSIcon className={viewState?.ttsEnabled ? 'text-blue-500' : ''} />}
        onClick={() => onSetActionTab('tts')}
      />
    </div>
  );
};
