'use client';

import { useEffect, useState } from 'react';
import { ThemeCode } from '@/utils/style';
import { themes, Palette } from '@/styles/themes';
import { isWebAppPlatform } from '@/services/environment';

export type ThemeMode = 'auto' | 'light' | 'dark';

export const useTheme = () => {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined' && localStorage) {
      return (localStorage.getItem('themeMode') as ThemeMode) || 'auto';
    }
    return 'auto';
  });

  const [themeColor, setThemeColor] = useState(() => {
    if (typeof window !== 'undefined' && localStorage) {
      return localStorage.getItem('themeColor') || 'default';
    }
    return 'default';
  });

  const [systemIsDarkMode, setSystemIsDarkMode] = useState(() => {
    return (
      typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    );
  });

  const isDarkMode = themeMode === 'dark' || (themeMode === 'auto' && systemIsDarkMode);

  const [themeCode, setThemeCode] = useState<ThemeCode>(() => {
    let themeMode = 'auto';
    let themeColor = 'default';
    let systemIsDarkMode = false;
    if (typeof window !== 'undefined') {
      themeColor = localStorage.getItem('themeColor') || 'default';
      themeMode = localStorage.getItem('themeMode') as ThemeMode;
      systemIsDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    const isDarkMode = themeMode === 'dark' || (themeMode === 'auto' && systemIsDarkMode);
    const defaultTheme = themes.find((theme) => theme.name === themeColor);
    const defaultPalette = isDarkMode ? defaultTheme!.colors.dark : defaultTheme!.colors.light;
    return {
      bg: defaultPalette['base-100'],
      fg: defaultPalette['base-content'],
      primary: defaultPalette.primary,
      palette: defaultPalette,
    };
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleSystemThemeChange = () => {
        setSystemIsDarkMode(mediaQuery.matches);
      };

      mediaQuery.addEventListener('change', handleSystemThemeChange);
      return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
    }
    return undefined;
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      `${themeColor}-${isDarkMode ? 'dark' : 'light'}`,
    );
  }, [themeColor, isDarkMode]);

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage) {
      localStorage.setItem('themeMode', themeMode);
      localStorage.setItem('themeColor', themeColor);
    }
    const isDarkMode = themeMode === 'dark' || (themeMode === 'auto' && systemIsDarkMode);
    const theme = themes.find((t) => t.name === themeColor);
    const palette = isDarkMode ? theme!.colors.dark : theme!.colors.light;
    const bg = palette['base-100'];
    const fg = palette['base-content'];
    const primary = palette.primary;
    if (isWebAppPlatform()) {
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    }
    setThemeCode({ bg, fg, primary, palette });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeMode, themeColor, isDarkMode]);

  const updateThemeMode = (mode: ThemeMode) => setThemeMode(mode);
  const updateThemeColor = (color: string) => setThemeColor(color);
  const updateAppTheme = (color: keyof Palette) => {
    if (isWebAppPlatform()) {
      const { palette } = themeCode;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette[color]);
    }
  };

  return {
    themeMode,
    themeColor,
    themeCode,
    isDarkMode,
    updateThemeMode,
    updateThemeColor,
    updateAppTheme,
  };
};
