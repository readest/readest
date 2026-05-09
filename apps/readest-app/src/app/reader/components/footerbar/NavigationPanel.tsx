import clsx from 'clsx';
import React, { useCallback, useEffect } from 'react';
import { RiArrowLeftSLine, RiArrowRightSLine } from 'react-icons/ri';
import { RiArrowGoBackLine, RiArrowGoForwardLine } from 'react-icons/ri';
import { RiArrowLeftDoubleLine, RiArrowRightDoubleLine } from 'react-icons/ri';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { NavigationHandlers } from './types';
import { getNavigationIcon } from './utils';
import Button from '@/components/Button';
import Slider from '@/components/Slider';

interface NavigationPanelProps {
  bookKey: string;
  actionTab: string;
  progressFraction: number;
  progressValid: boolean;
  navigationHandlers: NavigationHandlers;
  bottomOffset: string;
  sliderHeight: number;
  forceMobileLayout: boolean;
}

export const NavigationPanel: React.FC<NavigationPanelProps> = ({
  bookKey,
  actionTab,
  progressFraction,
  progressValid,
  navigationHandlers,
  bottomOffset,
  sliderHeight,
  forceMobileLayout,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { getView, getViewSettings } = useReaderStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey);

  const [progressValue, setProgressValue] = React.useState(
    progressValid ? progressFraction * 100 : 0,
  );

  useEffect(() => {
    if (progressValid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgressValue(progressFraction * 100);
    }
  }, [progressValid, progressFraction]);

  const handleProgressChange = useCallback(
    (value: number) => {
      setProgressValue(value);
      navigationHandlers.onProgressChange(value);
    },
    [navigationHandlers],
  );

  const classes = clsx(
    'footerbar-progress-mobile not-eink:bg-base-200 eink:bg-base-100 absolute flex w-full flex-col items-center gap-y-8 px-4 transition-all',
    'eink:border-base-content eink:border-t',
    !forceMobileLayout && 'sm:hidden',
    actionTab === 'progress'
      ? 'pointer-events-auto translate-y-0 pb-4 pt-8 ease-out'
      : 'pointer-events-none invisible translate-y-full overflow-hidden pb-0 pt-0 ease-in',
  );

  return (
    <div
      className={classes}
      style={{
        bottom: appService?.isAndroidApp
          ? `calc(env(safe-area-inset-bottom) + 64px)`
          : bottomOffset,
      }}
    >
      <div className='flex w-full items-center justify-between gap-x-6'>
        <Slider
          label={_('Reading Progress')}
          heightPx={sliderHeight}
          bubbleLabel={`${Math.round(progressValue)}%`}
          initialValue={progressValue}
          onChange={handleProgressChange}
        />
      </div>
      <div className='flex w-full items-center justify-between gap-x-6'>
        <Button
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <RiArrowLeftDoubleLine />,
            <RiArrowRightDoubleLine />,
          )}
          onClick={navigationHandlers.onPrevSection}
          label={_('Previous Section')}
        />
        <Button
          icon={getNavigationIcon(viewSettings?.rtl, <RiArrowLeftSLine />, <RiArrowRightSLine />)}
          onClick={navigationHandlers.onPrevPage}
          label={_('Previous Page')}
        />
        <Button
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <RiArrowGoBackLine />,
            <RiArrowGoForwardLine />,
          )}
          onClick={navigationHandlers.onGoBack}
          label={_('Go Back')}
          disabled={!view?.history.canGoBack}
        />
        <Button
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <RiArrowGoForwardLine />,
            <RiArrowGoBackLine />,
          )}
          onClick={navigationHandlers.onGoForward}
          label={_('Go Forward')}
          disabled={!view?.history.canGoForward}
        />
        <Button
          icon={getNavigationIcon(viewSettings?.rtl, <RiArrowRightSLine />, <RiArrowLeftSLine />)}
          onClick={navigationHandlers.onNextPage}
          label={_('Next Page')}
        />
        <Button
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <RiArrowRightDoubleLine />,
            <RiArrowLeftDoubleLine />,
          )}
          onClick={navigationHandlers.onNextSection}
          label={_('Next Section')}
        />
      </div>
    </div>
  );
};
