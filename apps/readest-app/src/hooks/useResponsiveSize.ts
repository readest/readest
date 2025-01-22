import { useMediaQuery } from 'react-responsive';

// use desktop size as base size
export const useResponsiveSize = (baseSize: number) => {
  const isPhone = useMediaQuery({ maxWidth: 480 });
  const isTablet = useMediaQuery({ minWidth: 481, maxWidth: 1024 });
  if (isPhone) return baseSize * 1.25;
  if (isTablet) return baseSize * 1.15;
  return baseSize;
};

export const useDefaultIconSize = () => {
  return useResponsiveSize(20);
};
