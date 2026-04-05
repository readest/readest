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
  forceMobileLayout,
  onSetActionTab,
}) => {
  const isMobile = forceMobileLayout || window.innerWidth < 640 || window.innerHeight < 640;
  const sliderHeight = useResponsiveSize(28);
  const marginIconSize = useResponsiveSize(20);
  const bottomOffset = isMobile ? `${gridInsets.bottom * 0.33 + 64}px` : '64px';

  return (
    <>
      <ColorPanel
        actionTab={actionTab}
        bottomOffset={bottomOffset}
        forceMobileLayout={forceMobileLayout}
      />
      <NavigationPanel
        bookKey={bookKey}
        actionTab={actionTab}
        progressFraction={progressFraction}
        progressValid={progressValid}
        navigationHandlers={navigationHandlers}
        bottomOffset={bottomOffset}
        sliderHeight={sliderHeight}
        forceMobileLayout={forceMobileLayout}
      />
      <FontLayoutPanel
        bookKey={bookKey}
        actionTab={actionTab}
        bottomOffset={bottomOffset}
        marginIconSize={marginIconSize}
        forceMobileLayout={forceMobileLayout}
      />
      <NavigationBar
        bookKey={bookKey}
        actionTab={actionTab}
        gridInsets={gridInsets}
        forceMobileLayout={forceMobileLayout}
        onSetActionTab={onSetActionTab!}
      />
    </>
  );
};

export default MobileFooterBar;
