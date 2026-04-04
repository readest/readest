import clsx from 'clsx';
import React from 'react';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { FooterBarChildProps } from './types';
import { NavigationPanel } from './NavigationPanel';
import { FontLayoutPanel } from './FontLayoutPanel';
import { ColorPanel } from './ColorPanel';
import { NavigationBar } from './NavigationBar';

const MobileFooterBar: React.FC<FooterBarChildProps> = ({
  bookKey,
  gridInsets,
  actionTab,
  progressValid,
  progressFraction,
  navigationHandlers,
  isMobileLayout,
  onSetActionTab,
}) => {
  const isMobile = isMobileLayout || window.innerWidth < 640 || window.innerHeight < 640;
  const sliderHeight = useResponsiveSize(28);
  const marginIconSize = useResponsiveSize(20);
  const bottomOffset = isMobile ? `${gridInsets.bottom * 0.33 + 64}px` : '64px';

  return (
    <div className={clsx(isMobileLayout && 'force-mobile-layout')}>
      <ColorPanel actionTab={actionTab} bottomOffset={bottomOffset} />
      <NavigationPanel
        bookKey={bookKey}
        actionTab={actionTab}
        progressFraction={progressFraction}
        progressValid={progressValid}
        navigationHandlers={navigationHandlers}
        bottomOffset={bottomOffset}
        sliderHeight={sliderHeight}
      />
      <FontLayoutPanel
        bookKey={bookKey}
        actionTab={actionTab}
        bottomOffset={bottomOffset}
        marginIconSize={marginIconSize}
      />
      <NavigationBar
        bookKey={bookKey}
        actionTab={actionTab}
        gridInsets={gridInsets}
        isMobileLayout={isMobileLayout}
        onSetActionTab={onSetActionTab!}
      />
    </div>
  );
};

export default MobileFooterBar;
