import { create } from 'zustand';
import { LibraryWallpaperSettings } from '@/types/settings';

interface LibraryWallpaperStore {
  settings: LibraryWallpaperSettings;
  setSettings: (settings: Partial<LibraryWallpaperSettings>) => void;
  resetSettings: () => void;
}

const initialSettings: LibraryWallpaperSettings = {
  enabled: false,
  type: 'color',
  color: '#f0f0f0',
  opacity: 0.1,
  blur: 0,
};

export const useLibraryWallpaperStore = create<LibraryWallpaperStore>((set) => ({
  settings: initialSettings,

  setSettings: (partialSettings) =>
    set((state) => ({
      settings: {
        ...state.settings,
        ...partialSettings,
      },
    })),

  resetSettings: () =>
    set({
      settings: initialSettings,
    }),
}));
