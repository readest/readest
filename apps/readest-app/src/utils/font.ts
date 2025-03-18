import { invoke } from '@tauri-apps/api/core';
import { getOSPlatform } from './misc';

let cachedSysFonts: string[] | null = null;

export const FONT_ENUM_SUPPORTED_OS_PLATFORMS = ['macos', 'windows', 'linux'];

const isSymbolicFontName = (font: string) =>
  /emoji|icons|symbol|dingbats|ornaments|webdings|wingdings/i.test(font);

export const getSysFontsList = async (): Promise<string[]> => {
  if (cachedSysFonts) {
    return cachedSysFonts;
  }

  try {
    const osPlatform = getOSPlatform();
    if (FONT_ENUM_SUPPORTED_OS_PLATFORMS.includes(osPlatform)) {
      const fonts = await invoke<string[]>('list_fonts');
      cachedSysFonts = [...new Set(fonts.filter((font) => !isSymbolicFontName(font)))].sort();
      return cachedSysFonts;
    } else {
      console.warn(`Unsupported platform: ${osPlatform}`);
      return [];
    }
  } catch (error) {
    console.error('Error fetching font list:', error);
    return [];
  }
};
