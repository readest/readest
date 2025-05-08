import { getOSPlatform } from '@/utils/misc';
import { useMediaQuery } from 'react-responsive';

// use desktop size as base size
export const useResponsiveSize = (baseSize: number) => {
  const isPhone = useMediaQuery({ maxWidth: 480 });
  const isTablet = useMediaQuery({ minWidth: 481, maxWidth: 1024 });
  if (typeof window === 'undefined') {
    return baseSize;
  }
  const pixelRatio = window.devicePixelRatio || 2.4;
  const isMobile = ['android', 'ios'].includes(getOSPlatform());
  if (isPhone && isMobile) return baseSize * (pixelRatio / 3) * 1.25;
  if (isTablet && isMobile) return baseSize * (pixelRatio / 3) * 1.25;
  return baseSize;
};

export const useDefaultIconSize = () => {
  return useResponsiveSize(20);
};
