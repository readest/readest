import { useEffect } from 'react';
import { useThemeStore } from '@/store/themeStore';

export const useTheme = () => {
  const { themeColor, isDarkMode } = useThemeStore();
  useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      `${themeColor}-${isDarkMode ? 'dark' : 'light'}`,
    );
  }, [themeColor, isDarkMode]);
};
