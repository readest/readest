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
  onSetActionTab,
}) => {
  const isMobile = window.innerWidth < 640 || window.innerHeight < 640;
  const sliderHeight = useResponsiveSize(28);
  const marginIconSize = useResponsiveSize(20);
  const bottomOffset = isMobile ? `${gridInsets.bottom * 0.33 + 64}px` : '64px';
  const navPadding = isMobile ? `${gridInsets.bottom * 0.33 + 16}px` : '0px';

  return (
    <>
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
        navPadding={navPadding}
        onSetActionTab={onSetActionTab!}
      />
    </>
  );
};

export default MobileFooterBar;
