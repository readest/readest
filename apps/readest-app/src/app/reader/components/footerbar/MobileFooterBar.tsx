import React from 'react';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useThemeStore } from '@/store/themeStore';
import { getHorizontalInsetStyle } from '@/utils/insets';
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
  const isIPhoneDuo = useThemeStore((s) => s.isIPhoneDuo);
  // iPhone Duo's status-bar strip reports as a large left/right inset (#6307);
  // the bases match the panels' px-4 and the bar's px-8.
  const panelInsetStyle = getHorizontalInsetStyle(gridInsets, isIPhoneDuo, 16);
  const barInsetStyle = getHorizontalInsetStyle(gridInsets, isIPhoneDuo, 32);
  const bottomOffset = isMobile ? `${gridInsets.bottom * 0.33 + 64}px` : '64px';

  return (
    <>
      <ColorPanel
        actionTab={actionTab}
        bottomOffset={bottomOffset}
        forceMobileLayout={forceMobileLayout}
        insetStyle={panelInsetStyle}
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
        insetStyle={panelInsetStyle}
      />
      <FontLayoutPanel
        bookKey={bookKey}
        actionTab={actionTab}
        bottomOffset={bottomOffset}
        marginIconSize={marginIconSize}
        forceMobileLayout={forceMobileLayout}
        insetStyle={panelInsetStyle}
      />
      <NavigationBar
        bookKey={bookKey}
        actionTab={actionTab}
        gridInsets={gridInsets}
        forceMobileLayout={forceMobileLayout}
        insetStyle={barInsetStyle}
        onSetActionTab={onSetActionTab!}
      />
    </>
  );
};

export default MobileFooterBar;
